import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

async function loadStore() {
  const source = await readFile(new URL('../src/components/conversation-store.js', import.meta.url), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

function memory(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
}

test('migrates legacy chatHistory into home', async () => {
  const { ConversationStore } = await loadStore();
  const store = new ConversationStore(memory({
    chatHistory: JSON.stringify([
      { type: 'user', text: '帮我复习' },
      { type: 'article', article: { id: 7, title: 'A title' } }
    ])
  }), () => 1000);

  assert.deepEqual(store.getSession('home').messages.map(item => item.kind), ['text', 'article']);
});

test('keeps recent messages and expires stale article sessions', async () => {
  const { ConversationStore } = await loadStore();
  const store = new ConversationStore(memory(), () => 10 * 86400000);

  for (let index = 0; index < 10; index += 1) {
    store.append('home', { role: index % 2 ? 'assistant' : 'user', kind: 'text', content: '消息 ' + index });
  }

  assert.equal(store.compact('home', 4).recent.length, 4);
  assert.equal(store.getSession('home').messages.length, 4);
  store.replaceSession('reading:8', { updatedAt: 0, summary: '', messages: [] });
  store.pruneExpiredArticleSessions(7 * 86400000);
  assert.equal(store.hasSession('reading:8'), false);
});

test('compacts home article and failure events into a safe, concise summary', async () => {
  const { ConversationStore } = await loadStore();
  const store = new ConversationStore(memory(), () => 1000);

  store.append('home', { role: 'assistant', kind: 'article', article: {
    title: 'A Saved Reading',
    titleZh: '一篇已保存阅读',
    difficulty: 'cet4',
    topic: '科技',
    wordCount: 280,
    content: 'x'.repeat(5000)
  } });
  store.append('home', { role: 'assistant', kind: 'generation_failure', failure: {
    message: '第 2 篇缺少复习词，已跳过。',
    reason: 'validation_failed',
    generation: { difficulty: 'cet4', challenge: 'support', wordCount: 300 }
  } });
  for (let index = 0; index < 4; index += 1) {
    store.append('home', { role: 'user', kind: 'text', content: `消息 ${index}` });
  }

  const { summary } = store.compact('home', 2);
  assert.match(summary, /A Saved Reading/);
  assert.match(summary, /一篇已保存阅读/);
  assert.match(summary, /第 2 篇缺少复习词/);
  assert.equal(summary.includes('x'.repeat(300)), false);
});

test('replaces and removes a persisted generation failure by its stable id', async () => {
  const { ConversationStore } = await loadStore();
  const store = new ConversationStore(memory(), () => 1000);

  store.append('home', { id: 'request-1', role: 'user', kind: 'text', content: '生成一篇阅读' });
  store.append('home', {
    id: 'failure-1',
    role: 'assistant',
    kind: 'generation_failure',
    failure: { message: '初次校验失败' }
  });

  assert.equal(store.replaceMessage('home', message => message.id === 'failure-1', message => ({
    ...message,
    failure: { message: '重试后校验失败' }
  })), true);
  assert.equal(store.getSession('home').messages.length, 2);
  assert.equal(store.getSession('home').messages[1].failure.message, '重试后校验失败');

  assert.equal(store.removeMessages('home', message => message.id === 'failure-1'), 1);
  assert.deepEqual(store.getSession('home').messages.map(message => message.id), ['request-1']);
});
