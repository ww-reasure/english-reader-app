import assert from 'node:assert/strict';
import test from 'node:test';

async function loadAnalytics() {
  try {
    return await import('../src/reading-analytics.mjs');
  } catch {
    return null;
  }
}

test('effective-reading analytics excludes legacy and incomplete records while preserving library inventory separately', async () => {
  const analytics = await loadAnalytics();
  assert.equal(typeof analytics?.buildReadingAnalytics, 'function');

  const result = analytics.buildReadingAnalytics({
    now: Date.parse('2026-07-28T12:00:00.000Z'),
    articles: [
      { id: 1, title: 'Library one', wordCount: 300, difficulty: 'cet4' },
      { id: 2, title: 'Library two', wordCount: 500, difficulty: 'cet6' },
      { id: 3, title: 'Unopened', wordCount: 700, difficulty: 'kaoyan1' }
    ],
    readingStats: [
      { articleId: 1, qualificationVersion: 2, completed: true, wordCount: 300, activeSeconds: 120, wpm: 150, createdAt: Date.parse('2026-07-28T09:00:00.000Z'), articleSnapshot: { title: 'Library one', difficulty: 'cet4' } },
      { articleId: 1, qualificationVersion: 2, completed: true, wordCount: 300, activeSeconds: 100, wpm: 180, createdAt: Date.parse('2026-07-27T09:00:00.000Z'), articleSnapshot: { title: 'Library one', difficulty: 'cet4' } },
      { articleId: 2, qualificationVersion: 1, completed: true, wordCount: 500, activeSeconds: 15, wpm: 999, createdAt: Date.parse('2026-07-28T10:00:00.000Z') },
      { articleId: 2, qualificationVersion: 2, completed: false, wordCount: 500, activeSeconds: 180, wpm: 160, createdAt: Date.parse('2026-07-28T11:00:00.000Z') }
    ]
  });

  assert.equal(result.libraryArticleCount, 3);
  assert.equal(result.effectiveReadingCount, 2);
  assert.equal(result.distinctReadArticleCount, 1);
  assert.equal(result.recent30EffectiveReadingCount, 2);
  assert.equal(result.totalWords, 600);
  assert.equal(result.totalSeconds, 220);
  assert.equal(result.averageWpm, 165);
  assert.equal(result.difficultyDistribution.cet4, 2);
  assert.equal(result.difficultyDistribution.cet6, 0);
  assert.equal(result.streak, 2);
  assert.deepEqual(result.recentReadings.map(reading => reading.articleId), [1, 1]);
});

test('period analytics counts qualified reading sessions and words, not article creation dates', async () => {
  const analytics = await loadAnalytics();
  assert.equal(typeof analytics?.summarizeReadingPeriod, 'function');

  const reads = [
    { qualificationVersion: 2, completed: true, articleId: 1, wordCount: 400, activeSeconds: 160, wpm: 150, createdAt: 100 },
    { qualificationVersion: 2, completed: true, articleId: 2, wordCount: 200, activeSeconds: 80, wpm: 120, createdAt: 200 },
    { qualificationVersion: 1, completed: true, articleId: 3, wordCount: 900, activeSeconds: 20, wpm: 900, createdAt: 200 }
  ];
  assert.deepEqual(analytics.summarizeReadingPeriod(reads, 150), {
    effectiveReadingCount: 1,
    distinctReadArticleCount: 1,
    totalWords: 200,
    totalSeconds: 80,
    averageWpm: 120
  });
});

test('reading analytics prefers the saved article exam track over an old raw difficulty snapshot', async () => {
  const analytics = await loadAnalytics();
  const result = analytics.buildReadingAnalytics({
    articles: [{ id: 9, title: 'Track one', difficulty: 'cet6', examType: '英语一' }],
    readingStats: [{
      articleId: 9,
      qualificationVersion: 2,
      completed: true,
      activeSeconds: 100,
      wordCount: 300,
      createdAt: 100,
      articleSnapshot: { title: 'Track one', difficulty: 'cet6', targetTrack: 'cet6' }
    }]
  });

  assert.equal(result.difficultyDistribution.kaoyan1, 1);
  assert.equal(result.difficultyDistribution.cet6, 0);
  assert.equal(result.recentReadings[0].difficulty, 'kaoyan1');
});

test('a new reading snapshot target track remains authoritative if its article is no longer local', async () => {
  const analytics = await loadAnalytics();
  const result = analytics.buildReadingAnalytics({
    articles: [],
    readingStats: [{
      articleId: 10,
      qualificationVersion: 2,
      completed: true,
      activeSeconds: 100,
      wordCount: 300,
      createdAt: 100,
      articleSnapshot: { title: 'Track two', difficulty: 'graduate', targetTrack: 'kaoyan2', examType: '英语二' }
    }]
  });

  assert.equal(result.difficultyDistribution.kaoyan2, 1);
  assert.equal(result.difficultyDistribution.graduate, 0);
});

test('historical graduate readings are counted in the general graduate track', async () => {
  const analytics = await loadAnalytics();
  const result = analytics.buildReadingAnalytics({
    articles: [{ id: 11, title: 'Historical graduate', difficulty: 'graduate' }],
    readingStats: [{
      articleId: 11,
      qualificationVersion: 2,
      completed: true,
      activeSeconds: 100,
      wordCount: 300,
      createdAt: 100,
      articleSnapshot: { title: 'Historical graduate', difficulty: 'graduate' }
    }]
  });

  assert.equal(result.difficultyDistribution['kaoyan-general'], 1);
  assert.equal(result.difficultyDistribution.graduate ?? 0, 0);
  assert.equal(result.recentReadings[0].difficulty, 'kaoyan-general');
});
