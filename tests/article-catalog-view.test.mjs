import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

let moduleSequence = 0;

async function loadReadingListView({ catalog, db = {} }) {
  const source = await readFile(new URL('../src/views/reading-list.js', import.meta.url), 'utf8');
  const runtime = source.replace(/^import\s+(?:\{[\s\S]*?\}|[^;\n]+)\s+from\s+['"][^'"]+['"];\r?\n/gm, '');
  globalThis.window = {};
  globalThis.__catalog = catalog;
  globalThis.__catalogDb = db;
  return import(`data:text/javascript;base64,${Buffer.from(`
    const ARTICLE_SERVER_URL = 'https://example.test';
    const ArticleCatalog = globalThis.__catalog;
    const DB = globalThis.__catalogDb;
    const formatDate = () => '2026/7/29';
    const esc = value => String(value ?? '');
    const resolveArticleTrack = article => ({ targetTrack: article.examType === '英语一' ? 'kaoyan1' : article.difficulty, primaryLabel: article.examType || article.difficulty, badgeClass: article.examType === '英语一' ? 'kaoyan1' : article.difficulty, baselineLabel: '', isLegacy: false });
    const formatPastExamLabel = () => '';
    const matchesShelfDifficulty = (article, filter) => filter === 'all' || resolveArticleTrack(article).targetTrack === filter;
    const mergeCloudArticleDetail = (summary, detail) => ({ ...summary, ...detail });
    const normalizeCloudArticleMetadata = article => article;
    const sourceLabelForArticle = article => article.source || '';
    const examTopicForArticle = article => article.examTopic || '';
    const articleGenreForArticle = article => article.articleGenre || '';
    const articleTaxonomyLabels = () => ({ topic: '', genre: '' });
    const matchesArticleTaxonomy = () => true;
    const __moduleSequence = ${moduleSequence++};
    ${runtime}
  `).toString('base64')}`);
}

const cachedArticle = { id: 'cached', title: 'Cached shelf', difficulty: 'cet6', examType: '英语一' };

