import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  collectImageObjectUrls,
  compactPersistentHomeMessageNodes,
  releaseRemovedImageObjectUrls
} from '../src/home-runtime-resource-compaction.mjs';

async function loadStore() {
  const source = await readFile(new URL('../src/components/conversation-store.js', import.meta.url), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    values
  };
}

function fakeNode(messageId, imageUrls = [], { transient = false } = {}) {
  let removed = false;
  const listeners = new Set();
  const images = imageUrls.map(src => ({
    currentSrc: src,
    getAttribute: name => name === 'src' ? src : null
  }));
  return {
    dataset: messageId && !transient ? { homeMessageId: messageId } : {},
    imageUrls,
    querySelectorAll: selector => selector === 'img[src]' ? images : [],
    addEventListener: (type, listener) => listeners.add(`${type}:${listener}`),
    remove: () => { removed = true; },
    get removed() { return removed; },
    get listenerCount() { return listeners.size; }
  };
}

test('home maintenance exposes stable retained and removed message identities', async () => {
  const { ConversationStore } = await loadStore();
  let now = 1000;
  const store = new ConversationStore(memoryStorage(), () => ++now);

  for (let turn = 0; turn < 52; turn += 1) {
    store.append('home', { role: 'user', kind: 'text', content: `问题 ${turn}` });
    store.append('home', { role: 'assistant', kind: 'text', content: `回答 ${turn}` });
    store.maintainHomeConversation();
  }

  const maintenance = store.maintainHomeConversation();
  const session = store.getSession('home');
  const retained = session.messages.map(message => message.id || `daily:${message.reportId}`);

  assert.equal(maintenance.trimmed, false);
  assert.deepEqual(maintenance.retainedMessageIds, retained);
  assert.equal(new Set(retained).size, retained.length);
  assert.equal(session.messages.filter(message => message.role === 'user').length, 50);
  assert.ok(maintenance.removedMessageIds.length === 0);

  const firstRetainedId = session.messages[0].id;
  store.append('home', { role: 'user', kind: 'text', content: '最后一个问题' });
  const trimmed = store.maintainHomeConversation();
  assert.equal(trimmed.trimmed, true);
  assert.ok(trimmed.removedMessageIds.includes(firstRetainedId));
  assert.equal(store.getSession('home').messages.at(-1).content, '最后一个问题');
});

test('stable identities survive a leave and re-enter cycle', async () => {
  const { ConversationStore } = await loadStore();
  const storage = memoryStorage();
  let now = 2000;
  const first = new ConversationStore(storage, () => ++now);
  first.append('home', { role: 'user', kind: 'text', content: '保留我的身份' });
  first.append('home', { role: 'assistant', kind: 'article', article: { id: 'a-1', title: 'Article' } });
  const firstIds = first.getSession('home').messages.map(message => message.id);

  const second = new ConversationStore(storage, () => ++now);
  assert.deepEqual(second.getSession('home').messages.map(message => message.id), firstIds);
});

test('DOM compaction removes only stale persistent nodes and keeps transient and retained cards interactive', () => {
  const stale = fakeNode('message-old');
  const retained = fakeNode('message-new');
  const transient = fakeNode('', [], { transient: true });
  let removedIds = [];

  compactPersistentHomeMessageNodes({
    nodes: [stale, retained, transient],
    retainedMessageIds: ['message-new'],
    onRemove: (_node, messageId) => { removedIds.push(messageId); }
  });

  assert.deepEqual(removedIds, ['message-old']);
  assert.equal(stale.removed, true);
  assert.equal(retained.removed, false);
  assert.equal(transient.removed, false);
  assert.equal(retained.listenerCount, 0);
});

test('100+ rounds do not leave an unbounded persistent DOM list', () => {
  const nodes = Array.from({ length: 120 }, (_item, index) => fakeNode(`message-${index}`));
  const retainedIds = Array.from({ length: 50 }, (_item, index) => `message-${index + 70}`);
  compactPersistentHomeMessageNodes({ nodes, retainedMessageIds: retainedIds });

  assert.equal(nodes.filter(node => !node.removed).length, 50);
  assert.equal(nodes.filter(node => node.removed).length, 70);
});

test('removing a historical image message revokes only its unused history URL', () => {
  const old = fakeNode('message-old', ['blob:old']);
  const draft = fakeNode('', ['blob:draft'], { transient: true });
  const urlMap = new Map([
    ['history:old-image', 'blob:old'],
    ['draft:image', 'blob:draft']
  ]);
  const revoked = [];

  const removed = compactPersistentHomeMessageNodes({
    nodes: [old, draft],
    retainedMessageIds: [],
    onRemove: node => {
      const urls = collectImageObjectUrls(node);
      node.remove();
      releaseRemovedImageObjectUrls({ urlMap, urls, stillUsedUrls: [], revoke: url => revoked.push(url) });
    }
  });

  assert.deepEqual(removed.map(item => item.messageId), ['message-old']);
  assert.deepEqual(revoked, ['blob:old']);
  assert.equal(urlMap.get('draft:image'), 'blob:draft');
});

test('a history URL still used by another card is not revoked', () => {
  const urlMap = new Map([['history:shared', 'blob:shared']]);
  const revoked = [];
  releaseRemovedImageObjectUrls({
    urlMap,
    urls: new Set(['blob:shared']),
    stillUsedUrls: new Set(['blob:shared']),
    revoke: url => revoked.push(url)
  });

  assert.deepEqual(revoked, []);
  assert.equal(urlMap.get('history:shared'), 'blob:shared');
});

test('chat uses Store retention identities instead of a raw DOM count', async () => {
  const source = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');
  assert.match(source, /compactPersistentHomeMessageNodes/);
  assert.match(source, /retainedMessageIds/);
  assert.match(source, /data-home-message-id/);
  assert.match(source, /message\.kind === 'article'[\s\S]*messageId/);
  assert.match(source, /message\.kind === 'daily_report'[\s\S]*messageId/);
  assert.doesNotMatch(source, /children\.length\s*>|querySelectorAll\(['"]\.message['"]\)\.slice/);
});
