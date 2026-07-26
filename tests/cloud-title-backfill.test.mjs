import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { indexedDB } from 'fake-indexeddb';

let databaseSequence = 0;

async function loadDatabaseModule() {
  const source = await readFile(new URL('../src/db.js', import.meta.url), 'utf8');
  const adapted = source.replace(
    "import { getStemForm } from './helpers.js';",
    "const getStemForm = word => String(word || '').trim().toLowerCase();"
  );
  return import(`data:text/javascript;base64,${Buffer.from(adapted).toString('base64')}`);
}

async function createDatabase() {
  globalThis.indexedDB = indexedDB;
  const module = await loadDatabaseModule();
  module.DB.DB_NAME = `EnglishReaderTitleBackfill-${process.pid}-${databaseSequence++}`;
  return module.DB;
}

async function loadReadingList({ existing, updates }) {
  const source = await readFile(new URL('../src/views/reading-list.js', import.meta.url), 'utf8');
  const configUrl = 'data:text/javascript;base64,' + Buffer.from("export const ARTICLE_SERVER_URL = 'https://example.test';").toString('base64');
  const dbUrl = 'data:text/javascript;base64,' + Buffer.from(`export const DB = { findArticleByUrl: async () => (${JSON.stringify(existing)}), updateArticle: async (...args) => globalThis.__titleBackfillUpdates.push(args) };`).toString('base64');
  const helpersUrl = 'data:text/javascript;base64,' + Buffer.from("export const DIFFICULTY_LABELS = {}; export const formatDate = () => ''; export const esc = value => value;").toString('base64');
  const adapted = source
    .replace("from '../config.js'", `from '${configUrl}'`)
    .replace("from '../db.js'", `from '${dbUrl}'`)
    .replace("from '../helpers.js'", `from '${helpersUrl}'`);
  globalThis.window = {};
  globalThis.location = { hash: '' };
  globalThis.__titleBackfillUpdates = updates;
  return import(`data:text/javascript;base64,${Buffer.from(adapted).toString('base64')}`);
}

test('syncing a cached full article backfills titleZh without replacing local content or favorite state', async () => {
  const DB = await createDatabase();
  const id = await DB.saveArticle({
    title: 'Existing title',
    titleZh: '',
    content: 'Local full content must remain intact.',
    favorite: 1,
    url: 'https://example.test/article-1',
    summary: 'Local summary'
  });

  const returnedId = await DB.syncArticle({
    title: 'Remote title',
    titleZh: '云端中文标题',
    content: 'Remote content must not replace the local copy.',
    favorite: 0,
    url: 'https://example.test/article-1',
    summary: 'Remote summary'
  });
  const article = await DB.getArticle(id);

  assert.equal(returnedId, id);
  assert.equal(article.titleZh, '云端中文标题');
  assert.equal(article.content, 'Local full content must remain intact.');
  assert.equal(article.favorite, 1);
  assert.equal(article.summary, 'Local summary');
});

test('opening a cached full shelf article backfills its cloud title before navigation', async () => {
  const updates = [];
  const { ReadingListView } = await loadReadingList({
    existing: {
      id: 17,
      titleZh: '',
      content: 'Cached full article',
      favorite: 1,
      url: 'https://example.test/article-2'
    },
    updates
  });
  ReadingListView._articles = [{
    id: 'cloud-2',
    sourceUrl: 'https://example.test/article-2',
    titleZh: '缓存文章的新中文标题'
  }];

  await ReadingListView._openArticle(0);

  assert.deepEqual(updates, [[17, { titleZh: '缓存文章的新中文标题' }]]);
  assert.equal(globalThis.location.hash, '#/reading/17');
});
