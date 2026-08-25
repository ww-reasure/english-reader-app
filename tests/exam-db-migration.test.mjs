import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
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
    .replace(
      "import { getStemForm } from './helpers.js';",
      "const getStemForm = word => String(word || '').trim().toLowerCase();"
    )
    .replace("from './cloud-article-metadata.mjs'", `from '${metadataUrl}'`)
    .replace("from './learning-day.mjs'", `from '${learningDayUrl}'`)
    .replace("from './learning-activity.mjs'", `from '${learningActivityUrl}'`)
    .replace("from './external-review-scheduler.mjs'", `from '${externalSchedulerUrl}'`)
    .replace("from './vocabulary-library.mjs'", `from '${vocabularyLibraryUrl}'`);
  return import(`data:text/javascript;base64,${Buffer.from(adapted).toString('base64')}`);
}

function openVersion13(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 13);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('articles', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('learnWords', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('readingStats', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('articleCatalog', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

test('v19 migration preserves v13 data and creates exam, telemetry, and chat image stores', async () => {
  globalThis.indexedDB = indexedDB;
  const name = `EnglishReaderExamV14-${process.pid}-${sequence++}`;
  const legacy = await openVersion13(name);
  const write = legacy.transaction(['articles', 'learnWords', 'articleCatalog'], 'readwrite');
  write.objectStore('articles').put({ id: 7, title: 'Keep article' });
  write.objectStore('learnWords').put({ id: 8, word: 'retain', state: 'learning' });
  write.objectStore('articleCatalog').put({ key: 'cloud-main', version: 1 });
  await new Promise((resolve, reject) => {
    write.oncomplete = resolve;
    write.onerror = () => reject(write.error);
  });
  legacy.close();

  const module = await loadDatabaseModule();
  module.DB.DB_NAME = name;
  const upgraded = await module.DB.open();

  assert.equal(upgraded.version, 19);
  for (const storeName of ['examPackMeta', 'examBanks', 'examPapers', 'examUnits', 'examQuestions', 'examAttempts', 'examResponses', 'examWrongStates', 'examBookmarks', 'examTranslationReviews', 'learningActivityEvents', 'dailyLearningReports', 'chatImageAttachments']) {
    assert.equal(upgraded.objectStoreNames.contains(storeName), true);
  }
  upgraded.close();

  assert.equal((await module.DB.getArticle(7)).title, 'Keep article');
  assert.equal((await module.DB.findLearnWordById(8)).word, 'retain');
  assert.deepEqual(await module.DB.getArticleCatalog(), { key: 'cloud-main', version: 1 });
});

function openVersion16WithLegacyWrongState(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 16);
    request.onupgradeneeded = () => {
      const db = request.result;
      const wrong = db.createObjectStore('examWrongStates', { keyPath: 'key' });
      wrong.createIndex('examId', 'examId');
      wrong.createIndex('status', 'status');
      const translation = db.createObjectStore('examTranslationReviews', { keyPath: 'key' });
      translation.createIndex('examId', 'examId');
      translation.createIndex('status', 'status');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

test('v18 migrates legacy active wrong states into today due states and adds due indexes', async () => {
  globalThis.indexedDB = indexedDB;
  const name = `EnglishReaderExamV17-${process.pid}-${sequence++}`;
  const legacy = await openVersion16WithLegacyWrongState(name);
  const write = legacy.transaction('examWrongStates', 'readwrite');
  write.objectStore('examWrongStates').put({
    key: 'builtin_kaoyan_en1:kaoyan_en1_2026_q22',
    examId: 'kaoyan_en1',
    bankId: 'builtin_kaoyan_en1',
    questionKey: 'kaoyan_en1_2026_q22',
    status: 'active',
    createdAt: 123
  });
  await new Promise((resolve, reject) => {
    write.oncomplete = resolve;
    write.onerror = () => reject(write.error);
  });
  legacy.close();

  const module = await loadDatabaseModule();
  module.DB.DB_NAME = name;
  const upgraded = await module.DB.open();
  assert.equal(upgraded.version, 19);
  assert.equal(upgraded.transaction('examWrongStates').objectStore('examWrongStates').indexNames.contains('examIdStatusNextDueAt'), true);
  assert.equal(upgraded.transaction('examTranslationReviews').objectStore('examTranslationReviews').indexNames.contains('examIdStatusNextDueAt'), true);
  const migrated = await new Promise((resolve, reject) => {
    const tx = upgraded.transaction('examWrongStates', 'readonly');
    const request = tx.objectStore('examWrongStates').get('builtin_kaoyan_en1:kaoyan_en1_2026_q22');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  assert.equal(migrated.status, 'active');
  assert.equal(migrated.nextDueAt, migrated.updatedAt);
  assert.equal(migrated.firstAddedAt, 123);
  assert.equal(migrated.independentCorrectStreak, 0);
  upgraded.close();
});
