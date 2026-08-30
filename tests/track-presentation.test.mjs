import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const LABELS = {
  cet4: '四级',
  cet6: '六级',
  kaoyan1: '考研英语一',
  kaoyan2: '考研英语二',
  graduate: '考研通用'
};

const formatDate = () => '2026/7/26';
const esc = value => String(value ?? '');

async function loadView(fileName, bindings = {}) {
  const source = await readFile(new URL(`../src/views/${fileName}`, import.meta.url), 'utf8');
  const moduleSource = source.replace(/^import\s+(?:\{[\s\S]*?\}|[^;\n]+)\s+from\s+['"][^'"]+['"];\r?\n/gm, '');
  const declarations = Object.entries(bindings)
    .map(([name, value]) => `const ${name} = ${value};`)
    .join('\n');

  globalThis.window = {};
  return import(`data:text/javascript;base64,${Buffer.from(`${declarations}\n${moduleSource}`).toString('base64')}`);
}

async function loadReadingAnalyticsRuntime() {
  const source = await readFile(new URL('../src/reading-analytics.mjs', import.meta.url), 'utf8');
  return source.replace(/^import .*?;\r?\n/gm, '').replace(/^export /gm, '');
}

test('reading history folds historical graduate articles into the general graduate filter', async () => {
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
    const resolveArticleTrack = article => { const raw = article.targetTrack || article.difficulty; const targetTrack = raw === 'graduate' ? 'kaoyan-general' : raw; return { targetTrack, primaryLabel: targetTrack === 'kaoyan-general' ? '考研通用' : DIFFICULTY_LABELS[targetTrack], badgeClass: targetTrack === 'kaoyan-general' ? 'graduate' : targetTrack, baselineLabel: '', isLegacy: false }; };
    ${runtime}
  `).toString('base64')}`);
  const container = { innerHTML: '' };
  globalThis.document = { querySelectorAll: () => [] };

  await renderedView.render(container);

  for (const [track, label] of Object.entries({ kaoyan1: '考研英语一', kaoyan2: '考研英语二', 'kaoyan-general': '考研通用' })) {
    assert.match(container.innerHTML, new RegExp(`<option value="${track}"[^>]*>${label}</option>`));
    renderedView.filterDifficulty(track);
    assert.equal(renderedView.difficultyFilter, track);
  }
});

test('reading shelf folds historical graduate articles into the general graduate filter', async () => {
  const { ReadingListView } = await loadView('reading-list.js', {
    ARTICLE_SERVER_URL: JSON.stringify('https://example.test'),
    DB: '{}',
    DIFFICULTY_LABELS: JSON.stringify(LABELS),
    formatDate: formatDate.toString(),
    esc: esc.toString(),
    examBadgeForArticle: '() => null',
    resolveArticleTrack: "article => { const targetTrack = article.difficulty === 'graduate' ? 'kaoyan-general' : article.difficulty; return { targetTrack, primaryLabel: targetTrack === 'kaoyan-general' ? '考研通用' : DIFFICULTY_LABELS[targetTrack], badgeClass: targetTrack === 'kaoyan-general' ? 'graduate' : targetTrack, baselineLabel: '', isLegacy: false }; }",
    formatPastExamLabel: "() => ''",
    matchesShelfDifficulty: "(article, filter) => filter === 'all' || (article.difficulty === 'graduate' ? 'kaoyan-general' : article.difficulty) === filter",
    mergeCloudArticleDetail: '(summary, detail) => ({ ...summary, ...detail })',
    normalizeCloudArticleMetadata: "() => ({ sourceType: 'rss', examType: null, examTypeConfidence: null, examYear: null, examName: null, examText: null })",
    sourceLabelForArticle: "article => article.source || ''",
    examTopicForArticle: "article => article.examTopic || ({ science: 'technology_environment' }[article.category] || '')",
    articleGenreForArticle: "article => article.articleGenre || ''",
    articleTaxonomyLabels: "article => ({ topic: article.examTopic === 'technology_environment' || article.category === 'science' ? '科技与环境' : '', genre: article.articleGenre || '' })",
    matchesArticleTaxonomy: "() => true"
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
    ['kaoyan-general', '考研通用', 3]
  ]) {
    assert.match(container.innerHTML, new RegExp(`filterByDifficulty\\('${track}'\\)[^>]*>${label}</button>`));
    ReadingListView._currentFilter = track;
    assert.deepEqual(ReadingListView._visibleArticles().map(article => article.id), [articleId]);
  }
});

