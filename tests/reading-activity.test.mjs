import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createReadingActivityTracker,
  readingActivityDedupeKey,
  splitActiveDuration
} from '../src/reading-activity.mjs';

const DAY_ONE = new Date(2026, 7, 28, 12, 0, 0).getTime();
const dayAt = (dayOffset, hour, minute = 0, second = 0) => {
  const date = new Date(2026, 7, 28 + dayOffset, hour, minute, second);
  return date.getTime();
};

function createMemoryDb({ failSaves = 0 } = {}) {
  const records = new Map();
  let saveFailures = failSaves;
  const saves = [];
  return {
    records,
    saves,
    async getLearningActivityByDedupeKey(key) {
      return records.get(key) ? structuredClone(records.get(key)) : null;
    },
    async saveLearningActivity(record) {
      saves.push(structuredClone(record));
      if (saveFailures > 0) {
        saveFailures -= 1;
        throw new Error('activity save failed');
      }
      records.set(record.dedupeKey, structuredClone(record));
      return structuredClone(record);
    }
  };
}

function makeTracker(db, clock, completionId = 'reading:article-1:cycle-1') {
  return createReadingActivityTracker({
    db,
    articleId: 'article-1',
    articleTitle: 'A reading article',
    completionId,
    now: () => clock.now,
    saveIntervalMs: Number.MAX_SAFE_INTEGER
  });
}

test('preview activity never creates an active reading slice, but activation backfills elapsed time', async () => {
  const db = createMemoryDb();
  const clock = { now: DAY_ONE };
  const tracker = makeTracker(db, clock);

  tracker.record({ phase: 'preview', elapsedSeconds: 5, nowMs: clock.now });
  await tracker.flush();
  assert.equal(db.records.size, 0);

  clock.now += 25_000;
  tracker.record({ phase: 'active', elapsedSeconds: 30, nowMs: clock.now, maxContentProgress: 0.2 });
  await tracker.flush();
  const record = [...db.records.values()][0];
  assert.equal(record.type, 'reading_active_slice');
  assert.equal(record.payload.durationMs, 30_000);
  assert.equal(record.payload.maxContentProgress, 0.2);
});

test('body lookup promotion records all elapsed seconds since entering the article', async () => {
  const db = createMemoryDb();
  const clock = { now: DAY_ONE };
  const tracker = makeTracker(db, clock);

  tracker.record({ phase: 'preview', elapsedSeconds: 8, nowMs: clock.now });
  clock.now += 1_000;
  tracker.record({ phase: 'active', elapsedSeconds: 8, nowMs: clock.now, bodyLookup: true });
  await tracker.flush();

  assert.equal([...db.records.values()][0].payload.durationMs, 8_000);
});

test('multiple timer checkpoints add only the new elapsed delta', async () => {
  const db = createMemoryDb();
  const clock = { now: DAY_ONE };
  const tracker = makeTracker(db, clock);

  tracker.record({ phase: 'active', elapsedSeconds: 30, nowMs: clock.now });
  clock.now += 15_000;
  tracker.record({ phase: 'active', elapsedSeconds: 45, nowMs: clock.now });
  clock.now += 15_000;
  tracker.record({ phase: 'active', elapsedSeconds: 60, nowMs: clock.now });
  await tracker.flush();

  assert.equal([...db.records.values()][0].payload.durationMs, 60_000);
});

test('same cycle resumes by adding to the existing same-day activity row', async () => {
  const db = createMemoryDb();
  const clock = { now: DAY_ONE };
  const first = makeTracker(db, clock);
  first.record({ phase: 'active', elapsedSeconds: 600, nowMs: clock.now });
  await first.flush();

  clock.now += 300_000;
  const resumed = makeTracker(db, clock);
  await resumed.initialize();
  resumed.record({ phase: 'active', elapsedSeconds: 300, nowMs: clock.now });
  await resumed.flush();

  assert.equal(db.records.size, 1);
  assert.equal([...db.records.values()][0].payload.durationMs, 900_000);
  assert.equal([...db.records.values()][0].dedupeKey, readingActivityDedupeKey('2026-08-28', 'reading:article-1:cycle-1'));
});

