import assert from 'node:assert/strict';
import test from 'node:test';

import { ReviewQueueCoordinator } from '../src/review-queue-coordinator.mjs';

test('both review modes read the same due queue and capture the current revision', async () => {
  const words = [
    { id: 1, word: 'shared', nextReview: 10, reviewRevision: 3 },
    { id: 2, word: 'future', nextReview: 999, reviewRevision: 1 }
  ];
  const coordinator = new ReviewQueueCoordinator({
    db: { getAllLearnWords: async () => words },
    srs: { getDueWords: input => input.filter(word => word.nextReview <= 10) }
  });

  const recall = await coordinator.getDueWords({ limit: 20 });
  const context = await coordinator.getDueWords({ limit: 10 });

  assert.deepEqual(recall, [{ ...words[0], expectedRevision: 3 }]);
  assert.deepEqual(context, recall);
});

test('revalidation skips a word reviewed by the other mode', async () => {
  const coordinator = new ReviewQueueCoordinator({
    db: { findLearnWordById: async () => ({ id: 1, reviewRevision: 4, nextReview: 999 }) },
    srs: { getDueWords: words => words.filter(word => word.nextReview <= 10) },
    now: () => 10
  });

  assert.deepEqual(await coordinator.revalidate({ id: 1, expectedRevision: 3 }), {
    current: false,
    reason: 'reviewed-elsewhere',
    word: null
  });
});

test('uses exam priority only as a tie-breaker inside the shared due queue', async () => {
  const words = [
    { id: 1, word: 'ordinary', nextReview: null, state: 'new', interval: 0 },
    { id: 2, word: 'frequent', nextReview: null, state: 'new', interval: 0 },
    { id: 3, word: 'future', nextReview: 999, state: 'review', interval: 3 }
  ];
  const coordinator = new ReviewQueueCoordinator({
    db: { getAllLearnWords: async () => words },
    srs: { getDueWords: input => input.filter(word => !word.nextReview || word.nextReview <= 10) },
    examPriority: async word => word.word === 'frequent' ? 90 : 0
  });

  const due = await coordinator.getDueWords({ limit: 10, targetTrack: 'kaoyan1' });
  assert.deepEqual(due.map(word => word.word), ['frequent', 'ordinary']);
  assert.equal(due.some(word => word.word === 'future'), false);
});
