import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

async function loadService() {
  const [source, multimodal] = await Promise.all([
    readFile(new URL('../src/components/chat-service.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/multimodal-context.mjs', import.meta.url), 'utf8')
  ]);
  const testSource = source.replace(
    "import { LEARNING_TOOLS } from './learning-agent.js';",
    "const LEARNING_TOOLS = [{ type: 'function', function: { name: 'get_learning_overview' } }];"
  ).replace("from './multimodal-context.mjs'", `from 'data:text/javascript;base64,${Buffer.from(multimodal).toString('base64')}'`);
  return import('data:text/javascript;base64,' + Buffer.from(testSource).toString('base64'));
}

test('retries once without tools after a tools-unsupported response', async () => {
  const { ChatService } = await loadService();
  const calls = [];
  const service = new ChatService({
    api: {
      chat: async (_messages, options) => {
        calls.push(options);
        if (options.tools?.length) throw new Error('API error: 400 - tools unsupported');
        return { content: '你有 2 个待复习词' };
      }
    },
    agent: { getLearningOverview: async () => ({ source: 'learning_overview', totals: { due: 2 } }) },
    builder: { build: input => [{ role: 'user', content: JSON.stringify(input.toolResults || []) }] }
  });

  const reply = await service.ask({
    sessionKey: 'home',
    session: { summary: '', messages: [] },
    userMessage: '今天学什么',
    kind: 'home'
  });

  assert.equal(reply.content, '你有 2 个待复习词');
  assert.equal(reply.toolSupport, 'unsupported');
  assert.equal(calls.length, 2);
});

test('forwards the home activity ledger to the context builder with the same session as chat messages', async () => {
  const { ChatService } = await loadService();
  let built = null;
  const service = new ChatService({
    api: { chat: async () => ({ content: '我知道刚才的结果。' }) },
    agent: {},
    builder: { build: input => { built = input; return []; } }
  });
  const activities = [{ type: 'generation', status: 'success', elapsedMs: 1200 }];

  await service.ask({
    sessionKey: 'home',
    session: { summary: '', messages: [], activities },
    userMessage: '刚才花了多久？',
    kind: 'home',
    tools: []
  });

  assert.deepEqual(built.activities, activities);
});

test('forwards an explicit structured response format to the API without changing normal chat flow', async () => {
  const { ChatService } = await loadService();
  let capturedOptions = null;
  const service = new ChatService({
    api: {
      chatCompletion: async (_messages, options) => {
        capturedOptions = options;
        return { message: { role: 'assistant', content: '{"trainingScore":7}' } };
      }
    },
    agent: {},
    builder: { build: () => [{ role: 'user', content: 'score it' }] }
  });

  await service.ask({
    sessionKey: 'exam:attempt:q46',
    session: { summary: '', messages: [] },
    userMessage: 'score it',
    kind: 'translation_training_feedback',
    tools: [],
    responseFormat: { type: 'json_object' }
  });

  assert.deepEqual(capturedOptions.responseFormat, { type: 'json_object' });
  assert.deepEqual(capturedOptions.tools, []);
});

test('tool rounds use the standard assistant tool_calls followed by matching tool messages', async () => {
  const { ChatService } = await loadService();
  const requests = [];
  const telemetry = [];
  const service = new ChatService({
    api: {
      chatCompletion: async messages => {
        requests.push(messages);
        if (requests.length === 1) {
          return {
            message: {
              role: 'assistant',
              content: '',
              reasoning_content: 'private chain state',
              tool_calls: [{ id: 'call-7', type: 'function', function: { name: 'get_learning_overview', arguments: '{}' } }]
            },
            usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 60, prompt_cache_miss_tokens: 40 }
          };
        }
        return { message: { role: 'assistant', content: '今天先复习。' }, usage: { prompt_tokens: 130 } };
      }
    },
    agent: { execute: async () => ({ source: 'learning_overview', totals: { due: 3 } }) },
    builder: { build: () => [{ role: 'system', content: 'stable' }, { role: 'user', content: '今天学什么' }] },
    telemetry: { record: row => telemetry.push(row) }
  });

  const reply = await service.ask({
    sessionKey: 'home', session: { summary: '', messages: [] }, userMessage: '今天学什么', kind: 'home'
  });

  assert.equal(reply.content, '今天先复习。');
  assert.deepEqual(requests[1][2], {
    role: 'assistant', content: '', reasoning_content: 'private chain state',
    tool_calls: [{ id: 'call-7', type: 'function', function: { name: 'get_learning_overview', arguments: '{}' } }]
  });
  assert.equal(requests[1][3].role, 'tool');
  assert.equal(requests[1][3].tool_call_id, 'call-7');
  assert.equal(requests[1][3].name, 'get_learning_overview');
  assert.equal(telemetry.length, 2);
});

