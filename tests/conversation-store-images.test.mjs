import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadStore() {
  const source = await readFile(new URL('../src/components/conversation-store.js', import.meta.url), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

async function loadBuilder() {
  const source = await readFile(new URL('../src/components/context-builder.js', import.meta.url), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    values
  };
};

const seededImageConversation = async count => {
  const { ConversationStore } = await loadStore();
  let now = 100;
  const storage = memoryStorage();
  const store = new ConversationStore(storage, () => ++now);
  for (let index = 0; index < count; index += 1) {
    store.append('home', {
      id: `user-${index}`, role: 'user', kind: 'text', content: `讲解图片 ${index}`,
      imageGroup: {
        groupId: `group-${index}`, attachmentIds: [`img-${index}`], count: 1,
        state: 'available', visualSummary: `第 ${index} 组英语阅读题`
      }
    });
    store.append('home', { id: `assistant-${index}`, role: 'assistant', kind: 'text', content: `讲解 ${index}` });
  }
  return store;
};

test('image messages keep references but reject blobs and data URLs', async () => {
  const { ConversationStore } = await loadStore();
  const storage = memoryStorage();
  const store = new ConversationStore(storage, () => 100);
  store.append('home', {
    id: 'msg-1', role: 'user', kind: 'text', content: '讲解图片',
    imageGroup: {
      groupId: 'group-1', attachmentIds: ['img-1'], count: 1,
      state: 'available', visualSummary: '一张英语阅读题截图',
      blob: new Blob(['private']), inlineDataUrl: 'data:image/jpeg;base64,secret',
      remoteFileId: 'file-api-secret'
    }
  });
  const raw = storage.getItem('learningConversationsV2');
  assert.match(raw, /group-1/);
  assert.doesNotMatch(raw, /data:image|base64|Blob|file-api-secret|remoteFileId/);
  assert.deepEqual(store.getSession('home').messages[0].imageGroup, {
    groupId: 'group-1', attachmentIds: ['img-1'], count: 1,
    state: 'available', visualSummary: '一张英语阅读题截图'
  });
});

test('archived image rounds contribute a bounded visual summary', async () => {
  const store = await seededImageConversation(30);
  store.maintainHomeConversation({ contextMaxRounds: 24, batchRounds: 8 });
  const session = store.getContextSession('home');
  assert.match(session.contextSummary, /图片组/);
  assert.match(session.contextSummary, /英语阅读题/);
  assert.equal(session.contextSummary.length <= 6000, true);
});

test('released image groups are summarized with an explicit placeholder state', async () => {
  const { ConversationStore } = await loadStore();
  const store = new ConversationStore(memoryStorage(), () => 100);
  store.append('home', {
    role: 'user', kind: 'text', content: '继续看刚才的图片',
    imageGroup: {
      groupId: 'group-released', attachmentIds: ['img-1'], count: 1,
      state: 'released', visualSummary: '原图是一道阅读题'
    }
  });
  store.compact('home', 0);
  assert.match(store.getSession('home').summary, /原图已释放/);
});

test('ContextBuilder includes summaries as text and never image storage fields', async () => {
  const { ContextBuilder } = await loadBuilder();
  const builder = new ContextBuilder();
  const messages = builder.build({
    kind: 'home', userMessage: '换个话题',
    messages: [{ role: 'user', kind: 'text', content: '图片问题', imageGroup: {
      groupId: 'group-1', attachmentIds: ['img-1'], visualSummary: '图片是一道阅读题'
    }}]
  });
  const serialized = JSON.stringify(messages);
  assert.match(serialized, /图片是一道阅读题/);
  assert.match(serialized, /历史图片摘要/);
  assert.doesNotMatch(serialized, /attachmentIds|remoteFileId|data:image/);
});
