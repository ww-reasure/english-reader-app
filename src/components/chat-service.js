import { LEARNING_TOOLS } from './learning-agent.js';

const toolsUnsupported = error => /tool|function|unsupported/i.test(String(error?.message || ''));
const isReadingGenerationCall = call => call?.function?.name === 'generate_reading';
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

  async ask({ sessionKey, session, userMessage, kind, pageContext = null, tools = LEARNING_TOOLS, executeTool = null }) {
    this.cancel(sessionKey);
    const controller = new AbortController();
    this.controllers.set(sessionKey, controller);
    const requestId = `${sessionKey}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const plan = kind === 'home' && this.webResearch?.resolve
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
    const call = async (messages, requestToolsForRound, phase, toolChoice = 'auto') => {
      if (plan.native) {
        if (typeof toItems !== 'function') throw new Error('当前联网配置缺少 Responses 消息转换器');
        const completion = await this.api.responsesCompletion(
          toItems(messages),
          { tools: requestToolsForRound || [], signal: controller.signal, toolChoice }
        );
        if (kind === 'home' && completion?.usage) {
          this.telemetry?.record({ requestId, phase, usage: completion.usage });
        }
        return completion || { role: 'assistant', content: '' };
      }
      const chatTools = (requestToolsForRound || []).filter(tool => tool?.type === 'function');
      const options = { tools: chatTools, signal: controller.signal };
      const completion = typeof this.api.chatCompletion === 'function'
        ? await this.api.chatCompletion(messages, options)
        : { message: await this.api.chat(messages, options), usage: null };
      if (kind === 'home' && completion?.usage) {
        this.telemetry?.record({ requestId, phase, usage: completion.usage });
      }
      return completion?.message || { role: 'assistant', content: '' };
    };

    try {
      let reply;
      let toolSupport = null;
      let transcript = buildMessages();
      try {
        reply = await call(transcript, requestTools, 'initial', forceFirstSearch ? { type: 'web_search' } : 'auto');
      } catch (error) {
        if (!toolsUnsupported(error)) throw error;
        toolSupport = 'unsupported';
        transcript = buildMessages([await this.agent.getLearningOverview()]);
        reply = await call(transcript, [], 'fallback');
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
            if (!isReadingGenerationCall(toolCall) || controller.signal.aborted) throw error;
            handled = { result: { status: 'tool_error' }, artifact: generationToolFailure() };
          }
          if (handled.artifact) artifacts.push(handled.artifact);
          return { call: toolCall, name, result: handled.result };
        };
        // A write tool is deliberately serialized and takes precedence over
        // unrelated calls in the same model turn. This preserves the current
        // request authorization boundary and prevents a failing read from
        // hiding an already-created article.
        const generationCall = reply.tool_calls.find(isReadingGenerationCall);
        const callsToRun = generationCall ? [generationCall] : reply.tool_calls;
        const toolResults = await Promise.all(callsToRun.map(runToolCall));
        if (artifacts.some(item => item.type === 'article')) {
          return completeReply('已生成一篇定制阅读，点击卡片开始阅读。', artifacts, toolSupport);
        }
        if (artifacts.some(item => item.type === 'generation_failure')) {
          return completeReply('', artifacts, toolSupport);
        }
        if (artifacts.some(item => item.type === 'generation_blocked')) {
          return completeReply('', artifacts, toolSupport);
        }
        if (generationCall) {
          activeTools = (plan.native ? baseTools : tools).filter(tool => tool?.function?.name !== 'generate_reading');
        }
        transcript = [
          ...transcript,
          assistantToolMessage(generationCall ? { ...reply, tool_calls: callsToRun } : reply),
          ...(reply.web_search_calls || []).map(item => ({ type: 'web_search_call', ...item })),
          ...toolResults.map(item => ({
            role: 'tool',
            tool_call_id: item.call?.id || '',
            name: item.name,
            content: safeToolContent(item.result)
          }))
        ];
        reply = await call(transcript, activeTools, `tool_${round + 1}`);
        pushResearchArtifact(reply, artifacts);
      }

      return completeReply(String(reply.content || '').trim() || '我暂时没有生成有效回答，请换一种问法。', artifacts, toolSupport);
    } finally {
      if (this.controllers.get(sessionKey) === controller) this.controllers.delete(sessionKey);
    }
  }
}