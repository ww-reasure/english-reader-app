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

function openVersion12(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 12);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('articles', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('learnWords', { keyPath: 'id', autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

test('v18 adds analytics stores alongside catalog metadata without modifying existing articles or study words', async () => {
  globalThis.indexedDB = indexedDB;
  const module = await loadDatabaseModule();
  const name = `EnglishReaderCatalogUpgrade-${process.pid}-${sequence++}`;
  const legacy = await openVersion12(name);
  const write = legacy.transaction(['articles', 'learnWords'], 'readwrite');
  write.objectStore('articles').put({ id: 7, title: 'Keep me' });
  write.objectStore('learnWords').put({ id: 8, word: 'retain' });
  await new Promise((resolve, reject) => {
    write.oncomplete = resolve;
    write.onerror = () => reject(write.error);
  });
  legacy.close();

  module.DB.DB_NAME = name;
  const upgraded = await module.DB.open();
  assert.equal(upgraded.version, 19);
  assert.equal(upgraded.objectStoreNames.contains('articleCatalog'), true);
  assert.equal(upgraded.objectStoreNames.contains('aiCache'), true);
  for (const storeName of [
    'examPackMeta', 'examBanks', 'examPapers', 'examUnits', 'examQuestions',
    'examAttempts', 'examResponses', 'examWrongStates', 'examBookmarks',
    'examTranslationReviews'
  ]) {
    assert.equal(upgraded.objectStoreNames.contains(storeName), true, storeName);
  }
  upgraded.close();

  assert.equal((await module.DB.getArticle(7)).title, 'Keep me');
  assert.equal((await module.DB.findLearnWordById(8)).word, 'retain');
});

test('catalog repository persists and retrieves one versioned metadata snapshot', async () => {
  globalThis.indexedDB = indexedDB;
  const module = await loadDatabaseModule();
  module.DB.DB_NAME = `EnglishReaderCatalogRepository-${process.pid}-${sequence++}`;

  const record = {
    key: 'cloud-main',
    schemaVersion: 1,
    fetchedAt: 123,
    signature: 'one',
    articles: [{ id: 'one', title: 'One' }]
  };
  await module.DB.saveArticleCatalog(record);

  assert.deepEqual(await module.DB.getArticleCatalog(), record);
});

test('article storage preserves imported-file metadata without a schema upgrade', async () => {
  globalThis.indexedDB = indexedDB;
  const module = await loadDatabaseModule();
  module.DB.DB_NAME = `EnglishReaderImportedArticle-${process.pid}-${sequence++}`;
  const article = {
    title: 'Imported note',
    content: 'This is a stored imported article.',
    sourceType: 'imported',
    source: 'local',
    fileName: 'note.md',
    wordCount: 6,
    contentFingerprint: 'v1-abcdef'
  };
  const id = await module.DB.saveArticle(article);
  const saved = await module.DB.getArticle(id);
  assert.equal(saved.sourceType, 'imported');
  assert.equal(saved.source, 'local');
  assert.equal(saved.fileName, 'note.md');
  assert.equal(saved.contentFingerprint, 'v1-abcdef');
});
