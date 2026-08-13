import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ContextReviewResult,
  scheduleContextReview
} from '../src/context-review-scheduler.mjs';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-29T08:00:00.000Z');

test('unknown context recognition enters recovery without a forced 10-minute deadline', () => {
  const next = scheduleContextReview({
    interval: 20,
    reviewCount: 5,
    easeFactor: 2.5,
    state: 'review',
    lapseCount: 1
  }, ContextReviewResult.UNKNOWN, NOW);

  assert.equal(next.recoveryStage, 2);
  assert.equal(next.recoveryTarget, 2);
  assert.equal(next.lastDebt, 2);
  assert.equal(next.interval, 20, '成熟词 recovery 期间保留原 interval');
  assert.equal(next.nextReview, NOW, '不再按真实分钟强制，而是下次打开即可复习');
  assert.equal(next.contextResult, 'unknown');
});

test('uncertain context recognition enters fragile recovery without a forced 30-minute deadline', () => {
  const next = scheduleContextReview({
    interval: 20,
    reviewCount: 5,
    easeFactor: 2.5,
    state: 'review',
    lapseCount: 2
  }, ContextReviewResult.UNCERTAIN, NOW);

  assert.equal(next.recoveryStage, 1);
  assert.equal(next.lastDebt, 1);
  assert.equal(next.interval, 20);
  assert.equal(next.nextReview, NOW);
  assert.equal(next.contextResult, 'uncertain');
});

test('known context recognition without recovery extends the established interval', () => {
  const next = scheduleContextReview({
    interval: 40,
    reviewCount: 8,
    easeFactor: 2.5,
    state: 'review',
    lapseCount: 1
  }, ContextReviewResult.KNOWN, NOW);

  assert.equal(next.state, 'review');
  assert.ok(next.interval >= 40);
  assert.equal(next.nextReview, NOW + next.interval * DAY);
  assert.equal(next.recoveryStage, 0);
  assert.equal(next.contextResult, 'known');
});

test('known context recognition during recovery decrements the recovery stage', () => {
  const next = scheduleContextReview({
    interval: 1,
    reviewCount: 2,
    recoveryStage: 2,
    recoveryTarget: 2,
    lastDebt: 2
  }, ContextReviewResult.KNOWN, NOW);

  assert.equal(next.recoveryStage, 1);
  assert.equal(next.recoveryTarget, 2);
  assert.equal(next.nextReview, NOW, '恢复未完成，下次打开继续巩固');
});

test('skipped context recognition does not produce a schedule', () => {
  assert.equal(scheduleContextReview({ interval: 4 }, ContextReviewResult.SKIPPED, NOW), null);
});
