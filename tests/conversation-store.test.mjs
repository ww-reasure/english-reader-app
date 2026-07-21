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
