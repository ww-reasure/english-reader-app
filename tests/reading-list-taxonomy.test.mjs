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

async function loadReadingListView() {
  const source = await readFile(new URL('../src/views/reading-list.js', import.meta.url), 'utf8');
  const runtime = source.replace(/^import\s+(?:\{[\s\S]*?\}|[^;\n]+)\s+from\s+['"][^'"]+['"];\r?\n/gm, '');
  globalThis.window = {};
  return import(`data:text/javascript;base64,${Buffer.from(`
    const ARTICLE_SERVER_URL = 'https://example.test';
    const DB = {};
    const DIFFICULTY_LABELS = ${JSON.stringify(LABELS)};
    const formatDate = () => '2026/7/29';
    const esc = value => String(value ?? '');
    const examBadgeForArticle = () => null;
    const resolveArticleTrack = article => {
      if (article.examType === '英语一') return { targetTrack: 'kaoyan1', primaryLabel: '英语一', badgeClass: 'kaoyan1', baselineLabel: article.difficulty === 'cet6' ? '词汇基线：六级' : '', isLegacy: false };
      return { targetTrack: article.difficulty, primaryLabel: DIFFICULTY_LABELS[article.difficulty] || article.difficulty, badgeClass: article.difficulty, baselineLabel: '', isLegacy: article.difficulty === 'graduate' };
    };
    const formatPastExamLabel = () => '';
    const matchesShelfDifficulty = (article, filter) => filter === 'all' || article.difficulty === filter;
    const mergeCloudArticleDetail = (summary, detail) => ({ ...summary, ...detail });
    const normalizeCloudArticleMetadata = article => article;
    const sourceLabelForArticle = article => article.source || '';
    const examTopicForArticle = article => article.examTopic || ({ science: 'technology_environment', world: 'public_affairs', society: 'society_education', culture: 'culture_history' }[article.category] || '');
    const articleGenreForArticle = article => article.articleGenre || '';
    const articleTaxonomyLabels = article => ({
      topic: ({ technology_environment: '科技与环境', public_affairs: '公共事务', society_education: '社会与教育', culture_history: '文化与历史', health_psychology: '健康与心理', economy_workplace: '经济与职场' })[examTopicForArticle(article)] || '',
      genre: ({ argument: '观点论述', explanation: '说明分析', research: '研究解读', news: '新闻报道', narrative: '人物叙事' })[articleGenreForArticle(article)] || ''
    });
    const matchesArticleTaxonomy = (article, filters) => (filters.topic === 'all' || examTopicForArticle(article) === filters.topic) && (filters.genre === 'all' || articleGenreForArticle(article) === filters.genre);
    ${runtime}
  `).toString('base64')}`);
}

test('bookshelf renders the controlled topic vocabulary and a compact article-type chooser', async () => {
  const { ReadingListView } = await loadReadingListView();
  const container = { innerHTML: '', scrollTop: 91 };
  const articles = [
    { id: 1, title: 'A study', difficulty: 'cet6', examTopic: 'technology_environment', articleGenre: 'research', wordCount: 320 },
    { id: 2, title: 'A report', difficulty: 'cet6', examTopic: 'public_affairs', articleGenre: 'news', wordCount: 280 }
  ];

  ReadingListView._currentFilter = 'all';
  ReadingListView._currentTopic = 'all';
  ReadingListView._currentGenre = 'all';
  ReadingListView._genreMenuOpen = false;
  ReadingListView._renderArticles(container, articles);

  assert.match(container.innerHTML, /常考主题/);
  assert.match(container.innerHTML, /科技与环境/);
  assert.match(container.innerHTML, /公共事务/);
  assert.match(container.innerHTML, /文章类型/);
  assert.match(container.innerHTML, /全部类型/);
  assert.match(container.innerHTML, /科技与环境[\s\S]*研究解读/);
  assert.doesNotMatch(container.innerHTML, /filterByCategory/);
  assert.doesNotMatch(container.innerHTML, />国际时政</);
});

