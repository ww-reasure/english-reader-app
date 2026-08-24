import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

async function loadAgent() {
  const [source, analytics] = await Promise.all([
    readFile(new URL('../src/components/learning-agent.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/reading-analytics.mjs', import.meta.url), 'utf8')
  ]);
  const metadataUrl = new URL('../src/cloud-article-metadata.mjs', import.meta.url).href;
  const adapted = source.replace(
    "import { buildReadingAnalytics } from '../reading-analytics.mjs';",
    analytics
      .replace("from './cloud-article-metadata.mjs'", `from '${metadataUrl}'`)
      .replace(/^export /gm, '')
  );
  return import('data:text/javascript;base64,' + Buffer.from(adapted).toString('base64'));
}

test('returns at most ten favorite article metadata records without content', async () => {
  const { LearningAgent } = await loadAgent();
  const db = {
    getAllArticles: async () => Array.from({ length: 12 }, (_, id) => ({
      id,
      title: '标题 ' + id,
      favorite: 1,
      content: 'private text',
      difficulty: 'cet4',
      topic: 'science',
      createdAt: id
    }))
  };
  const agent = new LearningAgent({
    db,
    srs: { getDueWords: () => [], getStatus: () => 'new', getDueCount: () => 0 },
    now: () => 100
  });

  const result = await agent.execute('list_saved_articles', { favoriteOnly: true });
  assert.equal(result.articles.length, 10);
  assert.equal('content' in result.articles[0], false);
});

test('rejects mutating and unknown tool names', async () => {
  const { LearningAgent } = await loadAgent();
  await assert.rejects(
    new LearningAgent({ db: {}, srs: {} }).execute('delete_article', { id: 1 }),
    /not allowed/
  );
});

test('agent current vocabulary tools exclude archived words', async () => {
  const { LearningAgent } = await loadAgent();
  const allWords = [
    { id: 1, word: 'active', translation: '活跃', archivedAt: null, nextReview: 1 },
    { id: 2, word: 'archived', translation: '归档', archivedAt: 10, nextReview: 1 }
  ];
  const db = {
    getAllLearnWords: async ({ includeArchived = false } = {}) => includeArchived
      ? allWords
      : allWords.filter(word => word.archivedAt == null),
    getAllArticles: async () => [],
    getAllReadingStats: async () => []
  };
  const agent = new LearningAgent({
    db,
    srs: {
      getDueCount: words => words.length,
      getDueWords: words => words,
      getStatus: () => 'review'
    },
    now: () => 100
  });
  assert.equal((await agent.execute('get_learning_overview')).totals.words, 1);
  assert.deepEqual((await agent.execute('find_learning_words', {})).words.map(word => word.word), ['active']);
  assert.deepEqual((await agent.execute('get_review_queue')).words.map(word => word.word), ['active']);
});

test('learning overview distinguishes saved article inventory from qualified reading activity', async () => {
  const { LearningAgent } = await loadAgent();
  const agent = new LearningAgent({
    db: {
      getAllLearnWords: async () => [],
      getAllArticles: async () => [
        { id: 1, title: 'Read once', wordCount: 300, difficulty: 'cet4' },
        { id: 2, title: 'Only saved', wordCount: 400, difficulty: 'cet6' }
      ],
      getAllReadingStats: async () => [
        { articleId: 1, qualificationVersion: 2, completed: true, wordCount: 300, activeSeconds: 120, createdAt: 95 },
        { articleId: 2, qualificationVersion: 1, completed: true, wordCount: 400, activeSeconds: 10, createdAt: 99 }
      ]
    },
    srs: { getDueCount: () => 0 },
    now: () => 100
  });

  const result = await agent.getLearningOverview();
  assert.deepEqual(result.totals, {
    words: 0,
    due: 0,
    favorites: 0,
    libraryArticles: 2,
    effectiveReadings: 1,
    recent30EffectiveReadings: 1,
    distinctReadArticles: 1,
    effectiveReadingSeconds: 120
  });
});

test('reports target-track true-exam priorities and available examples for planning', async () => {
  const { LearningAgent } = await loadAgent();
  const words = [
    { id: 1, word: 'frequent', translation: '常见的', nextReview: 1 },
    { id: 2, word: 'ordinary', translation: '普通的', nextReview: null }
  ];
  const agent = new LearningAgent({
    db: { getAllLearnWords: async () => words },
    srs: {
      getDueWords: input => input.filter(word => word.nextReview),
      getStatus: word => word.word === 'frequent' ? 'review' : 'new'
    },
    examCorpus: {
      lookup: async word => word === 'frequent'
        ? { priorityScore: 92, priorityTier: 'core', priorityLabel: '真题高频核心' }
        : null,
      getExamples: async word => word === 'frequent' ? [{ id: 1 }, { id: 2 }] : []
    },
    targetTrack: () => 'kaoyan1'
  });

  const result = await agent.execute('get_exam_learning_priorities');
  assert.equal(result.targetTrack, 'kaoyan1');
  assert.equal(result.highFrequencyUnmastered[0].word, 'frequent');
  assert.equal(result.highFrequencyUnmastered[0].exampleCount, 2);
  assert.deepEqual(result.duePriorityWords.map(item => item.word), ['frequent']);
});

test('exposes a bounded read-only exam overview tool and forwards an explicit year', async () => {
  const { LearningAgent, LEARNING_TOOLS } = await loadAgent();
  const calls = [];
  const overview = { source: 'exam_learning_overview', status: 'available', recentAttempts: [], wrongSummary: [] };
  const agent = new LearningAgent({
    db: {}, srs: {},
    examLearningProvider: { getOverview: async args => { calls.push(args); return overview; } }
  });
  const definition = LEARNING_TOOLS.find(tool => tool.function.name === 'get_exam_learning_overview');
  assert.equal(definition.function.parameters.properties.year.type, 'integer');
  assert.equal(await agent.execute('get_exam_learning_overview', { year: 2023 }), overview);
  assert.deepEqual(calls, [{ year: 2023, recentLimit: 5, wrongLimit: 5 }]);
});

test('exam overview tool reports unavailable without mutating or inventing data', async () => {
  const { LearningAgent } = await loadAgent();
  const agent = new LearningAgent({ db: {}, srs: {} });
  assert.deepEqual(await agent.execute('get_exam_learning_overview'), {
    source: 'exam_learning_overview', status: 'unavailable', availableYears: [],
    recentAttempts: [], wrongSummary: []
  });
});

test('daily report tools return a typed unavailable result without a provider', async () => {
  const { LearningAgent } = await loadAgent();
  const agent = new LearningAgent({ db: {}, srs: {} });
  assert.deepEqual(await agent.execute('get_daily_learning_report', { date: '2026-08-24' }), {
    source: 'daily_learning_report', status: 'unavailable', completeness: 'unavailable',
    reports: [], items: [], dateKey: '2026-08-24'
  });
});
