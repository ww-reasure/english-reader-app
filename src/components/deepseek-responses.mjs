/**
 * DeepSeek Native Web Search (Responses API)
 *
 * DeepSeek's server-side web search is only available through the Responses
 * API (`deepseek-v4-flash`), not through /chat/completions. This module owns:
 *
 *   - mode resolution (deepseek_native / tavily / off)
 *   - chat-message to Responses input-item conversion
 *   - the SSE streaming client and result extraction
 *   - web_search_call source normalization for the research card
 *
 * Tavily remains an optional provider and is never required for native mode.
 */

import { normalizeResearchSources } from './web-research.mjs';

export const WEB_RESEARCH_MODES = ['deepseek_native', 'tavily', 'off'];
export const WEB_RESEARCH_MODE_LABELS = {
  deepseek_native: 'DeepSeek 原生联网（推荐，无需额外 Key）',
  tavily: 'Tavily 联网检索',
  off: '关闭联网检索'
};

const OFFICIAL_HOSTS = new Set(['api.deepseek.com', 'deepseek.com']);
const V4_FLASH_PATTERN = /^deepseek-v4-flash(?:$|[-:])/i;
const RESPONSES_ENDPOINT = 'https://api.deepseek.com/responses';
const DEFAULT_TIMEOUT_MS = 60000;
const MAX_ERROR_LENGTH = 600;

const hostOf = url => {
  try {
    return String(new URL(url).hostname || '').replace(/^www\./, '');
  } catch {
    return '';
  }
};

/**
 * Native search requires the official DeepSeek host and a v4-flash model.
 * The v4-pro model does not support the Responses API yet.
 */
export function isDeepSeekNativeSearchSupported({ model = '', baseUrl = '' } = {}) {
  return V4_FLASH_PATTERN.test(String(model || '').trim()) && OFFICIAL_HOSTS.has(hostOf(baseUrl));
}

/**
 * Decide which provider the home agent should use for this request.
 * deepseek_native falls back to Tavily only when a key is present; otherwise
 * it degrades to no web search instead of failing the conversation.
 */
export function resolveWebResearchPlan({ mode = 'deepseek_native', model = '', baseUrl = '', tavilyKey = '' } = {}) {
  const hasTavilyKey = Boolean(String(tavilyKey || '').trim());
  if (mode === 'off') return { native: false, tavily: false, reason: 'off' };
  if (mode === 'deepseek_native') {
    if (isDeepSeekNativeSearchSupported({ model, baseUrl })) {
      return { native: true, tavily: false, reason: '' };
    }
    if (hasTavilyKey) return { native: false, tavily: true, reason: 'native_unsupported_fallback_tavily' };
    return { native: false, tavily: false, reason: 'native_unsupported' };
  }
  // mode === 'tavily'
  return { native: false, tavily: hasTavilyKey, reason: hasTavilyKey ? '' : 'tavily_missing_key' };
}

/**
 * The official DeepSeek Responses API mounts at https://api.deepseek.com
 * (no /v1 prefix). Custom OpenAI-compatible gateways get /responses appended
 * to their configured base URL.
 */
export function responsesEndpointFor(baseUrl = '') {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (OFFICIAL_HOSTS.has(hostOf(base))) return RESPONSES_ENDPOINT;
  return `${base || 'https://api.deepseek.com'}/responses`;
}

/**
 * Convert the chat-completions transcript used by ContextBuilder into
 * Responses input items. web_search_call entries are passed back as-is so the
 * server restores the search results (documented DeepSeek behavior).
 */
