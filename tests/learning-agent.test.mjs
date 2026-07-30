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
