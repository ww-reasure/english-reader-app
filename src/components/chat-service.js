import { LEARNING_TOOLS } from './learning-agent.js';
import { assembleChatMessages } from './multimodal-context.mjs';

const toolsUnsupported = error => /tool|function|unsupported/i.test(String(error?.message || ''));
const isReadingGenerationCall = call => call?.function?.name === 'generate_reading';
const isReadingCardImportCall = call => call?.function?.name === 'save_reading_card';
const isGuidedLearningCall = call => ['create_guided_learning', 'adapt_guided_learning'].includes(call?.function?.name);
const TIMELY_QUERY_PATTERNS = [
  /新闻|时讯|资讯|热点|快讯|突发|头条|实时|时事|今日|今天|最新|最近|近日|近期|当前|进展|动态|大事|天气|预报/,
  /\b(news|headline|breaking|latest|today|current|recent|update|live|weather|what happened)\b/i
];
const isTimelyQuery = message => {
  const text = String(message || '').trim();
  if (!text) return false;
  return TIMELY_QUERY_PATTERNS.some(pattern => pattern.test(text));
};
const generationToolFailure = () => ({
  type: 'generation_failure',
  failure: { message: '文章定制暂时失败，请重新生成。', reason: 'tool_error' }
});
const guidedLearningToolFailure = () => ({
  type: 'guided_learning_failure',
  failure: { message: '互动教学暂时无法生成，请重试或改用详细解析。', reason: 'tool_error' }
});
const completeReply = (content, artifacts, toolSupport = null) => ({
  content,
  artifacts,
  ...(toolSupport ? { toolSupport } : {})
});

const safeToolContent = result => {
  try { return JSON.stringify(result ?? null).slice(0, 8000); }
  catch { return JSON.stringify({ status: 'unserializable_tool_result' }); }
};

const assistantToolMessage = reply => ({
  role: 'assistant',
  content: reply?.content ?? '',
  ...(reply?.reasoning_content !== undefined ? { reasoning_content: reply.reasoning_content } : {}),
  tool_calls: reply?.tool_calls || []
});

// Assembles a chat-completions assistant message out of streaming delta
// chunks (content plus index-keyed tool_calls fragments).
const createStreamAssembler = () => {
  let content = '';
  const toolCalls = [];
  return {
    addContentDelta(text) {
      content += String(text || '');
    },
    addToolCallFragments(rows) {
      for (const row of Array.isArray(rows) ? rows : []) {
        const index = Math.max(0, Math.floor(Number(row?.index) || 0));
        const slot = toolCalls[index] || (toolCalls[index] = { id: '', type: 'function', function: { name: '', arguments: '' } });
        if (row?.id) slot.id = row.id;
        if (typeof row?.function?.name === 'string') slot.function.name += row.function.name;
        if (typeof row?.function?.arguments === 'string') slot.function.arguments += row.function.arguments;
      }
    },
    finishMessage() {
      return {
        role: 'assistant',
        content,
        ...(toolCalls.length ? { tool_calls: toolCalls.filter(slot => slot.function.name || slot.function.arguments) } : {})
      };
    }
  };
};

export class ChatService {
  constructor({ api, agent, builder, telemetry = null, webResearch = null }) {
    this.api = api;
    this.agent = agent;
    this.builder = builder;
    this.telemetry = telemetry;
    this.webResearch = webResearch;
    this.controllers = new Map();
  }

  cancel(key) {
    this.controllers.get(key)?.abort();
    this.controllers.delete(key);
  }