test('native web research routes home chat through responsesCompletion and passes web_search_call back', async () => {
  const { ChatService } = await loadService();
  const calls = [];
  const service = new ChatService({
    api: {
      responsesCompletion: async (items, options) => {
        calls.push({ items, options });
        if (calls.length === 1) {
          return {
            role: 'assistant',
            content: '我先查一下',
            tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'get_learning_overview', arguments: '{}' } }],
            web_search_calls: [{
              type: 'web_search_call',
              id: 'ws_1',
              status: 'completed',
              search_queries: [{ text: 'today news' }],
              search_results: [{ title: 'T', url: 'https://example.com/t' }]
            }]
          };
        }
        return { role: 'assistant', content: '今天新闻如下。', tool_calls: [] };
      }
    },
    agent: { execute: async () => ({ source: 'learning_overview', totals: { due: 1 } }) },
    builder: { build: () => [{ role: 'system', content: 'stable' }, { role: 'user', content: '查新闻' }] },
    webResearch: {
      resolve: () => ({ native: true, tavily: false, reason: '' }),
      toItems: messages => messages.map(message => {
        if (message.type === 'web_search_call') return { type: 'web_search_call', ...message };
        if (message.role === 'tool') return { type: 'function_call_output', call_id: message.tool_call_id, output: message.content };
        return { role: message.role, content: message.content };
      }),
      artifact: webSearchCalls => webSearchCalls.length
        ? { type: 'research_sources', native: true, status: 'ok', query: 'today news', searchedAt: 1, sources: [{ title: 'T', url: 'https://example.com/t', domain: 'example.com' }] }
        : null
    }
  });

  const reply = await service.ask({
    sessionKey: 'home',
    session: { summary: '', messages: [] },
    userMessage: '查新闻',
    kind: 'home',
    tools: [
      { type: 'function', function: { name: 'get_learning_overview' } },
      { type: 'function', function: { name: 'search_web' } }
    ]
  });

  assert.equal(reply.content, '今天新闻如下。');
  assert.ok(reply.artifacts.some(item => item.type === 'research_sources'));
  assert.ok(calls[0].options.tools.some(tool => tool.type === 'web_search'));
  assert.ok(!calls[0].options.tools.some(tool => tool.function?.name === 'search_web'));
  assert.deepEqual(calls[0].options.toolChoice, { type: 'web_search' });
  assert.ok(calls[1].items.some(item => item.type === 'web_search_call'));
  assert.ok(calls[1].items.some(item => item.type === 'function_call_output'));
});

test('off mode removes the search_web tool from the chat request', async () => {
  const { ChatService } = await loadService();
  const calls = [];
  const service = new ChatService({
    api: {
      chatCompletion: async (_messages, options) => {
        calls.push(options);
        return { message: { role: 'assistant', content: '好的。' }, usage: null };
      }
    },
    agent: {},
    builder: { build: () => [{ role: 'user', content: 'hi' }] },
    webResearch: { resolve: () => ({ native: false, tavily: false, reason: 'off' }) }
  });
  await service.ask({
    sessionKey: 'home', session: { summary: '', messages: [] }, userMessage: 'hi', kind: 'home',
    tools: [{ type: 'function', function: { name: 'search_web' } }, { type: 'function', function: { name: 'get_learning_overview' } }]
  });
  assert.ok(calls[0].tools.every(tool => tool.function?.name !== 'search_web'));
  assert.ok(calls[0].tools.some(tool => tool.function?.name === 'get_learning_overview'));
});

test('native web research keeps tool_choice auto for non-timely queries', async () => {
  const { ChatService } = await loadService();
  const calls = [];
  const service = new ChatService({
    api: {
      responsesCompletion: async (items, options) => {
        calls.push({ items, options });
        return { role: 'assistant', content: '这是词汇解释。', tool_calls: [] };
      }
    },
    agent: {},
    builder: { build: () => [{ role: 'user', content: '解释一下 consider 这个词' }] },
    webResearch: {
      resolve: () => ({ native: true, tavily: false, reason: '' }),
      toItems: messages => messages.map(message => ({ role: message.role, content: message.content })),
      artifact: () => null
    }
  });
  await service.ask({
    sessionKey: 'home', session: { summary: '', messages: [] }, userMessage: '解释一下 consider 这个词', kind: 'home', tools: []
  });
  assert.equal(calls[0].options.toolChoice, 'auto');
});
