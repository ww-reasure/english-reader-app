import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadChatService() {
  const source = await readFile(new URL('../src/components/chat-service.js', import.meta.url), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source.replace("import { LEARNING_TOOLS } from './learning-agent.js';", 'const LEARNING_TOOLS = [];')).toString('base64'));
}

test('returns article artifacts immediately after a generation tool call', async () => {
  const { ChatService } = await loadChatService();
  const service = new ChatService({
    api: { chat: async () => ({ tool_calls: [{ function: { name: 'generate_reading', arguments: '{}' } }] }) },
    agent: { getLearningOverview: async () => ({}) },
    builder: { build: () => [] }
  });

  const reply = await service.ask({
    sessionKey: 'home', session: { summary: '', messages: [] }, userMessage: '根据我的弱点出一篇阅读', kind: 'home',
    tools: [{ function: { name: 'generate_reading' } }],
    executeTool: async () => ({ result: { id: 8 }, artifact: { type: 'article', article: { id: 8, title: 'Practice' } } })
  });

  assert.equal(reply.content, '已生成一篇定制阅读，点击卡片开始阅读。');
  assert.deepEqual(reply.artifacts, [{ type: 'article', article: { id: 8, title: 'Practice' } }]);
});

test('returns a generation failure artifact without asking the model to continue', async () => {
  const { ChatService } = await loadChatService();
  let chatCalls = 0;
  const service = new ChatService({
    api: {
      chat: async () => {
        chatCalls += 1;
        return { tool_calls: [{ function: { name: 'generate_reading', arguments: '{}' } }] };
      }
    },
    agent: { getLearningOverview: async () => ({}) },
    builder: { build: () => [] }
  });
  const failure = { message: '正文 221 词，目标 240-320 词。' };

  const reply = await service.ask({
    sessionKey: 'home', session: { summary: '', messages: [] }, userMessage: '根据我的弱点出一篇阅读', kind: 'home',
    tools: [{ function: { name: 'generate_reading' } }],
    executeTool: async () => ({ result: { status: 'validation_failed' }, artifact: { type: 'generation_failure', failure } })
  });

  assert.equal(chatCalls, 1);
  assert.equal(reply.content, '');
  assert.deepEqual(reply.artifacts, [{ type: 'generation_failure', failure }]);
});

test('returns to normal conversation when the home safety gate rejects a generation tool call', async () => {
  const { ChatService } = await loadChatService();
  const requests = [];
  const service = new ChatService({
    api: {
      chat: async (_messages, options) => {
        requests.push(options);
        return requests.length === 1
          ? { tool_calls: [{ id: 'blocked-1', type: 'function', function: { name: 'generate_reading', arguments: '{}' } }] }
          : { content: '这是一篇关于注意力与数字生活的说明文。' };
      }
    },
    agent: { getLearningOverview: async () => ({}) },
    builder: { build: () => [{ role: 'user', content: '这是一篇什么类型的文章' }] }
  });

  const reply = await service.ask({
    sessionKey: 'home', session: { summary: '', messages: [] }, userMessage: '这是一篇什么类型的文章', kind: 'home',
    tools: [{ function: { name: 'generate_reading' } }],
    executeTool: async () => ({ result: { status: 'generation_not_authorized' } })
  });

  assert.equal(reply.content, '这是一篇关于注意力与数字生活的说明文。');
  assert.deepEqual(reply.artifacts, []);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].tools, []);
});

test('executes only the first generate_reading call from one model turn', async () => {
  const { ChatService } = await loadChatService();
  const calls = [];
  const service = new ChatService({
    api: {
      chat: async () => ({
        tool_calls: [
          { function: { name: 'generate_reading', arguments: '{"request":"first"}' } },
          { function: { name: 'generate_reading', arguments: '{"request":"second"}' } }
        ]
      })
    },
    agent: { getLearningOverview: async () => ({}) },
    builder: { build: () => [] }
  });

  const reply = await service.ask({
    sessionKey: 'home', session: { summary: '', messages: [] }, userMessage: '生成阅读', kind: 'home',
    tools: [{ function: { name: 'generate_reading' } }],
    executeTool: async (_name, args) => {
      calls.push(args.request);
      return { result: { id: calls.length }, artifact: { type: 'article', article: { id: calls.length } } };
    }
  });

  assert.deepEqual(calls, ['first']);
  assert.deepEqual(reply.artifacts, [{ type: 'article', article: { id: 1 } }]);
});