  async ask({
    sessionKey,
    session,
    userMessage,
    kind,
    pageContext = null,
    tools = LEARNING_TOOLS,
    executeTool = null,
    responseFormat = null,
    temperature = null,
    attachmentGroup = null,
    modelOverride = null,
    webResearchEnabled = true,
    onDelta = null,
    onRoundEnd = null
  }) {
    this.cancel(sessionKey);
    const controller = new AbortController();
    this.controllers.set(sessionKey, controller);
    const requestId = `${sessionKey}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const plan = webResearchEnabled && kind === 'home' && this.webResearch?.resolve
      ? this.webResearch.resolve()
      : { native: false, tavily: true };
    const forceFirstSearch = Boolean(plan.native) && isTimelyQuery(userMessage);
    const baseTools = Array.isArray(tools) ? tools : [];
    const requestTools = plan.native
      ? [...baseTools.filter(tool => tool?.function?.name !== 'search_web'), { type: 'web_search' }]
      : plan.tavily
        ? baseTools
        : baseTools.filter(tool => tool?.function?.name !== 'search_web');
    const toItems = this.webResearch?.toItems;
    const buildArtifact = this.webResearch?.artifact || null;
    const pushResearchArtifact = (reply, artifacts) => {
      if (!plan.native || !Array.isArray(reply?.web_search_calls) || !reply.web_search_calls.length) return;
      if (artifacts.some(item => item?.type === 'research_sources')) return;
      if (typeof buildArtifact !== 'function') return;
      const artifact = buildArtifact(reply.web_search_calls);
      if (artifact) artifacts.push(artifact);
    };
    const buildMessages = toolResults => this.builder.build({
      kind,
      summary: session.summary,
      messages: session.messages,
      activities: session.activities || [],
      userMessage,
      pageContext,
      toolResults: toolResults || []
    });
    const notifyDelta = text => {
      if (typeof onDelta === 'function' && text) onDelta(text);
    };
    const call = async (messages, requestToolsForRound, phase, toolChoice = 'auto', requestModelOverride = modelOverride) => {
      if (plan.native) {
        if (typeof toItems !== 'function') throw new Error('当前联网配置缺少 Responses 消息转换器');
        const completion = await this.api.responsesCompletion(
          toItems(messages),
          {
            tools: requestToolsForRound || [],
            signal: controller.signal,
            toolChoice,
            ...(requestModelOverride ? { modelOverride: requestModelOverride } : {}),
            ...(typeof onDelta === 'function' ? { onDelta: notifyDelta } : {})
          }
        );
        if (kind === 'home' && completion?.usage) {
          this.telemetry?.record({ requestId, phase, usage: completion.usage });
        }
        return completion || { role: 'assistant', content: '' };
      }
      const chatTools = (requestToolsForRound || []).filter(tool => tool?.type === 'function');
      const options = {
        tools: chatTools,
        signal: controller.signal,
        ...(responseFormat ? { responseFormat } : {}),
        ...(Number.isFinite(temperature) ? { temperature } : {}),
        ...(requestModelOverride ? { modelOverride: requestModelOverride } : {})
      };
      if (typeof onDelta === 'function' && typeof this.api.chatCompletionStream === 'function') {
        const assembler = createStreamAssembler();
        let streamedAnything = false;
        try {
          const streamResult = await this.api.chatCompletionStream(messages, options, event => {
            const delta = event?.choices?.[0]?.delta;
            if (typeof delta?.content === 'string' && delta.content) {
              streamedAnything = true;
              assembler.addContentDelta(delta.content);
              notifyDelta(delta.content);
            }
            if (Array.isArray(delta?.tool_calls)) assembler.addToolCallFragments(delta.tool_calls);
          });
          const message = assembler.finishMessage();
          if (kind === 'home' && streamResult?.usage) {
            this.telemetry?.record({ requestId, phase, usage: streamResult.usage });
          }
          return message;
        } catch (error) {
          // A failure before any visible delta can safely retry without
          // streaming (gateways that reject stream:true); a mid-stream
          // failure must surface instead of duplicating output.
          if (streamedAnything || error?.name === 'AbortError' || controller.signal.aborted) throw error;
        }
      }
      const completion = typeof this.api.chatCompletion === 'function'
        ? await this.api.chatCompletion(messages, options)
        : { message: await this.api.chat(messages, options), usage: null };
      if (kind === 'home' && completion?.usage) {
        this.telemetry?.record({ requestId, phase, usage: completion.usage });
      }
      return completion?.message || { role: 'assistant', content: '' };
    };
    const callAndNotify = async (messages, requestToolsForRound, phase, toolChoice = 'auto', requestModelOverride = modelOverride) => {
      const reply = await call(messages, requestToolsForRound, phase, toolChoice, requestModelOverride);
      if (typeof onRoundEnd === 'function') {
        try { onRoundEnd(reply); } catch {}
      }
      return reply;
    };

    try {
      let reply;
      let toolSupport = null;
      let transcript = assembleChatMessages({ messages: buildMessages(), attachmentGroup });
      try {
        reply = await callAndNotify(transcript, requestTools, 'initial', forceFirstSearch ? { type: 'web_search' } : 'auto');
      } catch (error) {
        const canUsePureTextVisionFallback = !attachmentGroup
          && modelOverride === 'deepseek-v4-flash-vision-exp'
          && typeof this.api.isVisionModelUnavailable === 'function'
          && this.api.isVisionModelUnavailable(error);
        if (canUsePureTextVisionFallback) {
          reply = await callAndNotify(transcript, requestTools, 'vision_text_fallback', 'auto', 'deepseek-v4-flash');
        } else {
          if (!toolsUnsupported(error)) throw error;
          toolSupport = 'unsupported';
          transcript = assembleChatMessages({
            messages: buildMessages([await this.agent.getLearningOverview()]),
            attachmentGroup
          });
          reply = await callAndNotify(transcript, [], 'fallback');
        }
      }

      const artifacts = [];
      pushResearchArtifact(reply, artifacts);
      const toolRunner = executeTool || (async (name, args) => ({ result: await this.agent.execute(name, args) }));
      let activeTools = requestTools;
      for (let round = 0; round < 3 && reply.tool_calls?.length; round += 1) {
        const runToolCall = async toolCall => {
          const name = toolCall?.function?.name;
          let handled;
          try {
            handled = await toolRunner(name, JSON.parse(toolCall?.function?.arguments || '{}'), { signal: controller.signal });
          } catch (error) {
            if (controller.signal.aborted) throw error;
            if (isReadingGenerationCall(toolCall)) {
              handled = { result: { status: 'tool_error' }, artifact: generationToolFailure() };
            } else if (isReadingCardImportCall(toolCall)) {
              handled = { result: { status: 'import_failed', reason: String(error?.message || '').slice(0, 200) } };
            } else if (isGuidedLearningCall(toolCall)) {
              handled = { result: { status: 'tool_error' }, artifact: guidedLearningToolFailure() };
            } else {
              throw error;
            }
          }
          if (handled.artifact) artifacts.push(handled.artifact);
          return { call: toolCall, name, result: handled.result };
        };
        // A write tool is deliberately serialized and takes precedence over
        // unrelated calls in the same model turn. This preserves the current
        // request authorization boundary and prevents a failing read from
        // hiding an already-created article.
        const generationCall = reply.tool_calls.find(isReadingGenerationCall);
        const importCall = reply.tool_calls.find(isReadingCardImportCall);
        const guidedLearningCall = reply.tool_calls.find(isGuidedLearningCall);
        const writeCall = importCall || generationCall || guidedLearningCall;
        const callsToRun = writeCall ? [writeCall] : reply.tool_calls;
        const toolResults = await Promise.all(callsToRun.map(runToolCall));
        if (artifacts.some(item => item.type === 'article')) {
          const imported = artifacts.find(item => item.type === 'article' && item.source === 'import');
          if (imported) {
            return completeReply(imported.importStatus === 'duplicate'
              ? '这篇文章已经在书库里，点击卡片可以直接阅读。'
              : '已把文章保存为阅读卡片，点击卡片开始阅读。', artifacts, toolSupport);
          }
          return completeReply('已生成一篇定制阅读，点击卡片开始阅读。', artifacts, toolSupport);
        }
        if (artifacts.some(item => item.type === 'generation_failure')) {
          return completeReply('', artifacts, toolSupport);
        }
        if (artifacts.some(item => item.type === 'generation_blocked')) {
          return completeReply('', artifacts, toolSupport);
        }
        if (artifacts.some(item => item.type === 'guided_learning')) {
          return completeReply('', artifacts, toolSupport);
        }
        if (artifacts.some(item => item.type === 'guided_learning_update')) {
          return completeReply('', artifacts, toolSupport);
        }
        if (artifacts.some(item => item.type === 'guided_learning_failure')) {
          return completeReply('', artifacts, toolSupport);
        }
        if (generationCall) {
          activeTools = (plan.native ? baseTools : tools).filter(tool => tool?.function?.name !== 'generate_reading');
        }
        transcript = [
          ...transcript,
          assistantToolMessage(writeCall ? { ...reply, tool_calls: callsToRun } : reply),
          ...(reply.web_search_calls || []).map(item => ({ type: 'web_search_call', ...item })),
          ...toolResults.map(item => ({
            role: 'tool',
            tool_call_id: item.call?.id || '',
            name: item.name,
            content: safeToolContent(item.result)
          }))
        ];
        reply = await callAndNotify(transcript, activeTools, `tool_${round + 1}`);
        pushResearchArtifact(reply, artifacts);
      }

      return completeReply(String(reply.content || '').trim() || '我暂时没有生成有效回答，请换一种问法。', artifacts, toolSupport);
    } finally {
      if (this.controllers.get(sessionKey) === controller) this.controllers.delete(sessionKey);
    }
  }
}
