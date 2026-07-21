import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

async function loadService() {
  const source = await readFile(new URL('../src/components/chat-service.js', import.meta.url), 'utf8');
  const testSource = source.replace(
    "import { LEARNING_TOOLS } from './learning-agent.js';",
    "const LEARNING_TOOLS = [{ type: 'function', function: { name: 'get_learning_overview' } }];"
  );
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
  assert.equal(calls.length, 2);
});