test('bookshelf uses the same primary exam label and vocabulary baseline as reading', async () => {
  const { ReadingListView } = await loadReadingListView();
  const container = { innerHTML: '', scrollTop: 0 };

  ReadingListView._currentFilter = 'all';
  ReadingListView._currentTopic = 'all';
  ReadingListView._currentGenre = 'all';
  ReadingListView._genreMenuOpen = false;
  ReadingListView._renderArticles(container, [{
    id: 1,
    title: 'English One sample',
    difficulty: 'cet6',
    examType: '英语一',
    examTopic: 'public_affairs',
    articleGenre: 'argument'
  }]);

  assert.match(container.innerHTML, /badge-kaoyan1[^>]*>英语一</);
  assert.match(container.innerHTML, /词汇基线：六级/);
  assert.doesNotMatch(container.innerHTML, /badge-cet6[^>]*>六级</);
});

test('bookshelf combines exam track, topic and article type without opening the wrong card', async () => {
  const { ReadingListView } = await loadReadingListView();
  const container = { innerHTML: '', scrollTop: 91 };
  const articles = [
    { id: 1, title: 'Target', difficulty: 'cet6', examTopic: 'technology_environment', articleGenre: 'research' },
    { id: 2, title: 'Wrong genre', difficulty: 'cet6', examTopic: 'technology_environment', articleGenre: 'news' },
    { id: 3, title: 'Wrong topic', difficulty: 'cet6', examTopic: 'public_affairs', articleGenre: 'research' },
    { id: 4, title: 'Wrong track', difficulty: 'cet4', examTopic: 'technology_environment', articleGenre: 'research' }
  ];

  ReadingListView._container = container;
  ReadingListView._articles = articles;
  ReadingListView._currentFilter = 'cet6';
  ReadingListView._currentTopic = 'technology_environment';
  ReadingListView._currentGenre = 'research';

  assert.deepEqual(ReadingListView._visibleArticles().map(article => article.id), [1]);

  ReadingListView.filterByTopic('public_affairs');
  assert.equal(ReadingListView._currentTopic, 'public_affairs');
  assert.equal(container.scrollTop, 0);
  assert.deepEqual(ReadingListView._visibleArticles().map(article => article.id), [3]);

  ReadingListView._genreMenuOpen = true;
  ReadingListView.filterByGenre('news');
  assert.equal(ReadingListView._currentGenre, 'news');
  assert.equal(ReadingListView._genreMenuOpen, false);
  assert.deepEqual(ReadingListView._visibleArticles().map(article => article.id), []);
});

test('bookshelf opens the article-type sheet on demand instead of keeping a third chip row visible', async () => {
  const { ReadingListView } = await loadReadingListView();
  const container = { innerHTML: '', scrollTop: 0 };
  const articles = [{ id: 1, title: 'One', difficulty: 'cet6', examTopic: 'public_affairs', articleGenre: 'argument' }];

  ReadingListView._container = container;
  ReadingListView._articles = articles;
  ReadingListView._currentFilter = 'all';
  ReadingListView._currentTopic = 'all';
  ReadingListView._currentGenre = 'all';
  ReadingListView._genreMenuOpen = false;
  ReadingListView._renderArticles(container, articles);
  assert.doesNotMatch(container.innerHTML, /class="shelf-genre-sheet"/);

  ReadingListView.toggleGenreMenu();
  assert.equal(ReadingListView._genreMenuOpen, true);
  assert.match(container.innerHTML, /class="shelf-genre-sheet"/);
  assert.match(container.innerHTML, /观点论述/);
  assert.match(container.innerHTML, /说明分析/);
  assert.match(container.innerHTML, /研究解读/);
  assert.match(container.innerHTML, /新闻报道/);
  assert.match(container.innerHTML, /人物叙事/);
});

test('bookshelf taxonomy controls keep touch targets and mobile sheet styling', async () => {
  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');

  assert.match(css, /\.shelf-filter-panel/);
  assert.match(css, /\.shelf-topic-chip[^}]*min-height\s*:\s*4[4-9]px/s);
  assert.match(css, /\.shelf-genre-trigger[^}]*min-height\s*:\s*4[4-9]px/s);
  assert.match(css, /\.shelf-genre-sheet/);
  assert.match(css, /\.article-list-taxonomy/);
});