test('returns a generated article before an unrelated read-only tool can fail the same turn', async () => {
  const { ChatService } = await loadChatService();
  const calls = [];
  const service = new ChatService({
    api: {
      chat: async () => ({
        tool_calls: [
          { function: { name: 'generate_reading', arguments: '{}' } },
          { id: 'read-1', type: 'function', function: { name: 'get_learning_overview', arguments: '{}' } }
        ]
      })
    },
    agent: { getLearningOverview: async () => ({}) },
    builder: { build: () => [] }
  });

  const reply = await service.ask({
    sessionKey: 'home', session: { summary: '', messages: [] }, userMessage: '生成练习', kind: 'home',
    tools: [{ function: { name: 'generate_reading' } }],
    executeTool: async name => {
      calls.push(name);
      if (name === 'generate_reading') {
        return { result: { id: 3 }, artifact: { type: 'article', article: { id: 3, title: 'Saved' } } };
      }
      throw new Error('read-only failed');
    }
  });

  assert.deepEqual(calls, ['generate_reading']);
  assert.equal(reply.content, '已生成一篇定制阅读，点击卡片开始阅读。');
  assert.deepEqual(reply.artifacts, [{ type: 'article', article: { id: 3, title: 'Saved' } }]);
});

test('converts generate_reading execution errors into a safe failure artifact', async () => {
  const { ChatService } = await loadChatService();
  let chatCalls = 0;
  const service = new ChatService({
    api: {
      chat: async () => {
        chatCalls += 1;
        return { tool_calls: [{ function: { name: 'generate_reading', arguments: '{}' } }] };
      }
    },
    agent: { getLearningOverview: async () => ({}) },
    builder: { build: () => [] }
  });

  const reply = await service.ask({
    sessionKey: 'home', session: { summary: '', messages: [] }, userMessage: '生成阅读', kind: 'home',
    tools: [{ function: { name: 'generate_reading' } }],
    executeTool: async () => {
      throw new Error('provider rejected request: secret diagnostic');
    }
  });

  assert.deepEqual(reply, {
    content: '',
    artifacts: [{
      type: 'generation_failure',
      failure: { message: '文章定制暂时失败，请重新生成。', reason: 'tool_error' }
    }]
  });
  assert.equal(chatCalls, 1);
  assert.doesNotMatch(JSON.stringify(reply), /secret diagnostic/);
});

test('converts malformed generate_reading arguments into the same safe failure artifact', async () => {
  const { ChatService } = await loadChatService();
  let toolCalls = 0;
  const service = new ChatService({
    api: { chat: async () => ({ tool_calls: [{ function: { name: 'generate_reading', arguments: '{broken-json' } }] }) },
    agent: { getLearningOverview: async () => ({}) },
    builder: { build: () => [] }
  });

  const reply = await service.ask({
    sessionKey: 'home', session: { summary: '', messages: [] }, userMessage: '生成阅读', kind: 'home',
    tools: [{ function: { name: 'generate_reading' } }],
    executeTool: async () => {
      toolCalls += 1;
      return { result: {} };
    }
  });

  assert.equal(toolCalls, 0);
  assert.deepEqual(reply, {
    content: '',
    artifacts: [{
      type: 'generation_failure',
      failure: { message: '文章定制暂时失败，请重新生成。', reason: 'tool_error' }
    }]
  });
});

test('continues ordinary read-only tool calls through the model loop', async () => {
  const { ChatService } = await loadChatService();
  const requests = [];
  const service = new ChatService({
    api: {
      chat: async (messages, options) => {
        requests.push({ messages, options });
        return requests.length === 1
          ? { tool_calls: [{ id: 'read-1', type: 'function', function: { name: 'get_learning_overview', arguments: '{}' } }] }
          : { content: '你有 3 个待复习单词。' };
      }
    },
    agent: {
      getLearningOverview: async () => ({ due: 3 }),
      execute: async name => ({ source: name, due: 3 })
    },
    builder: { build: () => [{ role: 'user', content: '我的学习情况' }] }
  });

  const reply = await service.ask({
    sessionKey: 'home', session: { summary: '', messages: [] }, userMessage: '我的学习情况', kind: 'home'
  });

  assert.equal(reply.content, '你有 3 个待复习单词。');
  assert.deepEqual(reply.artifacts, []);
  assert.deepEqual(requests[1].options.tools, []);
  assert.equal(requests[1].messages[1].role, 'assistant');
  assert.equal(requests[1].messages[1].tool_calls[0].id, 'read-1');
  assert.deepEqual(requests[1].messages[2], {
    role: 'tool', tool_call_id: 'read-1', name: 'get_learning_overview',
    content: JSON.stringify({ source: 'get_learning_overview', due: 3 })
  });
});
