import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadChatService() {
  const [source, multimodal] = await Promise.all([
    readFile(new URL('../src/components/chat-service.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/multimodal-context.mjs', import.meta.url), 'utf8')
  ]);
  const adapted = source
    .replace("import { LEARNING_TOOLS } from './learning-agent.js';", 'const LEARNING_TOOLS = [];')
    .replace("from './multimodal-context.mjs'", `from 'data:text/javascript;base64,${Buffer.from(multimodal).toString('base64')}'`);
  return import('data:text/javascript;base64,' + Buffer.from(adapted).toString('base64'));
}

const delta = (payload = {}) => ({ choices: [{ delta: payload }] });

const createService = async (api, { onDelta, onRoundEnd } = {}) => {
  const { ChatService } = await loadChatService();
  const service = new ChatService({
    api,
    agent: { getLearningOverview: async () => ({}), execute: async name => ({ source: name }) },
    builder: { build: () => [{ role: 'user', content: '你好' }] }
  });
  return service.ask({
    sessionKey: 'home', session: { summary: '', messages: [] }, userMessage: '你好', kind: 'home',
    tools: [], onDelta, onRoundEnd
  });
};

test('streams content deltas and assembles the final assistant message', async () => {
  const deltas = [];
  const reply = await createService({
    chatCompletionStream: async (_messages, _options, onEvent) => {
      onEvent(delta({ content: '你好' }));
      onEvent(delta({ content: '，世界' }));
      return { usage: { total_tokens: 5 } };
    },
    chatCompletion: async () => { throw new Error('non-stream path must not run'); }
  }, { onDelta: text => deltas.push(text) });

  assert.deepEqual(deltas, ['你好', '，世界']);
  assert.equal(reply.content, '你好，世界');
});

test('assembles streamed tool_calls fragments and runs the tool loop', async () => {
  let round = 0;
  const toolCalls = [];
  const reply = await createService({
    chatCompletionStream: async (_messages, _options, onEvent) => {
      round += 1;
      if (round === 1) {
        onEvent(delta({ tool_calls: [{ index: 0, id: 'call-1', function: { name: 'get_learning_overview', arguments: '' } }] }));
        onEvent(delta({ tool_calls: [{ index: 0, function: { arguments: '{}' } }] }));
      } else {
        onEvent(delta({ content: '你有 3 个待复习单词。' }));
      }
      return { usage: null };
    },
    chatCompletion: async () => { throw new Error('non-stream path must not run'); }
  }, {
    onDelta: () => {},
    onRoundEnd: reply => { if (reply?.tool_calls?.length) toolCalls.push(...reply.tool_calls); }
  });

  assert.deepEqual(toolCalls.map(call => call.function.name), ['get_learning_overview']);
  assert.equal(toolCalls[0].id, 'call-1');
  assert.equal(toolCalls[0].function.arguments, '{}');
  assert.equal(reply.content, '你有 3 个待复习单词。');
});

test('falls back to the non-streaming call when streaming fails before any delta', async () => {
  let streamAttempts = 0;
  const reply = await createService({
    chatCompletionStream: async () => {
      streamAttempts += 1;
      throw new Error('API error: 404 - stream unsupported');
    },
    chatCompletion: async () => ({ message: { role: 'assistant', content: '整段回答' }, usage: null })
  }, { onDelta: () => {} });

  assert.equal(streamAttempts, 1);
  assert.equal(reply.content, '整段回答');
});

test('rethrows a streaming failure that happens after deltas reached the view', async () => {
  await assert.rejects(
    () => createService({
      chatCompletionStream: async (_messages, _options, onEvent) => {
        onEvent(delta({ content: '半截' }));
        throw new Error('connection reset');
      },
      chatCompletion: async () => ({ message: { role: 'assistant', content: '不应出现' }, usage: null })
    }, { onDelta: () => {} }),
    /connection reset/
  );
});

test('round-end notifications fire for every model round', async () => {
  let round = 0;
  const rounds = [];
  const reply = await createService({
    chatCompletionStream: async (_messages, _options, onEvent) => {
      round += 1;
      if (round === 1) {
        onEvent(delta({ content: '我先查一下' }));
        onEvent(delta({ tool_calls: [{ index: 0, id: 't1', function: { name: 'get_learning_overview', arguments: '{}' } }] }));
      } else {
        onEvent(delta({ content: '查完了。' }));
      }
      return { usage: null };
    },
    chatCompletion: async () => { throw new Error('non-stream path must not run'); }
  }, {
    onDelta: () => {},
    onRoundEnd: reply => rounds.push({ content: reply.content, hasToolCalls: Boolean(reply.tool_calls?.length) })
  });

  assert.deepEqual(rounds, [
    { content: '我先查一下', hasToolCalls: true },
    { content: '查完了。', hasToolCalls: false }
  ]);
  assert.equal(reply.content, '查完了。');
});

test('without onDelta the service keeps using the whole-block request', async () => {
  let streamCalls = 0;
  const reply = await createService({
    chatCompletionStream: async () => { streamCalls += 1; return { usage: null }; },
    chatCompletion: async () => ({ message: { role: 'assistant', content: '整段回答' }, usage: null })
  });

  assert.equal(streamCalls, 0);
  assert.equal(reply.content, '整段回答');
});
