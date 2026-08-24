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
  const adapted = source
    .replace(
      "import { getStemForm } from './helpers.js';",
      "const getStemForm = word => String(word || '').trim().toLowerCase();"
    )
    .replace("from './cloud-article-metadata.mjs'", `from '${metadataUrl}'`)
    .replace("from './learning-day.mjs'", `from '${learningDayUrl}'`)
    .replace("from './learning-activity.mjs'", `from '${learningActivityUrl}'`)
    .replace("from './external-review-scheduler.mjs'", `from '${externalSchedulerUrl}'`);
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
  const catalogUrl = 'data:text/javascript;base64,' + Buffer.from("export const ArticleCatalog = { getSnapshot: async () => null, refresh: async () => ({ snapshot: { articles: [] } }), subscribe: () => () => {} };").toString('base64');
  const metadataUrl = new URL('../src/cloud-article-metadata.mjs', import.meta.url).href;
  const adapted = source
    .replace("from '../config.js'", `from '${configUrl}'`)
    .replace("from '../db.js'", `from '${dbUrl}'`)
    .replace("from '../helpers.js'", `from '${helpersUrl}'`)
    .replace("from '../components/article-catalog.js'", `from '${catalogUrl}'`)
    .replace("from '../cloud-article-metadata.mjs'", `from '${metadataUrl}'`);
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
    summary: 'Remote summary',
    source: 'past-exam',
    sourceType: 'past-exam',
    examType: '英语一',
    examTypeConfidence: 0.96,
    examYear: 2024,
    examName: '英语一',
    examText: 'Text 3',
    examTopic: 'public_affairs',
    articleGenre: 'argument',
    topicConfidence: 0.92,
    genreConfidence: 0.9,
    classificationConfidence: 0.9,
    classificationVersion: 'bookshelf-taxonomy-v1',
    classificationSource: 'ai',
    classifiedAt: '2026-07-29T12:00:00.000Z'
  });
  const article = await DB.getArticle(id);

  assert.equal(returnedId, id);
  assert.equal(article.titleZh, '云端中文标题');
  assert.equal(article.content, 'Local full content must remain intact.');
  assert.equal(article.favorite, 1);
  assert.equal(article.summary, 'Local summary');
  assert.equal(article.sourceType, 'past-exam');
  assert.equal(article.examType, '英语一');
  assert.equal(article.examTypeConfidence, 0.96);
  assert.equal(article.examYear, 2024);
  assert.equal(article.examName, '英语一');
  assert.equal(article.examText, 'Text 3');
  assert.equal(article.examTopic, 'public_affairs');
  assert.equal(article.articleGenre, 'argument');
  assert.equal(article.topicConfidence, 0.92);
  assert.equal(article.genreConfidence, 0.9);
  assert.equal(article.classificationConfidence, 0.9);
  assert.equal(article.classificationVersion, 'bookshelf-taxonomy-v1');
  assert.equal(article.classificationSource, 'ai');
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
    titleZh: '缓存文章的新中文标题',
    source: 'past-exam',
    sourceType: 'past-exam',
    examType: '英语二',
    examTypeConfidence: 0.91,
    examYear: 2021,
    examName: '英语二',
    examText: 'Text 2',
    examTopic: 'technology_environment',
    articleGenre: 'research',
    topicConfidence: 0.88,
    genreConfidence: 0.85,
    classificationConfidence: 0.85,
    classificationVersion: 'bookshelf-taxonomy-v1',
    classificationSource: 'rule',
    classifiedAt: '2026-07-29T12:00:00.000Z'
  }];

  await ReadingListView._openArticle(0);

  assert.deepEqual(updates, [[17, {
    titleZh: '缓存文章的新中文标题',
    sourceType: 'past-exam',
    examType: '英语二',
    examTypeConfidence: 0.91,
    examYear: 2021,
    examName: '英语二',
    examText: 'Text 2',
    examTopic: 'technology_environment',
    articleGenre: 'research',
    topicConfidence: 0.88,
    genreConfidence: 0.85,
    classificationConfidence: 0.85,
    classificationVersion: 'bookshelf-taxonomy-v1',
    classificationSource: 'rule',
    classifiedAt: '2026-07-29T12:00:00.000Z'
  }]]);
  assert.equal(globalThis.location.hash, '#/reading/17');
});
