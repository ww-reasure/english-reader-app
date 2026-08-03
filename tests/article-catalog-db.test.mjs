import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { indexedDB } from 'fake-indexeddb';

let sequence = 0;

async function loadDatabaseModule() {
  const source = await readFile(new URL('../src/db.js', import.meta.url), 'utf8');
  const metadataUrl = new URL('../src/cloud-article-metadata.mjs', import.meta.url).href;
  const adapted = source
    .replace(
      "import { getStemForm } from './helpers.js';",
      "const getStemForm = word => String(word || '').trim().toLowerCase();"
    )
    .replace("from './cloud-article-metadata.mjs'", `from '${metadataUrl}'`);
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

test('v14 adds AI cache alongside catalog metadata without modifying existing articles or study words', async () => {
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
  assert.equal(upgraded.version, 14);
  assert.equal(upgraded.objectStoreNames.contains('articleCatalog'), true);
  assert.equal(upgraded.objectStoreNames.contains('aiCache'), true);
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
