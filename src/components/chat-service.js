import { LEARNING_TOOLS } from './learning-agent.js';

const toolsUnsupported = error => /tool|function|unsupported/i.test(String(error?.message || ''));

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

  async ask({ sessionKey, session, userMessage, kind, pageContext = null }) {
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
        reply = await request({ tools: LEARNING_TOOLS });
      } catch (error) {
        if (!toolsUnsupported(error)) throw error;
        reply = await request({ toolResults: [await this.agent.getLearningOverview()] });
      }

      for (let round = 0; round < 3 && reply.tool_calls?.length; round += 1) {
        const toolResults = await Promise.all(reply.tool_calls.map(async call => ({
          tool: call.function.name,
          result: await this.agent.execute(call.function.name, JSON.parse(call.function.arguments || '{}'))
        })));
        reply = await request({ toolResults });
      }

      return { content: String(reply.content || '').trim() || '我暂时没有生成有效回答，请换一种问法。' };
    } finally {
      if (this.controllers.get(sessionKey) === controller) this.controllers.delete(sessionKey);
    }
  }
}
