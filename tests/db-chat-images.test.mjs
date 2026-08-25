import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { indexedDB } from 'fake-indexeddb';

let sequence = 0;

async function loadDatabaseModule() {
  const source = await readFile(new URL('../src/db.js', import.meta.url), 'utf8');
  const metadataUrl = new URL('../src/cloud-article-metadata.mjs', import.meta.url).href;
  const learningDayUrl = new URL('../src/learning-day.mjs', import.meta.url).href;
  const learningActivityUrl = new URL('../src/learning-activity.mjs', import.meta.url).href;
  const externalSchedulerUrl = new URL('../src/external-review-scheduler.mjs', import.meta.url).href;
  const vocabularyLibraryUrl = new URL('../src/vocabulary-library.mjs', import.meta.url).href;
  const adapted = source
    .replace("import { getStemForm } from './helpers.js';", "const getStemForm = word => String(word || '').trim().toLowerCase();")
    .replace("from './cloud-article-metadata.mjs'", `from '${metadataUrl}'`)
    .replace("from './learning-day.mjs'", `from '${learningDayUrl}'`)
    .replace("from './learning-activity.mjs'", `from '${learningActivityUrl}'`)
    .replace("from './external-review-scheduler.mjs'", `from '${externalSchedulerUrl}'`)
    .replace("from './vocabulary-library.mjs'", `from '${vocabularyLibraryUrl}'`);
  return import(`data:text/javascript;base64,${Buffer.from(adapted).toString('base64')}`);
}

async function createDatabase() {
  globalThis.indexedDB = indexedDB;
  const module = await loadDatabaseModule();
  module.DB.DB_NAME = `EnglishReaderChatImages-${process.pid}-${sequence++}`;
  return module.DB;
}

test('v19 creates chatImageAttachments without rewriting learning stores', async () => {
  const DB = await createDatabase();
  const db = await DB.open();
  assert.equal(db.version, 19);
  assert.equal(db.objectStoreNames.contains('chatImageAttachments'), true);
  for (const existing of ['vocabulary', 'learnWords', 'reviewEvents', 'knowledgeWords', 'articleCatalog']) {
    assert.equal(db.objectStoreNames.contains(existing), true, `existing store missing: ${existing}`);
  }
  const tx = db.transaction('chatImageAttachments', 'readonly');
  const store = tx.objectStore('chatImageAttachments');
  for (const index of ['groupId', 'conversationKey', 'status', 'createdAt', 'lastAccessedAt']) {
    assert.equal(store.indexNames.contains(index), true);
  }
  db.close();
});

test('attachment blobs round trip while group order remains stable', async () => {
  const DB = await createDatabase();
  const blob = new Blob(['image'], { type: 'image/jpeg' });
  await DB.putChatImageAttachment({
    id: 'img-1', groupId: 'group-1', conversationKey: 'home', order: 1,
    status: 'draft', blob, thumbnailBlob: blob, sizeBytes: blob.size,
    createdAt: 10, updatedAt: 10, lastAccessedAt: 10
  });
  await DB.putChatImageAttachment({
    id: 'img-0', groupId: 'group-1', conversationKey: 'home', order: 0,
    status: 'draft', blob, thumbnailBlob: blob, sizeBytes: blob.size,
    createdAt: 9, updatedAt: 9, lastAccessedAt: 9
  });
  assert.deepEqual((await DB.getChatImageGroup('group-1')).map(row => row.id), ['img-0', 'img-1']);
});

test('release removes full blob but keeps a safe placeholder and remote tombstone', async () => {
  const DB = await createDatabase();
  const blob = new Blob(['image'], { type: 'image/jpeg' });
  await DB.putChatImageAttachment({
    id: 'img-1', groupId: 'group-1', conversationKey: 'home', order: 0,
    status: 'sent', blob, thumbnailBlob: blob, sizeBytes: blob.size,
    remoteFileId: 'file-api-1', createdAt: 10, updatedAt: 10, lastAccessedAt: 10
  });
  await DB.releaseChatImageAttachment('img-1', { remoteDeletePending: true });
  const row = await DB.getChatImageAttachment('img-1');
  assert.equal(row.blob, null);
  assert.equal(row.status, 'delete_pending');
  assert.equal(row.remoteFileId, 'file-api-1');
});
