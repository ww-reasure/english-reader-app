import assert from 'node:assert/strict';
import test from 'node:test';

import { planReviewBatches } from '../src/components/review-generation-plan.mjs';

const at = (day, hour = 12) => new Date(2026, 6, day, hour, 0, 0, 0).getTime();

test('plans at most four eight-word review readings and skips words already saved today', () => {
  const words = Array.from({ length: 60 }, (_value, index) => `word${index + 1}`);
  const plan = planReviewBatches({
    words,
    articles: [
      { reviewMode: true, createdAt: at(27, 9), usedWords: ['word1', 'WORD2', 'word3'] },
      { reviewMode: true, createdAt: at(26, 20), usedWords: ['word4'] },
      { reviewMode: false, createdAt: at(27, 10), usedWords: ['word5'] }
    ],
    now: at(27, 15)
  });

  assert.equal(plan.coveredWords.length, 3);
  assert.equal(plan.batches.length, 4);
  assert.deepEqual(plan.batches[0], ['word4', 'word5', 'word6', 'word7', 'word8', 'word9', 'word10', 'word11']);
  assert.equal(plan.selectedWords.length, 32);
  assert.equal(plan.remainingWords.length, 25);
});

test('keeps an unsaved failed batch eligible for the next review attempt', () => {
  const plan = planReviewBatches({
    words: ['alpha', 'beta', 'gamma', 'delta'],
    articles: [
      { reviewMode: true, createdAt: at(27), usedWords: ['alpha'] }
      // A failed alpha/beta request has no saved article, so beta remains due.
    ],
    now: at(27, 15)
  });

  assert.deepEqual(plan.batches, [['beta', 'gamma', 'delta']]);
  assert.deepEqual(plan.remainingWords, []);
});
