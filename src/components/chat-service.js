import { LEARNING_TOOLS } from './learning-agent.js';

const toolsUnsupported = error => /tool|function|unsupported/i.test(String(error?.message || ''));
const isReadingGenerationCall = call => call?.function?.name === 'generate_reading';
const generationToolFailure = () => ({
  type: 'generation_failure',
  failure: { message: '文章定制暂时失败，请重新生成。', reason: 'tool_error' }
});

export class ChatService {
  constructor({ api, agent, builder }) {
    this.api = api;
    this.agent = agent;
    this.builder = builder;
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
    const request = input => this.api.chat(
      this.builder.build({
        kind,
        summary: session.summary,
        messages: session.messages,
        userMessage,
        pageContext,
        toolResults: input.toolResults || []
      }),
      { tools: input.tools || [], signal: controller.signal }
    );

    try {
      let reply;
      try {
        reply = await request({ tools });
      } catch (error) {
        if (!toolsUnsupported(error)) throw error;
        reply = await request({ toolResults: [await this.agent.getLearningOverview()] });
      }

      const artifacts = [];
      const toolRunner = executeTool || (async (name, args) => ({ result: await this.agent.execute(name, args) }));
      for (let round = 0; round < 3 && reply.tool_calls?.length; round += 1) {
        const runToolCall = async call => {
          const name = call?.function?.name;
          let handled;
          try {
            handled = await toolRunner(name, JSON.parse(call?.function?.arguments || '{}'), { signal: controller.signal });
          } catch (error) {
            if (!isReadingGenerationCall(call) || controller.signal.aborted) throw error;
            handled = { result: { status: 'tool_error' }, artifact: generationToolFailure() };
          }
          if (handled.artifact) artifacts.push(handled.artifact);
          return { tool: name, result: handled.result };
        };
        const generationCall = reply.tool_calls.find(isReadingGenerationCall);
        if (generationCall) {
          const toolResult = await runToolCall(generationCall);
          if (artifacts.some(item => item.type === 'article')) {
            return { content: '已生成一篇定制阅读，点击卡片开始阅读。', artifacts };
          }
          if (artifacts.some(item => item.type === 'generation_failure')) {
            return { content: '', artifacts };
          }
          reply = await request({ toolResults: [toolResult] });
          continue;
        }

        const toolResults = await Promise.all(reply.tool_calls.map(runToolCall));
        if (artifacts.some(item => item.type === 'article')) {
          return { content: '已生成一篇定制阅读，点击卡片开始阅读。', artifacts };
        }
        if (artifacts.some(item => item.type === 'generation_failure')) {
          return { content: '', artifacts };
        }
        reply = await request({ toolResults });
      }

      return { content: String(reply.content || '').trim() || '我暂时没有生成有效回答，请换一种问法。', artifacts };
    } finally {
      if (this.controllers.get(sessionKey) === controller) this.controllers.delete(sessionKey);
    }
  }
}