export function messagesToResponsesItems(messages = []) {
  const items = [];
  let sequence = 0;
  const responseContent = content => {
    if (!Array.isArray(content)) return String(content || '');
    return content.map(part => {
      if (part?.type === 'text') return { type: 'input_text', text: String(part.text || '') };
      if (part?.type === 'file' && part.file_id) {
        return { type: 'input_image', file_id: String(part.file_id), detail: 'original' };
      }
      if (part?.type === 'image_url' && part.image_url?.url) {
        return { type: 'input_image', image_url: { url: String(part.image_url.url) }, detail: 'original' };
      }
      return null;
    }).filter(Boolean);
  };
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    if (message.type === 'web_search_call') {
      items.push({ type: 'web_search_call', ...message });
      continue;
    }
    const role = message.role;
    if (role === 'system' || role === 'developer') {
      items.push({ role, content: responseContent(message.content) });
    } else if (role === 'user') {
      items.push({ role: 'user', content: responseContent(message.content) });
    } else if (role === 'assistant') {
      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      items.push({ role: 'assistant', content: responseContent(message.content) });
      for (const call of toolCalls) {
        sequence += 1;
        const id = call?.id || `fc_${Date.now().toString(36)}_${sequence}`;
        items.push({
          type: 'function_call',
          id,
          call_id: call?.id || id,
          name: call?.function?.name || call?.name || '',
          arguments: String(call?.function?.arguments ?? call?.arguments ?? '{}')
        });
      }
    } else if (role === 'tool') {
      items.push({
        type: 'function_call_output',
        call_id: message.tool_call_id || '',
        output: String(message.content || '')
      });
    }
  }
  return items;
}

/**
 * Convert chat-completions style function tools into the Responses API shape
 * ({type:'function', name, description, parameters}). DeepSeek rejects the
 * request entirely when function tools keep the chat-wrapper format, which
 * silently disabled every tool (including web_search) in native mode.
 */
export function normalizeResponsesTools(tools = []) {
  const rows = [];
  for (const tool of Array.isArray(tools) ? tools : []) {
    if (!tool || typeof tool !== 'object') continue;
    if (tool.type === 'function' && tool.function) {
      const fn = tool.function;
      const row = {
        type: 'function',
        name: String(fn.name || '').trim()
      };
      if (fn.description) row.description = String(fn.description);
      if (fn.parameters) row.parameters = fn.parameters;
      if (fn.strict !== undefined) row.strict = Boolean(fn.strict);
      rows.push(row);
    } else if (tool.type === 'web_search' || tool.type === 'web_search_2025_08_26') {
      rows.push({ type: tool.type });
    } else if (tool.type === 'function' && tool.name) {
      rows.push({ ...tool });
    }
  }
  return rows;
}

/**
 * Normalize a completed Responses response into the chat-completions message
 * shape used by ChatService, plus the raw web_search_call items and usage.
 */
export function extractResponsesResult(response = {}) {
  const output = Array.isArray(response.output) ? response.output : [];
  let content = typeof response.output_text === 'string' ? response.output_text : '';
  const toolCalls = [];
  const webSearchCalls = [];
  for (const item of output) {
    if (item?.type === 'message' && Array.isArray(item.content)) {
      for (const part of item.content) {
        const text = part?.text ?? part?.output_text;
        if (typeof text === 'string') content += text;
      }
    } else if (item?.type === 'function_call') {
      toolCalls.push({
        id: item.id || item.call_id || '',
        type: 'function',
        function: { name: item.name || '', arguments: item.arguments || '{}' }
      });
    } else if (item?.type === 'web_search_call') {
      webSearchCalls.push(item);
    }
  }
  return {
    role: 'assistant',
    content,
    tool_calls: toolCalls,
    web_search_calls: webSearchCalls,
    usage: response.usage || null
  };
}

