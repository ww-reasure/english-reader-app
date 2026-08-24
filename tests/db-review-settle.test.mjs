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
  const adapted = source
    .replace(
      "import { getStemForm } from './helpers.js';",
      "const getStemForm = word => String(word || '').trim().toLowerCase();"
    )
    .replace("from './cloud-article-metadata.mjs'", `from '${metadataUrl}'`)
    .replace("from './learning-day.mjs'", `from '${learningDayUrl}'`)
    .replace("from './learning-activity.mjs'", `from '${learningActivityUrl}'`);
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