test('a new reading cycle for the same article gets a different activity identity', async () => {
  const db = createMemoryDb();
  const clock = { now: DAY_ONE };
  const first = makeTracker(db, clock, 'reading:article-1:cycle-1');
  first.record({ phase: 'active', elapsedSeconds: 30, nowMs: clock.now });
  await first.flush();
  const second = makeTracker(db, clock, 'reading:article-1:cycle-2');
  second.record({ phase: 'active', elapsedSeconds: 30, nowMs: clock.now + 1_000 });
  await second.flush();

  assert.equal(db.records.size, 2);
  assert.notEqual(
    readingActivityDedupeKey('2026-08-28', 'reading:article-1:cycle-1'),
    readingActivityDedupeKey('2026-08-28', 'reading:article-1:cycle-2')
  );
});

test('guide indexes are unique per day and can be revisited on the next day', async () => {
  const db = createMemoryDb();
  const clock = { now: dayAt(0, 23, 59, 30) };
  const tracker = makeTracker(db, clock);
  tracker.record({ phase: 'active', elapsedSeconds: 30, nowMs: clock.now, guideVisitedIndexes: [1, 2, 2], totalSentences: 5 });
  clock.now += 1_000;
  tracker.record({ phase: 'active', elapsedSeconds: 31, nowMs: clock.now, guideVisitedIndexes: [2, 3], totalSentences: 5 });
  await tracker.flush();

  clock.now = dayAt(1, 0, 0, 30);
  tracker.record({ phase: 'active', elapsedSeconds: 61, nowMs: clock.now, guideVisitedIndexes: [1], totalSentences: 5 });
  await tracker.flush();

  assert.equal(db.records.get(readingActivityDedupeKey('2026-08-28', 'reading:article-1:cycle-1')).payload.guideVisitedCount, 3);
  assert.equal(db.records.get(readingActivityDedupeKey('2026-08-29', 'reading:article-1:cycle-1')).payload.guideVisitedCount, 1);
});

test('active duration crossing midnight is split between local days', () => {
  const segments = splitActiveDuration({
    fromMs: dayAt(0, 23, 59, 30),
    toMs: dayAt(1, 0, 0, 30),
    durationMs: 60_000
  });
  assert.deepEqual(segments.map(item => [item.dayKey, item.durationMs]), [
    ['2026-08-28', 30_000],
    ['2026-08-29', 30_000]
  ]);
});

test('failed activity save retains the pending snapshot for a later retry', async () => {
  const db = createMemoryDb({ failSaves: 1 });
  const clock = { now: DAY_ONE };
  const tracker = makeTracker(db, clock);
  tracker.record({ phase: 'active', elapsedSeconds: 30, nowMs: clock.now });

  await assert.rejects(() => tracker.flush(), /activity save failed/);
  assert.equal(tracker.getStatus().pendingCount, 1);
  await tracker.flush();
  assert.equal(tracker.getStatus().pendingCount, 0);
  assert.equal(db.records.size, 1);
});

test('failed cross-midnight save retains every pending day for retry', async () => {
  const db = createMemoryDb({ failSaves: 1 });
  const clock = { now: dayAt(1, 0, 0, 30) };
  const tracker = makeTracker(db, clock);

  tracker.record({ phase: 'active', elapsedSeconds: 60, nowMs: clock.now });
  await assert.rejects(() => tracker.flush(), /activity save failed/);
  assert.equal(tracker.getStatus().pendingCount, 2);

  await tracker.flush();
  assert.equal(tracker.getStatus().pendingCount, 0);
  assert.equal(db.records.size, 2);
  assert.equal(db.records.get(readingActivityDedupeKey('2026-08-28', 'reading:article-1:cycle-1')).payload.durationMs, 30_000);
  assert.equal(db.records.get(readingActivityDedupeKey('2026-08-29', 'reading:article-1:cycle-1')).payload.durationMs, 30_000);
});

test('completion flag is persisted without changing the activity identity', async () => {
  const db = createMemoryDb();
  const clock = { now: DAY_ONE };
  const tracker = makeTracker(db, clock);
  tracker.record({ phase: 'active', elapsedSeconds: 30, nowMs: clock.now });
  await tracker.markCompleted({ nowMs: clock.now });
  await tracker.flush();

  const record = [...db.records.values()][0];
  assert.equal(record.payload.completedToday, true);
  assert.equal(record.sessionId, 'reading:article-1:cycle-1');
});