export function extractWebSearchQueries(webSearchCalls = []) {
  const queries = [];
  const push = text => {
    const clean = String(text || '').trim().slice(0, 200);
    if (!clean || queries.includes(clean)) return;
    // DeepSeek appends internal tracker strings to action.queries; never show
    // them as if they were the user's search topic.
    if (/ws_call_id\s*=/i.test(clean)) return;
    queries.push(clean);
  };
  for (const call of webSearchCalls) {
    if (!['completed', 'success'].includes(call?.status)) continue;
    const entries = Array.isArray(call?.search_queries) ? call.search_queries : [];
    for (const entry of entries) push(entry?.text || entry?.query);
    if (typeof call?.search_query === 'string') push(call.search_query);
    const actionQueries = Array.isArray(call?.action?.queries) ? call.action.queries : [];
    for (const item of actionQueries) push(typeof item === 'string' ? item : item?.text || item?.query);
  }
  return queries;
}

/**
 * Extract real, deduplicated sources from completed web_search_call items.
 * Unknown or malformed result shapes are dropped rather than guessed.
 */
export function extractWebSearchSources(webSearchCalls = []) {
  const rows = [];
  for (const call of webSearchCalls) {
    if (!['completed', 'success'].includes(call?.status)) continue;
    const results = Array.isArray(call.search_results) ? call.search_results : [];
    for (const result of results) {
      if (!result || typeof result !== 'object') continue;
      rows.push({
        title: result.title || result.name || '',
        url: result.url || '',
        domain: result.domain || '',
        publishedAt: result.published_at || result.publishedAt || result.publish_date || '',
        snippet: result.snippet || result.content || ''
      });
    }
    // DeepSeek returns the browsed page as action.open_page without attaching
    // search_results. Those URLs are real sources the model actually visited.
    if (call?.action?.type === 'open_page' && typeof call.action.url === 'string') {
      rows.push({ title: '', url: call.action.url, domain: '', publishedAt: '', snippet: '' });
    }
  }
  return normalizeResearchSources(rows);
}

/**
 * Build the research_sources artifact shown as the "联网检索" card. Returns
 * null when nothing searchable happened so the UI stays quiet.
 */
export function buildNativeResearchArtifact(webSearchCalls = []) {
  const sources = extractWebSearchSources(webSearchCalls);
  const queries = extractWebSearchQueries(webSearchCalls);
  const searchedAt = Date.now();
  if (sources.length) {
    return {
      type: 'research_sources',
      native: true,
      status: 'ok',
      query: queries[0] || '联网检索',
      searchedAt,
      sources
    };
  }
  if (!queries.length) return null;
  // DeepSeek executes the search server-side and usually embeds the real
  // sources inside the answer text instead of returning structured results.
  const executed = webSearchCalls.some(call => ['completed', 'success'].includes(call?.status));
  return {
    type: 'research_sources',
    native: true,
    status: executed ? 'searched' : 'no_results',
    query: queries[0],
    searchedAt,
    sources: []
  };
}

function createSseReader(response, { idleTimeoutMs }) {
  const reader = response.body?.getReader?.();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventType = '';
  let dataLines = [];
  let finalResponse = null;
  let lastError = '';

  const flush = () => {
    if (dataLines.length) {
      const raw = dataLines.join('\n');
      dataLines = [];
      if (raw === '[DONE]') return;
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      if (eventType === 'response.completed' || eventType === 'response.incomplete') {
        finalResponse = payload.response || payload;
      } else if (eventType === 'response.failed') {
        lastError = String(payload?.error?.message || payload?.error || '响应生成失败').slice(0, MAX_ERROR_LENGTH);
      }
    }
    eventType = '';
  };

  const consumeLine = line => {
    if (!line.trim()) {
      flush();
      return;
    }
    if (line.startsWith(':')) return;
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim();
      return;
    }
    if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^\s/, ''));
  };

  const readAll = async () => {
    if (!reader) {
      const payload = await response.json().catch(() => null);
      if (payload?.response) return { response: payload.response };
      if (payload?.error) return { error: String(payload.error?.message || JSON.stringify(payload.error)).slice(0, MAX_ERROR_LENGTH) };
      return { error: '响应格式无效' };
    }
    while (true) {
      let idleTimer;
      let chunk;
      try {
        const readPromise = reader.read();
        const timeoutPromise = new Promise((_, reject) => {
          idleTimer = setTimeout(() => reject(new Error('联网请求等待超时，请检查网络连接')), idleTimeoutMs);
        });
        chunk = await Promise.race([readPromise, timeoutPromise]);
      } finally {
        if (idleTimer) clearTimeout(idleTimer);
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        consumeLine(line);
      }
    }
    buffer += decoder.decode();
    if (buffer) {
      buffer.split(/\r?\n/).forEach(consumeLine);
    }
    flush();
    if (finalResponse) return { response: finalResponse };
    if (lastError) return { error: lastError };
    return { error: '联网响应未完成' };
  };

  return readAll;
}