test('bookshelf paints an available catalog before starting a background refresh', async () => {
  let refreshStarted = false;
  const catalog = {
    getSnapshot: async () => ({ articles: [cachedArticle] }),
    refresh: () => { refreshStarted = true; return new Promise(() => {}); },
    subscribe: () => () => {}
  };
  const { ReadingListView } = await loadReadingListView({ catalog });
  const container = {
    innerHTML: '',
    scrollTop: 0,
    querySelector: () => null,
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  await ReadingListView.render(container);

  assert.match(container.innerHTML, /Cached shelf/);
  assert.doesNotMatch(container.innerHTML, /reading-list-skeleton/);
  assert.equal(refreshStarted, true);
});

test('first load shows a skeleton only while no catalog exists', async () => {
  let complete;
  const catalog = {
    getSnapshot: async () => null,
    refresh: () => new Promise(resolve => { complete = resolve; }),
    subscribe: () => () => {}
  };
  const { ReadingListView } = await loadReadingListView({ catalog });
  const container = {
    innerHTML: '',
    scrollTop: 0,
    querySelector: () => null,
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  const rendering = ReadingListView.render(container);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(container.innerHTML, /reading-list-skeleton/);

  complete({ snapshot: { articles: [cachedArticle] }, source: 'network' });
  await rendering;
  assert.match(container.innerHTML, /Cached shelf/);
});

test('background catalog changes wait for user confirmation and preserve scroll position', async () => {
  let listener;
  let notice = null;
  const catalog = {
    getSnapshot: async () => ({ articles: [cachedArticle] }),
    refresh: () => new Promise(() => {}),
    subscribe: callback => { listener = callback; return () => {}; }
  };
  const { ReadingListView } = await loadReadingListView({ catalog });
  const container = {
    innerHTML: '',
    scrollTop: 0,
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector(selector) {
      if (selector !== '.shelf-catalog-notice') return null;
      notice ||= { hidden: true };
      return notice;
    }
  };
  await ReadingListView.render(container);
  container.scrollTop = 246;

  listener({
    previous: { articles: [cachedArticle] },
    snapshot: { articles: [{ ...cachedArticle, id: 'new', title: 'Updated shelf' }] }
  });

  assert.match(container.innerHTML, /Cached shelf/);
  assert.doesNotMatch(container.innerHTML, /Updated shelf/);
  assert.equal(notice.hidden, false);

  ReadingListView.applyCatalogUpdate();
  assert.match(container.innerHTML, /Updated shelf/);
  assert.equal(container.scrollTop, 246);
});

test('app startup schedules catalog prewarming without blocking router initialization', async () => {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');

  assert.match(source, /ArticleCatalog\.prewarm\(\)/);
  assert.match(source, /requestIdleCallback|setTimeout/);
  assert.match(source, /Router\.init\(\)[\s\S]*prewarm|prewarm[\s\S]*Router\.init\(\)/);
  assert.doesNotMatch(source, /await\s+ArticleCatalog\.prewarm\(\)/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /visibilityState\s*===\s*['"]visible['"]/);
});

test('manual shelf refresh is forced, deduplicated, and applies the latest snapshot', async () => {
  const calls = [];
  let resolveManual;
  const catalog = {
    getSnapshot: async () => ({ articles: [cachedArticle] }),
    refresh: options => {
      calls.push(options);
      if (options?.force) {
        return new Promise(resolve => { resolveManual = resolve; });
      }
      return Promise.resolve({
        source: 'network',
        snapshot: { articles: [{ ...cachedArticle, id: 'fresh', title: 'Fresh shelf' }] }
      });
    },
    subscribe: () => () => {}
  };
  const { ReadingListView } = await loadReadingListView({ catalog });
  const container = {
    innerHTML: '',
    scrollTop: 120,
    querySelector: () => null,
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  await ReadingListView.render(container);
  await new Promise(resolve => setTimeout(resolve, 0));
  const first = ReadingListView.refreshCatalog({ applyImmediately: true, source: 'manual' });
  const second = ReadingListView.refreshCatalog({ applyImmediately: true, source: 'manual' });
  resolveManual({
    source: 'network',
    snapshot: { articles: [{ ...cachedArticle, id: 'fresh', title: 'Fresh shelf' }] }
  });
  await first;
  await second;

  const manualCalls = calls.filter(call => call?.force);
  assert.equal(manualCalls.length, 1);
  assert.equal(manualCalls[0].force, true);
  assert.equal(manualCalls[0].reason, 'manual');
  assert.match(container.innerHTML, /Fresh shelf/);
  assert.equal(container.scrollTop, 0);
});

test('pull refresh only starts after the threshold at the top of the shelf', async () => {
  const listeners = {};
  let requests = 0;
  const catalog = {
    getSnapshot: async () => ({ articles: [cachedArticle] }),
    refresh: options => {
      if (options?.force) {
        requests += 1;
        assert.equal(options.force, true);
      }
      return Promise.resolve({ source: 'network', snapshot: { articles: [cachedArticle] } });
    },
    subscribe: () => () => {}
  };
  const { ReadingListView } = await loadReadingListView({ catalog });
  const container = {
    innerHTML: '',
    scrollTop: 0,
    querySelector: () => null,
    addEventListener: (name, handler) => { listeners[name] = handler; },
    removeEventListener: () => {}
  };

  await ReadingListView.render(container);
  listeners.touchstart({ touches: [{ clientY: 10 }] });
  listeners.touchend({ changedTouches: [{ clientY: 60 }] });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(requests, 0);

  listeners.touchstart({ touches: [{ clientY: 10 }] });
  listeners.touchend({ changedTouches: [{ clientY: 90 }] });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(requests, 1);
});
