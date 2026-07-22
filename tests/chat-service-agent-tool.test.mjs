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
