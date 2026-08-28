import assert from 'node:assert/strict';
import test from 'node:test';

import { getPracticeProgress } from '../src/review-practice.mjs';

const NOW = new Date(2026, 7, 24, 12, 0, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

function startOfLocalDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function createDb(events) {
  return {
    async getPracticeReviewEvents() {
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