test('learning profile counts historical graduate reading in the general graduate bar', async () => {
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
    const createExamServices = () => ({});
    const createExamLearningOverviewProvider = () => ({ getOverview: async () => ({ status: 'unavailable', availableYears: [], totals: { completedAttempts: 0, objectiveAccuracy: null, objectiveAnswered: 0, translationSegments: 0, activeDurationMs: 0 }, byType: [], trend: [], review: { activeWrong: 0, dueWrong: 0, masteredWrong: 0, translationNeedsReview: 0 }, recentAttempts: [] }) });
    const resolveArticleTrack = article => { const raw = article.examType === '英语一' ? 'kaoyan1' : article.examType === '英语二' ? 'kaoyan2' : article.targetTrack || article.difficulty || 'unknown'; return { targetTrack: raw === 'graduate' ? 'kaoyan-general' : raw }; };
    ${analyticsRuntime}
    ${runtime}
  `).toString('base64')}`);
  const container = { innerHTML: '' };

  await renderedView.render(container);

  for (const [label, cls] of [
    ['考研英语一', 'kaoyan1'],
    ['考研英语二', 'kaoyan2'],
    ['考研通用', 'graduate']
  ]) {
    const row = new RegExp(`<span class="badge badge-${cls}">${label}</span>[\\s\\S]*?<span class="diff-bar-count">1 篇 \\(33%\\)</span>`);
    assert.match(container.innerHTML, row);
  }
});

test('English One and English Two badges share the existing exam-track contrast treatment', async () => {
  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');

  assert.match(css, /\.badge-cet4\s*,\s*\.badge-cet6\s*,\s*\.badge-kaoyan1\s*,\s*\.badge-kaoyan2\s*,\s*\.badge-kaoyan-general\s*,\s*\.badge-graduate/);
  assert.match(css, /\.article-list-badges/);
  assert.match(css, /\.article-past-exam-badge/);
  assert.match(css, /\.reading-list-tabs[^}]*scrollbar-width\s*:\s*none/s);
});

test('reading history resolves cloud exam metadata before the raw difficulty', async () => {
  const resolver = article => article.examType === '英语一'
    ? { targetTrack: 'kaoyan1', primaryLabel: '英语一', badgeClass: 'kaoyan1', baselineLabel: '词汇基线：六级', isLegacy: false }
    : { targetTrack: article.difficulty === 'graduate' ? 'kaoyan-general' : article.difficulty, primaryLabel: article.difficulty === 'graduate' ? '考研通用' : LABELS[article.difficulty], badgeClass: article.difficulty === 'graduate' ? 'graduate' : article.difficulty, baselineLabel: '', isLegacy: false };
  const { HistoryView } = await loadView('history.js', {
    DB: "({ getAllArticles: async () => [{ id: 8, title: 'Cloud track', difficulty: 'cet6', examType: '英语一', wordCount: 300, topic: 'reading', createdAt: 1 }] })",
    DIFFICULTY_LABELS: JSON.stringify(LABELS),
    formatDate: formatDate.toString(),
    esc: esc.toString(),
    resolveArticleTrack: resolver.toString()
  });
  const container = { innerHTML: '' };
  globalThis.document = { querySelectorAll: () => [] };

  await HistoryView.render(container);

  assert.match(container.innerHTML, /data-difficulty="kaoyan1"/);
  assert.match(container.innerHTML, /badge-kaoyan1">英语一</);
  assert.match(container.innerHTML, /词汇基线：六级/);
});
