import assert from 'node:assert/strict';
import test from 'node:test';
import { DAY_MS, addWrongState, readdMasteredWrongState, scheduleTranslationReview, transitionObjectiveReview } from '../src/exam/review-scheduler.mjs';

test('explicitly adding a wrong question schedules its first review one day later', () => {
  const now = 1_700_000_000_000;
  const state = addWrongState({
    now,
    attempt: {
      attemptId: 'attempt-origin',
      examId: 'kaoyan_en1',
      bankId: 'builtin_kaoyan_en1',
      packageId: 'local.kaoyan.en1',
      paperKey: 'kaoyan_en1_2026',
      unitKey: 'part_a_text_1'
    },
    questionKey: 'kaoyan_en1_2026_q22'
  });

  assert.equal(state.status, 'active');
  assert.equal(state.originAttemptId, 'attempt-origin');
  assert.equal(state.independentCorrectStreak, 0);
  assert.equal(state.nextDueAt, now + DAY_MS);
  assert.equal(state.wrongCount, 1);
});

test('only a currently due Review Center attempt advances independent correctness once', () => {
  const now = 1_700_000_000_000;
  const state = { ...addWrongState({ now: now - DAY_MS, attempt: { attemptId: 'origin', examId: 'e', bankId: 'b', packageId: 'p', paperKey: 'paper', unitKey: 'unit' }, questionKey: 'q' }), nextDueAt: now };
  const reviewAttempt = { attemptId: 'review-1', practiceOrigin: 'review_center_due', reviewEligibleQuestionKeys: ['q'] };
  const first = transitionObjectiveReview({ state, attempt: reviewAttempt, response: { questionKey: 'q', correct: true, unanswered: false }, now });
  assert.equal(first.independentCorrectStreak, 1);
  assert.equal(first.nextDueAt, now + 3 * DAY_MS);
  assert.equal(transitionObjectiveReview({ state: first, attempt: reviewAttempt, response: { questionKey: 'q', correct: true, unanswered: false }, now }), first);
  const parallel = transitionObjectiveReview({ state: first, attempt: { ...reviewAttempt, attemptId: 'review-2' }, response: { questionKey: 'q', correct: true, unanswered: false }, now });
  assert.equal(parallel.independentCorrectStreak, 1);
  const retry = transitionObjectiveReview({ state: first, attempt: { ...reviewAttempt, attemptId: 'retry', practiceOrigin: 'result_retry' }, response: { questionKey: 'q', correct: true, unanswered: false }, now: first.nextDueAt });
  assert.equal(retry.independentCorrectStreak, 1);
});

test('second due correct masters, wrong reactivates, and unanswered preserves due state', () => {
  const now = 1_700_000_000_000;
  const attempt = { attemptId: 'review-2', practiceOrigin: 'review_center_due', reviewEligibleQuestionKeys: ['q'] };
  const state = { ...addWrongState({ now: now - DAY_MS, attempt: { attemptId: 'origin', examId: 'e', bankId: 'b', packageId: 'p', paperKey: 'paper', unitKey: 'unit' }, questionKey: 'q' }), independentCorrectStreak: 1, nextDueAt: now };
  const mastered = transitionObjectiveReview({ state, attempt, response: { questionKey: 'q', correct: true, unanswered: false }, now });
  assert.equal(mastered.status, 'mastered');
  assert.equal(mastered.nextDueAt, null);
  const reactivated = transitionObjectiveReview({ state: mastered, attempt: { attemptId: 'normal', practiceOrigin: 'normal' }, response: { questionKey: 'q', correct: false, unanswered: false }, now });
  assert.equal(reactivated.status, 'active');
  assert.equal(reactivated.independentCorrectStreak, 0);
  const due = { ...reactivated, nextDueAt: now };
  assert.equal(transitionObjectiveReview({ state: due, attempt, response: { questionKey: 'q', correct: false, unanswered: true }, now }), due);
  const readded = readdMasteredWrongState({ state: mastered, now });
  assert.equal(readded.status, 'active');
  assert.equal(readded.nextDueAt, now + DAY_MS);
});

test('translation review scheduling is manual and preserves its first mark timestamp', () => {
  const now = 1_700_000_000_000;
  const attempt = { attemptId: 'translation-attempt', examId: 'e', bankId: 'b', packageId: 'p', paperKey: 'paper', unitKey: 'unit' };
  const needs = scheduleTranslationReview({ attempt, questionKey: 't', status: 'needs_review', now });
  const mostly = scheduleTranslationReview({ existing: needs, attempt, questionKey: 't', status: 'mostly_mastered', now: now + 1 });
  const mastered = scheduleTranslationReview({ existing: mostly, attempt, questionKey: 't', status: 'mastered', now: now + 2 });
  assert.equal(needs.nextDueAt, now);
  assert.equal(mostly.nextDueAt, now + 1 + 7 * DAY_MS);
  assert.equal(mostly.createdAt, needs.createdAt);
  assert.equal(mastered.nextDueAt, null);
});
