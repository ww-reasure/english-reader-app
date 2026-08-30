import assert from 'node:assert/strict';
import test from 'node:test';
import { externalReviewCreditDays, scheduleExternalReview } from '../src/external-review-scheduler.mjs';

test('credit is 25 percent rounded and bounded to one through seven days', () => {
  assert.equal(externalReviewCreditDays(2), 1);
  assert.equal(externalReviewCreditDays(7), 2);
  assert.equal(externalReviewCreditDays(30), 7);
});

test('normal overdue word receives a bounded candidate without changing memory fields', () => {
  const now = 1_800_000_000_000;
  const word = { interval: 30, nextReview: now - 1000, easeFactor: 2.4, reviewCount: 9, lastQuality: 5, recoveryStage: 0, reviewRevision: 4 };
  const result = scheduleExternalReview(word, now);
  assert.equal(result.scheduleChanged, true);
  assert.equal(result.patch.nextReview, now + 7 * 86400000);
  assert.equal(result.patch.externalReviewCount, 1);
  assert.equal(result.patch.reviewRevision, 5);
  assert.equal('interval' in result.patch, false);
});

test('future schedule, recovery, and stubborn words are not pushed out', () => {
  const now = 1_800_000_000_000;
  assert.equal(scheduleExternalReview({ interval: 7, nextReview: now + 9 * 86400000 }, now).scheduleChanged, false);
  assert.equal(scheduleExternalReview({ interval: 7, nextReview: now, recoveryStage: 2 }, now).reason, 'recovery');
  assert.equal(scheduleExternalReview({ interval: 7, nextReview: now, stubbornUntil: now }, now).reason, 'stubborn');
});
