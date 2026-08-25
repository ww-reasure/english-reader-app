import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WEB_RESEARCH_MODES,
  buildNativeResearchArtifact,
  createDeepSeekResponsesClient,
  extractResponsesResult,
  extractWebSearchQueries,
  extractWebSearchSources,
  isDeepSeekNativeSearchSupported,
  messagesToResponsesItems,
  normalizeResponsesTools,
  resolveWebResearchPlan,
  responsesEndpointFor
} from '../src/components/deepseek-responses.mjs';

const sseChunk = (event, payload) => `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
const sseText = events => events.map(([event, payload]) => sseChunk(event, payload)).join('');
const completedResponse = (output, usage) => ({
  id: 'resp_1',
  object: 'response',
  status: 'completed',
  output,
  usage: usage || { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 4 } }
});

const sseStream = text => new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode(text));
    controller.close();
  }
});

const responseStream = (output, usage) => sseStream(
  sseText([['response.completed', { type: 'response.completed', response: completedResponse(output, usage) }]])
);

test('web research mode resolution covers native, tavily fallback and off', () => {
  const deepseek = { mode: 'deepseek_native', model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com/v1', tavilyKey: '' };
  assert.deepEqual(resolveWebResearchPlan(deepseek), { native: true, tavily: false, reason: '' });

  const proNoKey = { ...deepseek, model: 'deepseek-v4-pro' };
  assert.deepEqual(resolveWebResearchPlan(proNoKey), { native: false, tavily: false, reason: 'native_unsupported' });
  const proWithKey = { ...proNoKey, tavilyKey: 'tvly-x' };
  assert.deepEqual(resolveWebResearchPlan(proWithKey), { native: false, tavily: true, reason: 'native_unsupported_fallback_tavily' });

  const customHost = { ...deepseek, baseUrl: 'https://openrouter.ai/api/v1' };
  assert.deepEqual(resolveWebResearchPlan(customHost), { native: false, tavily: false, reason: 'native_unsupported' });

  assert.deepEqual(resolveWebResearchPlan({ mode: 'tavily', tavilyKey: '' }), { native: false, tavily: false, reason: 'tavily_missing_key' });
  assert.deepEqual(resolveWebResearchPlan({ mode: 'tavily', tavilyKey: 'tvly-x' }), { native: false, tavily: true, reason: '' });
  assert.deepEqual(resolveWebResearchPlan({ mode: 'off', tavilyKey: 'tvly-x', model: 'deepseek-v4-flash' }), { native: false, tavily: false, reason: 'off' });
  assert.deepEqual(WEB_RESEARCH_MODES, ['deepseek_native', 'tavily', 'off']);
});

test('native search support requires deepseek-v4-flash and an official host', () => {
  assert.equal(isDeepSeekNativeSearchSupported({ model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com' }), true);
  assert.equal(isDeepSeekNativeSearchSupported({ model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com/v1' }), true);
  assert.equal(isDeepSeekNativeSearchSupported({ model: 'deepseek-v4-flash', baseUrl: 'https://openrouter.ai' }), false);
  assert.equal(isDeepSeekNativeSearchSupported({ model: 'deepseek-v4-pro', baseUrl: 'https://api.deepseek.com' }), false);
  assert.equal(isDeepSeekNativeSearchSupported({ model: 'gpt-4o', baseUrl: 'https://api.deepseek.com' }), false);
});

test('responses endpoint uses the official mount for DeepSeek hosts', () => {
  assert.equal(responsesEndpointFor('https://api.deepseek.com'), 'https://api.deepseek.com/responses');
  assert.equal(responsesEndpointFor('https://api.deepseek.com/v1'), 'https://api.deepseek.com/responses');
  assert.equal(responsesEndpointFor('https://openrouter.ai/api/v1'), 'https://openrouter.ai/api/v1/responses');
  assert.equal(responsesEndpointFor(''), 'https://api.deepseek.com/responses');
});

test('messages convert to Responses input items including function calls and web_search_call pass-back', () => {
  const items = messagesToResponsesItems([
    { role: 'system', content: '你是助教' },
    { role: 'user', content: '今天有什么新闻' },
    { role: 'assistant', content: '我查一下', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'get_learning_overview', arguments: '{}' } }] },
    { type: 'web_search_call', id: 'ws_1', status: 'completed', search_results: [] },
    { role: 'tool', tool_call_id: 'call-1', name: 'get_learning_overview', content: '{"due":2}' }
  ]);
  assert.deepEqual(items, [
    { role: 'system', content: '你是助教' },
    { role: 'user', content: '今天有什么新闻' },
    { role: 'assistant', content: '我查一下' },
    { type: 'function_call', id: 'call-1', call_id: 'call-1', name: 'get_learning_overview', arguments: '{}' },
    { type: 'web_search_call', id: 'ws_1', status: 'completed', search_results: [] },
    { type: 'function_call_output', call_id: 'call-1', output: '{"due":2}' }
  ]);
});

test('normalizeResponsesTools converts chat-wrapper function tools to Responses shape', () => {
  const normalized = normalizeResponsesTools([
    { type: 'function', function: { name: 'get_learning_overview', description: '查概览', parameters: { type: 'object' } } },
    { type: 'web_search' },
    { type: 'function', name: 'already_responses', parameters: {} }
  ]);
  assert.deepEqual(normalized, [
    { type: 'function', name: 'get_learning_overview', description: '查概览', parameters: { type: 'object' } },
    { type: 'web_search' },
    { type: 'function', name: 'already_responses', parameters: {} }
  ]);
});

test('responses result extraction normalizes function calls, web search calls and text', () => {
  const result = extractResponsesResult(completedResponse([
    { type: 'message', content: [{ type: 'output_text', text: '这是答案。' }] },
    { type: 'function_call', id: 'fc_1', call_id: 'call-9', name: 'generate_reading', arguments: '{"topic":"AI"}' },
    { type: 'web_search_call', id: 'ws_9', status: 'completed', search_queries: [{ text: 'today news' }], search_results: [{ title: 'News A', url: 'https://example.com/a', content: 'snippet' }] }
  ]));
  assert.equal(result.content, '这是答案。');
  assert.deepEqual(result.tool_calls, [{ id: 'fc_1', type: 'function', function: { name: 'generate_reading', arguments: '{"topic":"AI"}' } }]);
  assert.equal(result.web_search_calls.length, 1);
  assert.equal(result.usage.input_tokens, 10);
});

test('web search sources are normalized, deduplicated and capped', () => {
  const calls = [{
    type: 'web_search_call',
    status: 'completed',
    search_queries: [{ text: 'latest AI' }],
    search_results: [
      { title: 'A', url: 'https://example.com/a', published_at: '2026-08-09', snippet: 'x' },
      { title: 'A', url: 'https://example.com/a', snippet: 'dup' },
      { title: 'Bad', url: 'not-a-url' },
      { title: 'B', url: 'https://example.org/b' }
    ]
  }];
  assert.equal(extractWebSearchQueries(calls)[0], 'latest AI');
  const sources = extractWebSearchSources(calls);
  assert.equal(sources.length, 2);
  assert.equal(sources[0].domain, 'example.com');
  assert.equal(sources[0].publishedAt, '2026-08-09');
});

test('web search extraction reads DeepSeek action.queries and open_page URLs', () => {
  const calls = [
    { type: 'web_search_call', status: 'completed', action: { type: 'search', queries: ['今天新闻', 'ws_call_id=1'] } },
    { type: 'web_search_call', status: 'completed', action: { type: 'open_page', url: 'https://news.example.com/today' } },
    { type: 'web_search_call', status: 'failed', action: { type: 'search', queries: ['unused'] } }
  ];
  const queries = extractWebSearchQueries(calls);
  assert.deepEqual(queries, ['今天新闻']);
  const sources = extractWebSearchSources(calls);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, 'https://news.example.com/today');
  assert.equal(sources[0].domain, 'news.example.com');
});

test('native artifact only appears when search calls produced results', () => {
  assert.equal(buildNativeResearchArtifact([]), null);
  assert.equal(buildNativeResearchArtifact([{ status: 'in_progress' }]), null);
  const searched = buildNativeResearchArtifact([{ status: 'completed', search_queries: [{ text: 'executed' }], search_results: [] }]);
  assert.equal(searched.status, 'searched');
  assert.equal(searched.query, 'executed');
  assert.equal(buildNativeResearchArtifact([{ status: 'failed', search_queries: [{ text: 'nothing found' }], search_results: [] }]), null);
  const ok = buildNativeResearchArtifact([{ status: 'completed', search_queries: [{ text: 'news' }], search_results: [{ title: 'T', url: 'https://example.com/t' }] }]);
  assert.equal(ok.status, 'ok');
  assert.equal(ok.native, true);
  assert.equal(ok.sources.length, 1);
});

test('completion sends the requested tool_choice in the body', async () => {
  let sentBody = null;
  const client = createDeepSeekResponsesClient({
    config: { get: key => ({ api_key: 'sk-test', model: 'deepseek-v4-flash', base_url: 'https://api.deepseek.com' }[key] || '') },
    fetchImpl: async (_url, options) => {
      sentBody = JSON.parse(options.body);
      return { ok: true, body: responseStream([{ type: 'message', content: [{ type: 'output_text', text: '好的。' }] }]), headers: { get: () => 'text/event-stream' } };
    }
  });
  await client.completion([{ role: 'user', content: 'hi' }], { tools: [{ type: 'web_search' }, { type: 'function', function: { name: 'get_learning_overview', description: '概览', parameters: { type: 'object' } } }], toolChoice: { type: 'web_search' } });
  assert.deepEqual(sentBody.tool_choice, { type: 'web_search' });
  assert.deepEqual(sentBody.tools[0], { type: 'web_search' });
  assert.deepEqual(sentBody.tools[1], { type: 'function', name: 'get_learning_overview', description: '概览', parameters: { type: 'object' } });
  const autoClient = createDeepSeekResponsesClient({
    config: { get: key => ({ api_key: 'sk-test', model: 'deepseek-v4-flash', base_url: 'https://api.deepseek.com' }[key] || '') },
    fetchImpl: async (_url, options) => {
      sentBody = JSON.parse(options.body);
      return { ok: true, body: responseStream([{ type: 'message', content: [{ type: 'output_text', text: '好的。' }] }]), headers: { get: () => 'text/event-stream' } };
    }
  });
  await autoClient.completion([{ role: 'user', content: 'hi' }], { tools: [{ type: 'web_search' }] });
  assert.equal(sentBody.tool_choice, 'auto');
});

test('messages convert multimodal chat content into Responses input images', () => {
  const items = messagesToResponsesItems([{
    role: 'user',
    content: [
      { type: 'text', text: '讲解这张图' },
      { type: 'file', file_id: 'file-api-1' }
    ]
  }]);
  assert.deepEqual(items, [{
    role: 'user',
    content: [
      { type: 'input_text', text: '讲解这张图' },
      { type: 'input_image', file_id: 'file-api-1', detail: 'original' }
    ]
  }]);
});

test('completion accepts a request-level model override without changing configured model', async () => {
  let sentBody = null;
  const config = {
    get: key => ({ api_key: 'sk-test', model: 'deepseek-v4-pro', base_url: 'https://api.deepseek.com' }[key] || '')
  };
  const client = createDeepSeekResponsesClient({
    config,
    fetchImpl: async (_url, options) => {
      sentBody = JSON.parse(options.body);
      return { ok: true, body: responseStream([{ type: 'message', content: [{ type: 'output_text', text: '好的。' }] }]), headers: { get: () => 'text/event-stream' } };
    }
  });
  await client.completion([{ role: 'user', content: '图片' }], { modelOverride: 'deepseek-v4-flash-vision-exp' });
  assert.equal(sentBody.model, 'deepseek-v4-flash-vision-exp');
  assert.equal(config.get('model'), 'deepseek-v4-pro');
});

test('streaming client parses Responses SSE and returns the completed result', async () => {
  const text = sseText([
    ['response.created', { type: 'response.created', response: { id: 'resp_1', status: 'in_progress' } }],
    ['response.output_text.delta', { type: 'response.output_text.delta', delta: '新闻：' }],
    ['response.output_text.delta', { type: 'response.output_text.delta', delta: '今天有活动。' }],
    ['response.completed', { type: 'response.completed', response: completedResponse([{ type: 'message', content: [{ type: 'output_text', text: '新闻：今天有活动。' }] }]) }]
  ]);
  const client = createDeepSeekResponsesClient({
    config: { get: key => ({ api_key: 'sk-test', model: 'deepseek-v4-flash', base_url: 'https://api.deepseek.com/v1' }[key] || '') },
    fetchImpl: async () => ({ ok: true, body: sseStream(text), headers: { get: () => 'text/event-stream' } })
  });
  const result = await client.completion([{ role: 'user', content: '今天新闻' }], { tools: [{ type: 'web_search' }] });
  assert.equal(result.content, '新闻：今天有活动。');
  assert.deepEqual(result.tool_calls, []);
});

test('streaming client surfaces web_search_call and function_call items from SSE', async () => {
  const webCall = { type: 'web_search_call', id: 'ws_2', status: 'completed', search_queries: [{ text: 'hot topic' }], search_results: [{ title: 'R', url: 'https://example.com/r' }] };
  const fnCall = { type: 'function_call', id: 'fc_2', call_id: 'call-2', name: 'generate_reading', arguments: '{}' };
  const client = createDeepSeekResponsesClient({
    config: { get: () => '' },
    fetchImpl: async () => ({ ok: true, body: responseStream([webCall, fnCall]), headers: { get: () => 'text/event-stream' } })
  });
  const result = await client.completion([], { tools: [] });
  assert.equal(result.web_search_calls.length, 1);
  assert.equal(result.web_search_calls[0].search_results.length, 1);
  assert.equal(result.tool_calls[0].function.name, 'generate_reading');
});

test('streaming client reports response.failed and HTTP errors without fabricating results', async () => {
  const failed = sseText([['response.failed', { type: 'response.failed', error: { message: '搜索服务暂时不可用' } }]]);
  const client = createDeepSeekResponsesClient({
    config: { get: key => ({ api_key: 'sk-test', model: 'deepseek-v4-flash', base_url: 'https://api.deepseek.com' }[key] || '') },
    fetchImpl: async () => ({ ok: true, body: sseStream(failed), headers: { get: () => 'text/event-stream' } })
  });
  await assert.rejects(client.completion([], { tools: [] }), /搜索服务暂时不可用/);

  const httpClient = createDeepSeekResponsesClient({
    config: { get: key => ({ api_key: 'sk-test', model: 'deepseek-v4-flash', base_url: 'https://api.deepseek.com' }[key] || '') },
    fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'unauthorized' })
  });
  await assert.rejects(httpClient.completion([], { tools: [] }), /401/);
});

test('streaming client cancels cleanly on abort', async () => {
  const controller = new AbortController();
  const client = createDeepSeekResponsesClient({
    config: { get: key => ({ api_key: 'sk-test', model: 'deepseek-v4-flash', base_url: 'https://api.deepseek.com' }[key] || '') },
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
      }, { once: true });
    })
  });
  const pending = client.completion([], { tools: [], signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /请求已取消/);
});

test('settings test helper reports ok with bounded output', async () => {
  let sentBody = null;
  const client = createDeepSeekResponsesClient({
    config: { get: key => ({ api_key: 'sk-test', model: 'deepseek-v4-flash', base_url: 'https://api.deepseek.com' }[key] || '') },
    fetchImpl: async (_url, options) => {
      sentBody = JSON.parse(options.body);
      return { ok: true, body: responseStream([{ type: 'web_search_call', id: 'ws_t', status: 'completed', action: { type: 'search', queries: ['date'] } }, { type: 'message', content: [{ type: 'output_text', text: '今天是 2026-08-10。' }] }]), headers: { get: () => 'text/event-stream' } };
    }
  });
  const outcome = await client.test();
  assert.equal(outcome.ok, true);
  assert.equal(outcome.searched, true);
  assert.ok(sentBody.tools.some(tool => tool.type === 'web_search'));
  assert.equal(sentBody.max_output_tokens, 512);
});

test('settings test reports failure when the service returns no answer content', async () => {
  const client = createDeepSeekResponsesClient({
    config: { get: key => ({ api_key: 'sk-test', model: 'deepseek-v4-flash', base_url: 'https://api.deepseek.com' }[key] || '') },
    fetchImpl: async () => ({ ok: true, body: responseStream([]), headers: { get: () => 'text/event-stream' } })
  });
  const outcome = await client.test();
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /未返回回答内容/);
});
