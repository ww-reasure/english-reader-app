import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ContextReviewResult,
  scheduleContextReview
} from '../src/context-review-scheduler.mjs';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-29T08:00:00.000Z');

test('unknown context recognition reuses the forgotten relearning schedule', () => {
  const next = scheduleContextReview({
    interval: 20,
    reviewCount: 5,
    easeFactor: 2.5,
    state: 'review',
    lapseCount: 1
  }, ContextReviewResult.UNKNOWN, NOW);

  assert.equal(next.state, 'relearning');
  assert.equal(next.interval, 0);
  assert.equal(next.lapseCount, 2);
  assert.equal(next.nextReview, NOW + 10 * 60 * 1000);
  assert.equal(next.contextResult, 'unknown');
});

test('uncertain context recognition schedules direct recall soon without a lapse', () => {
  const next = scheduleContextReview({
    interval: 20,
    reviewCount: 5,
    easeFactor: 2.5,
    state: 'review',
    lapseCount: 2
  }, ContextReviewResult.UNCERTAIN, NOW);

  assert.equal(next.state, 'relearning');
  assert.equal(next.interval, 0);
  assert.equal(next.lapseCount, 2);
  assert.equal(next.nextReview, NOW + 30 * 60 * 1000);
  assert.equal(next.contextResult, 'uncertain');
});

test('known context recognition extends an established interval only mildly', () => {
  const next = scheduleContextReview({
    interval: 40,
    reviewCount: 8,
    easeFactor: 2.5,
    state: 'review',
    lapseCount: 1
  }, ContextReviewResult.KNOWN, NOW);

  assert.equal(next.state, 'review');
  assert.equal(next.interval, 47);
  assert.equal(next.nextReview, NOW + 47 * DAY);
  assert.equal(next.easeFactor, 2.5);
  assert.equal(next.contextResult, 'known');
});

test('known context recognition never exceeds 1.25x on a short established interval', () => {
  const next = scheduleContextReview({
    interval: 1,
    reviewCount: 2,
    easeFactor: 2.5,
    state: 'review'
  }, ContextReviewResult.KNOWN, NOW);

  assert.equal(next.interval, 1.25);
  assert.equal(next.nextReview, NOW + 1.25 * DAY);
});

test('known context recognition gives a new word only a one-day learning step', () => {
  const next = scheduleContextReview({ state: 'new', reviewCount: 0 }, ContextReviewResult.KNOWN, NOW);

  assert.equal(next.state, 'learning');
  assert.equal(next.interval, 1);
  assert.equal(next.reviewCount, 1);
  assert.equal(next.nextReview, NOW + DAY);
});

test('skipped context recognition does not produce a schedule', () => {
  assert.equal(scheduleContextReview({ interval: 4 }, ContextReviewResult.SKIPPED, NOW), null);
});