/**
 * Streaming Responses client. Reads SSE events until response.completed /
 * response.incomplete / response.failed and returns the normalized result.
 */
export function createDeepSeekResponsesClient({ config = null, fetchImpl = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  const apiKey = () => String(config?.get?.('api_key') || '').trim();
  const model = () => String(config?.get?.('model') || '').trim();
  const baseUrl = () => String(config?.get?.('base_url') || '').trim();

  return {
    async completion(items, {
      tools = [],
      signal = null,
      temperature = 0.45,
      maxOutputTokens = null,
      toolChoice = 'auto',
      modelOverride = null
    } = {}) {
      const controller = new AbortController();
      const abortRequest = () => controller.abort();
      if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', abortRequest, { once: true });
      }
      const body = {
        model: modelOverride || model(),
        input: Array.isArray(items) ? items : [],
        ...(Array.isArray(tools) && tools.length ? { tools: normalizeResponsesTools(tools), tool_choice: toolChoice } : {}),
        ...(Number.isFinite(Number(temperature)) ? { temperature: Number(temperature) } : {}),
        ...(Number.isFinite(Number(maxOutputTokens)) && Number(maxOutputTokens) > 0 ? { max_output_tokens: Math.floor(Number(maxOutputTokens)) } : {})
      };
      try {
        const response = await doFetch(responsesEndpointFor(baseUrl()), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey()}`,
            'Accept': 'text/event-stream'
          },
          body: JSON.stringify({ ...body, stream: true }),
          signal: controller.signal
        });
        if (!response.ok) {
          const raw = await response.text().catch(() => '');
          throw new Error(`API error: ${response.status} - ${String(raw).slice(0, MAX_ERROR_LENGTH)}`);
        }
        const readEvents = createSseReader(response, { idleTimeoutMs: timeoutMs });
        const outcome = await readEvents();
        if (outcome.error) throw new Error(outcome.error);
        if (!outcome.response) throw new Error('联网响应未完成，请重试');
        return extractResponsesResult(outcome.response);
      } catch (error) {
        if (error.name === 'AbortError') {
          throw new Error(signal?.aborted ? '请求已取消' : '联网请求超时，请检查网络连接');
        }
        throw error;
      } finally {
        if (signal) signal.removeEventListener('abort', abortRequest);
      }
    },

    /**
     * Minimal real request used by the settings "测试联网" button. Bounded
     * output keeps the cost of a connectivity check negligible.
     */
    async test({ signal = null } = {}) {
      try {
        const result = await this.completion(
          [{ role: 'user', content: '请用一句话说明今天的日期。' }],
          { tools: [{ type: 'web_search' }], signal, temperature: 0, maxOutputTokens: 512 }
        );
        const content = String(result.content || '').trim();
        const searched = Array.isArray(result.web_search_calls)
          && result.web_search_calls.some(call => ['completed', 'success'].includes(call?.status));
        if (!content) return { ok: false, reason: '服务端未返回回答内容，联网搜索可能尚未就绪' };
        return { ok: true, searched, content: content.slice(0, 160) };
      } catch (error) {
        return { ok: false, reason: String(error?.message || '').slice(0, 300) };
      }
    }
  };
}
