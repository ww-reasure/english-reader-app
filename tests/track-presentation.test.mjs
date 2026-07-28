import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const LABELS = {
  cet4: '四级',
  cet6: '六级',
  kaoyan1: '考研英语一',
  kaoyan2: '考研英语二',
  graduate: '考研（旧版）'
};

const formatDate = () => '2026/7/26';
const esc = value => String(value ?? '');

async function loadView(fileName, bindings = {}) {
  const source = await readFile(new URL(`../src/views/${fileName}`, import.meta.url), 'utf8');
  const moduleSource = source.replace(/^import .*?;\r?\n/gm, '');
  const declarations = Object.entries(bindings)
    .map(([name, value]) => `const ${name} = ${value};`)
    .join('\n');

  globalThis.window = {};
  return import(`data:text/javascript;base64,${Buffer.from(`${declarations}\n${moduleSource}`).toString('base64')}`);
}

async function loadReadingAnalyticsRuntime() {
  const source = await readFile(new URL('../src/reading-analytics.mjs', import.meta.url), 'utf8');
  return source.replace(/^export /gm, '');
}

test('reading history keeps English One, English Two, and legacy graduate as separately selectable filters', async () => {
  const articles = [
    { id: 1, title: 'One', difficulty: 'kaoyan1', wordCount: 10, topic: 'A', createdAt: Date.now() },
    { id: 2, title: 'Two', difficulty: 'kaoyan2', wordCount: 10, topic: 'B', createdAt: Date.now() },
    { id: 3, title: 'Legacy', difficulty: 'graduate', wordCount: 10, topic: 'C', createdAt: Date.now() }
  ];
  const source = await readFile(new URL('../src/views/history.js', import.meta.url), 'utf8');
  const runtime = source.replace(/^import .*?;\r?\n/gm, '');
  globalThis.window = {};
  const { HistoryView: renderedView } = await import(`data:text/javascript;base64,${Buffer.from(`
    const DB = { getAllArticles: async () => ${JSON.stringify(articles)} };
    const DIFFICULTY_LABELS = ${JSON.stringify(LABELS)};
    const formatDate = ${formatDate.toString()};
    const esc = ${esc.toString()};
    ${runtime}
  `).toString('base64')}`);
  const container = { innerHTML: '' };
  globalThis.document = { querySelectorAll: () => [] };

  await renderedView.render(container);

  for (const [track, label] of Object.entries({ kaoyan1: '考研英语一', kaoyan2: '考研英语二', graduate: '考研（旧版）' })) {
    assert.match(container.innerHTML, new RegExp(`<option value="${track}"[^>]*>${label}</option>`));
    renderedView.filterDifficulty(track);
    assert.equal(renderedView.difficultyFilter, track);
  }
});

test('reading shelf provides independent English One, English Two, and legacy graduate filters', async () => {
  const { ReadingListView } = await loadView('reading-list.js', {
    ARTICLE_SERVER_URL: JSON.stringify('https://example.test'),
    DB: '{}',
    DIFFICULTY_LABELS: JSON.stringify(LABELS),
    formatDate: formatDate.toString(),
    esc: esc.toString()
  });
  const articles = [
    { id: 1, title: 'One', difficulty: 'kaoyan1', category: 'science' },
    { id: 2, title: 'Two', difficulty: 'kaoyan2', category: 'science' },
    { id: 3, title: 'Legacy', difficulty: 'graduate', category: 'science' }
  ];
  const container = { innerHTML: '' };

  ReadingListView._currentFilter = 'all';
  ReadingListView._currentCategory = 'all';
  ReadingListView._renderArticles(container, articles);

  for (const [track, label, articleId] of [
    ['kaoyan1', '考研英语一', 1],
    ['kaoyan2', '考研英语二', 2],
    ['graduate', '考研（旧版）', 3]
  ]) {
    assert.match(container.innerHTML, new RegExp(`filterByDifficulty\\('${track}'\\)[^>]*>${label}</button>`));
    ReadingListView._currentFilter = track;
    assert.deepEqual(ReadingListView._visibleArticles().map(article => article.id), [articleId]);
  }
});

test('learning profile reports English One, English Two, and legacy graduate in separate difficulty bars', async () => {
  const articles = [
    { id: 1, title: 'One', difficulty: 'kaoyan1', wordCount: 120, createdAt: Date.now() },
    { id: 2, title: 'Two', difficulty: 'kaoyan2', wordCount: 180, createdAt: Date.now() },
    { id: 3, title: 'Legacy', difficulty: 'graduate', wordCount: 90, createdAt: Date.now() }
  ];
  const { StatsView } = await loadView('stats.js', {
    DB: JSON.stringify({}),
    DIFFICULTY_LABELS: JSON.stringify(LABELS),
    formatDate: formatDate.toString(),
    esc: esc.toString(),
    SpacedRepetition: JSON.stringify({ getDueCount: () => 0 })
  });
  const source = await readFile(new URL('../src/views/stats.js', import.meta.url), 'utf8');
  const runtime = source.replace(/^import .*?;\r?\n/gm, '');
  const analyticsRuntime = await loadReadingAnalyticsRuntime();
  globalThis.window = {};
  const { StatsView: renderedView } = await import(`data:text/javascript;base64,${Buffer.from(`
    const DB = {
      getAllArticles: async () => ${JSON.stringify(articles)},
      getAllLearnWords: async () => [],
      getAllWords: async () => [],
      getAllReadingStats: async () => ${JSON.stringify(articles.map(article => ({
        articleId: article.id,
        qualificationVersion: 2,
        completed: true,
        wordCount: article.wordCount,
        activeSeconds: 120,
        createdAt: article.createdAt,
        articleSnapshot: { title: article.title, difficulty: article.difficulty }
      })))}
    };
    const DIFFICULTY_LABELS = ${JSON.stringify(LABELS)};
    const formatDate = ${formatDate.toString()};
    const esc = ${esc.toString()};
    const SpacedRepetition = { getDueCount: () => 0 };
    ${analyticsRuntime}
    ${runtime}
  `).toString('base64')}`);
  const container = { innerHTML: '' };

  await renderedView.render(container);

  for (const [label, cls] of [
    ['考研英语一', 'kaoyan1'],
    ['考研英语二', 'kaoyan2'],
    ['考研（旧版）', 'graduate']
  ]) {
    const row = new RegExp(`<span class="badge badge-${cls}">${label}</span>[\\s\\S]*?<span class="diff-bar-count">1 篇 \\(33%\\)</span>`);
    assert.match(container.innerHTML, row);
  }
});

test('English One and English Two badges share the existing exam-track contrast treatment', async () => {
  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');

  assert.match(css, /\.badge-cet4\s*,\s*\.badge-cet6\s*,\s*\.badge-kaoyan1\s*,\s*\.badge-kaoyan2\s*,\s*\.badge-graduate/);
});
