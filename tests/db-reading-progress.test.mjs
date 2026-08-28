import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { indexedDB } from 'fake-indexeddb';

let databaseSequence = 0;

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

async function createDatabase(name = `EnglishReaderProgress-${process.pid}-${databaseSequence++}`) {
  globalThis.indexedDB = indexedDB;
  const module = await loadDatabaseModule();
  module.DB.DB_NAME = name;
  return module;
}

async function seedV21(name) {
  await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 21);
    request.onupgradeneeded = event => {
      const db = event.target.result;
      const stats = db.createObjectStore('readingStats', { keyPath: 'id', autoIncrement: true });
      stats.createIndex('createdAt', 'createdAt');
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('readingStats', 'readwrite');
      tx.objectStore('readingStats').add({ articleId: 77, activeSeconds: 12, createdAt: 123 });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

test('v21 to v22 adds readingProgress without migrating or deleting readingStats', async () => {
  const name = `EnglishReaderProgressUpgrade-${process.pid}-${databaseSequence++}`;
  globalThis.indexedDB = indexedDB;
  await seedV21(name);
  const { DB } = await createDatabase(name);
  assert.equal(DB.DB_VERSION, 22);
  const db = await DB.open();
  assert.equal(db.objectStoreNames.contains('readingProgress'), true);
  assert.equal((await DB.getAllReadingStats()).length, 1);
  db.close();
});

test('readingProgress CRUD is keyed by article and does not touch readingStats', async () => {
  const { DB } = await createDatabase();
  const progress = {
    articleId: 12,
    version: 1,
    contentFingerprint: 'reading-v1-test',
    status: 'in_progress',
    startedAt: 100,
    updatedAt: 200,
    lastReadAt: 200,
    activeSeconds: 90,
    full: { maxProgress: 0.25, paragraphIndex: 1, sentenceIndex: 2 },
    guide: { lastIndex: 2, visitedIndexes: [0, 2], totalSentences: 10 }
  };
  await DB.saveReadingProgress(progress);
  assert.deepEqual(await DB.getReadingProgress(12), progress);
  await DB.deleteReadingProgress(12);
  assert.equal(await DB.getReadingProgress(12), null);
  assert.deepEqual(await DB.getAllReadingStats(), []);
});
