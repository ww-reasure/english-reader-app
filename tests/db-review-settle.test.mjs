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
  const recoverySchedulerUrl = new URL('../src/recovery-scheduler.mjs', import.meta.url).href;
  const vocabularyLibraryUrl = new URL('../src/vocabulary-library.mjs', import.meta.url).href;
  const adapted = source
    .replace(
      "import { getStemForm } from './helpers.js';",
      "const getStemForm = word => String(word || '').trim().toLowerCase();"
    )
    .replace("from './cloud-article-metadata.mjs'", `from '${metadataUrl}'`)
    .replace("from './learning-day.mjs'", `from '${learningDayUrl}'`)
    .replace("from './learning-activity.mjs'", `from '${learningActivityUrl}'`)
    .replace("from './external-review-scheduler.mjs'", `from '${externalSchedulerUrl}'`)
    .replace("from './recovery-scheduler.mjs'", `from '${recoverySchedulerUrl}'`)
    .replace("from './vocabulary-library.mjs'", `from '${vocabularyLibraryUrl}'`);
  return import(`data:text/javascript;base64,${Buffer.from(adapted).toString('base64')}`);
}

async function createDatabase() {
  globalThis.indexedDB = indexedDB;
  const module = await loadDatabaseModule();
  module.DB.DB_NAME = `EnglishReaderSettle-${process.pid}-${databaseSequence++}`;
  return module;
}

test('settleSessionReview 持久化 recovery 字段并保留 reviewRevision 守卫', async () => {
  const { DB } = await createDatabase();
  const wordId = await DB.saveLearnWord({
    word: 'settler',
    interval: 30,
    reviewCount: 8,
    easeFactor: 2.5,
    state: 'review',
    nextReview: 1,
    reviewRevision: 3
  });

  const updated = await DB.settleSessionReview(wordId, {
    recoveryStage: 2,
    recoveryTarget: 2,
    lastDebt: 2,
    interval: 30,
    nextReview: 5,
    state: 'review'
  }, {
    rating: 1,
    source: 'flashcard',
    sawAnswer: true,
    expectedRevision: 3,
    sessionDebt: 2
  });

  assert.equal(updated.recoveryStage, 2);
  assert.equal(updated.recoveryTarget, 2);
  assert.equal(updated.lastDebt, 2);
  assert.equal(updated.reviewRevision, 4);
  assert.equal(updated.interval, 30, 'recovery 期间保留原 interval');

  const events = await DB.getReviewEventsForWord(wordId);
  assert.equal(events.length, 1);
  assert.equal(events[0].sessionDebt, 2);
  assert.equal(events[0].recoveryStage, 2);
  assert.equal(events[0].source, 'flashcard');
});

test('settleSessionReview 拒绝 revision 不一致的评分', async () => {
  const { DB } = await createDatabase();
  const wordId = await DB.saveLearnWord({ word: 'alpha', reviewRevision: 1 });
  await assert.rejects(
    DB.settleSessionReview(wordId, { recoveryStage: 1 }, { rating: 5, expectedRevision: 9 }),
    /已在另一种复习方式中更新/
  );
});

test('applyReviewRatingIntent 安全重放过期 revision 的明确评分且 attemptId 幂等', async () => {
  const { DB } = await createDatabase();
  const wordId = await DB.saveLearnWord({
    word: 'replayable', interval: 7, reviewCount: 3, state: 'review', reviewRevision: 1
  });
  await DB.settleSessionReview(wordId, {
    interval: 12, reviewCount: 4, state: 'review', nextReview: 2000
  }, { rating: 5, source: 'context-review', expectedRevision: 1, attemptId: 'other-mode' });

  const intent = {
    version: 2,
    rating: 1,
    sessionDebt: 2,
    occurredAt: 1000,
    source: 'flashcard',
    metadata: { sessionId: 'review-session-1', weakestQuality: 1 }
  };
  const first = await DB.applyReviewRatingIntent(wordId, intent, {
    expectedRevision: 1,
    attemptId: 'stale-explicit-rating'
  });
  const replay = await DB.applyReviewRatingIntent(wordId, intent, {
    expectedRevision: 1,
    attemptId: 'stale-explicit-rating'
  });

  assert.equal(first.reviewRevision, 3);
  assert.equal(first.recoveryStage, 2);
  assert.equal(first.interval, 12, '意图基于最新词状态重算，而不是覆盖为旧快照');
  assert.equal(replay.reviewRevision, 3);
  const events = await DB.getReviewEventsForWord(wordId);
  assert.equal(events.length, 2);
  const event = events.find(item => item.attemptId === 'stale-explicit-rating');
  assert.equal(event.intentVersion, 2);
  assert.equal(event.conflictResolved, true);
  assert.equal(event.rating, 1);
  assert.equal(event.sessionId, 'review-session-1');
  assert.equal(event.weakestQuality, 1);
});

test('settleSessionReview 不把界面临时 expectedRevision 写进词条', async () => {
  const { DB } = await createDatabase();
  const wordId = await DB.saveLearnWord({ word: 'transient', reviewRevision: 0 });

  await DB.settleSessionReview(wordId, {
    state: 'review',
    interval: 2,
    nextReview: 2000,
    expectedRevision: 1
  }, { rating: 5, expectedRevision: 0, attemptId: 'attempt-transient' });

  const saved = await DB.findLearnWordById(wordId);
  assert.equal(saved.reviewRevision, 1);
  assert.equal(saved.expectedRevision, undefined);
});

test('correctLearnWordReview 拒绝并发 revision，不能覆盖另一种复习', async () => {
  const { DB } = await createDatabase();
  const wordId = await DB.saveLearnWord({ word: 'concurrent', reviewRevision: 0 });
  const attemptId = 'attempt-concurrent-correction';

  await DB.recordLearnWordReview(wordId, {
    state: 'review', interval: 4, nextReview: 4000
  }, { rating: 5, source: 'flashcard', attemptId, expectedRevision: 0 });
  await DB.recordLearnWordReview(wordId, {
    state: 'review', interval: 5, nextReview: 5000
  }, { rating: 5, source: 'context-review', attemptId: 'attempt-other', expectedRevision: 1 });

  await assert.rejects(
    DB.correctLearnWordReview(wordId, { state: 'relearning', interval: 0 }, {
      attemptId,
      expectedRevision: 1,
      sawAnswer: true
    }),
    /已在另一种复习方式中更新/
  );
  const saved = await DB.findLearnWordById(wordId);
  assert.equal(saved.reviewRevision, 2);
  assert.equal(saved.interval, 5);
});

test('recovery 会话描述符可写入与读取（跨刷新恢复）', async () => {
  const { DB } = await createDatabase();
  await DB.saveReviewSession({
    id: 'review-session-active',
    kind: 'review-session',
    queue: [3, 4],
    buffer: [{ wordId: 1, spacing: 3, remaining: 1 }],
    debt: { 1: 2 },
    reinsertCount: { 1: 1 },
    stubborn: {},
    createdAt: Date.now()
  });

  const restored = await DB.getReviewSession('review-session-active');
  assert.equal(restored.kind, 'review-session');
  assert.deepEqual(restored.queue, [3, 4]);
  assert.equal(restored.debt['1'], 2);

  await DB.deleteReviewSession('review-session-active');
  assert.equal(await DB.getReviewSession('review-session-active'), null);
});

test('非 review-session 类型的记录不会被误读', async () => {
  const { DB } = await createDatabase();
  await DB.saveContextReviewSession({ id: 'context-review-active', items: [], kind: 'context' });
  assert.equal(await DB.getReviewSession('context-review-active'), null);
});
