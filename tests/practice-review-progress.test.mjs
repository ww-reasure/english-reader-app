import assert from 'node:assert/strict';
import test from 'node:test';

import { getPracticeProgress, RECENT_ADDED_DAYS } from '../src/review-practice.mjs';

const NOW = new Date(2026, 7, 24, 12, 0, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

function startOfLocalDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function createDb(events) {
  const calls = [];
  return {
    calls,
    async getPracticeReviewEvents(options) {
      calls.push(options);
      return events;
    }
  };
}

test('practice progress counts distinct rated words for the current scope and local day', async () => {
  const dayStart = startOfLocalDay(NOW);
  const progress = await getPracticeProgress({
    db: createDb([
      { wordId: 1, source: 'practice-flashcard', practiceScope: 'today_added', reviewedAt: dayStart + 1_000 },
      { wordId: 1, source: 'practice-flashcard', practiceScope: 'today_added', reviewedAt: dayStart + 2_000 },
      { wordId: 2, source: 'practice-flashcard', practiceScope: 'manual', reviewedAt: dayStart + 3_000 },
      { wordId: 3, source: 'flashcard', practiceScope: 'today_added', reviewedAt: dayStart + 4_000 },
      { wordId: 4, source: 'practice-flashcard', practiceScope: 'today_added', reviewedAt: dayStart - 1_000 },
      { wordId: 99, source: 'practice-flashcard', practiceScope: 'today_added', reviewedAt: dayStart + 5_000 }
    ]),
    scope: 'today_added',
    wordIds: [1, 2, 3, 4],
    now: NOW
  });

  assert.deepEqual(progress.completedWordIds, [1]);
  assert.equal(progress.completedCount, 1);
  assert.equal(progress.totalCount, 4);
  assert.equal(progress.remainingCount, 3);
  assert.equal(progress.done, false);
  assert.equal(progress.dateKey, '2026-08-24');
});

test('practice progress survives leaving and reopening by rereading reviewEvents', async () => {
  const dayStart = startOfLocalDay(NOW);
  const events = [1, 2, 3, 4].map((wordId, index) => ({
    wordId,
    source: 'practice-flashcard',
    practiceScope: 'today_added',
    reviewedAt: dayStart + index * 1_000 + 1
  }));
  const db = createDb(events.slice(0, 1));

  const first = await getPracticeProgress({ db, scope: 'today_added', wordIds: [1, 2, 3, 4], now: NOW });
  assert.equal(first.completedCount, 1);

  db.getPracticeReviewEvents = async () => events;
  const resumed = await getPracticeProgress({ db, scope: 'today_added', wordIds: [1, 2, 3, 4], now: NOW });
  assert.deepEqual(resumed.completedWordIds, [1, 2, 3, 4]);
  assert.equal(resumed.completedCount, 4);
  assert.equal(resumed.remainingCount, 0);
  assert.equal(resumed.done, true);
});

test('today_added progress resets when the local calendar day changes', async () => {
  const dayStart = startOfLocalDay(NOW);
  const db = createDb([{
    wordId: 1,
    source: 'practice-flashcard',
    practiceScope: 'today_added',
    reviewedAt: dayStart + 1_000
  }]);
  const today = await getPracticeProgress({
    db,
    scope: 'today_added',
    wordIds: [1],
    now: NOW
  });
  const tomorrow = new Date(NOW);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(12, 0, 0, 0);
  const nextDay = await getPracticeProgress({
    db,
    scope: 'today_added',
    wordIds: [1],
    now: tomorrow.getTime()
  });

  assert.equal(today.completedCount, 1);
  assert.equal(nextDay.completedCount, 0);
  assert.equal(nextDay.dateKey, '2026-08-25');
});

test('recent_added progress keeps yesterday completion within the seven-day window', async () => {
  const yesterdayStart = startOfLocalDay(NOW - DAY);
  const db = createDb([
    ...[1, 2, 3, 4].map((wordId, index) => ({
      wordId,
      source: 'practice-flashcard',
      practiceScope: 'recent_added',
      reviewedAt: yesterdayStart + index * 1_000 + 1
    })),
    {
      wordId: 1,
      source: 'practice-flashcard',
      practiceScope: 'recent_added',
      reviewedAt: yesterdayStart + 10_000
    },
    {
      wordId: 5,
      source: 'practice-flashcard',
      practiceScope: 'recent_added',
      reviewedAt: NOW - (RECENT_ADDED_DAYS + 1) * DAY
    }
  ]);

  const progress = await getPracticeProgress({
    db,
    scope: 'recent_added',
    wordIds: [1, 2, 3, 4, 5],
    now: NOW
  });

  assert.deepEqual(progress.completedWordIds, [1, 2, 3, 4]);
  assert.equal(progress.completedCount, 4);
  assert.equal(progress.remainingCount, 1);
  assert.equal(progress.done, false);
  assert.equal(db.calls[0].from, NOW - RECENT_ADDED_DAYS * DAY);
});

test('practice progress reports full completion without changing the learn word record', async () => {
  const dayStart = startOfLocalDay(NOW);
  const before = {
    id: 7,
    interval: 30,
    state: 'review',
    easeFactor: 2.5,
    reviewCount: 8,
    reviewRevision: 12,
    nextReview: NOW + DAY * 30
  };
  const word = structuredClone(before);
  const progress = await getPracticeProgress({
    db: {
      async getPracticeReviewEvents() {
        return [{ wordId: 7, source: 'practice-flashcard', practiceScope: 'manual', reviewedAt: dayStart + 1_000 }];
      },
      async findLearnWordById() {
        return word;
      }
    },
    scope: 'manual',
    wordIds: [7],
    now: NOW
  });

  assert.equal(progress.completedCount, 1);
  assert.equal(progress.done, true);
  assert.deepEqual(word, before);
});
