import assert from 'node:assert/strict';
import test from 'node:test';
import { DAY_MS, addWrongState, readdMasteredWrongState, scheduleTranslationReview, transitionObjectiveReview } from '../src/exam/review-scheduler.mjs';

test('explicitly adding a wrong question is immediately available for manual review', () => {
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
  assert.equal(state.nextDueAt, null);
  assert.equal(state.wrongCount, 1);
});

test('each distinct submitted manual Review Center attempt advances correctness once without due gating', () => {
  const now = 1_700_000_000_000;
  const state = { ...addWrongState({ now: now - DAY_MS, attempt: { attemptId: 'origin', examId: 'e', bankId: 'b', packageId: 'p', paperKey: 'paper', unitKey: 'unit' }, questionKey: 'q' }), nextDueAt: now };
  const reviewAttempt = { attemptId: 'review-1', status: 'submitted', practiceOrigin: 'review_center_manual', reviewEligibleQuestionKeys: ['q'] };
  const first = transitionObjectiveReview({ state, attempt: reviewAttempt, response: { questionKey: 'q', correct: true, unanswered: false }, now });
  assert.equal(first.independentCorrectStreak, 1);
  assert.equal(first.nextDueAt, null);
  assert.equal(transitionObjectiveReview({ state: first, attempt: reviewAttempt, response: { questionKey: 'q', correct: true, unanswered: false }, now }), first);
  const parallel = transitionObjectiveReview({ state: first, attempt: { ...reviewAttempt, attemptId: 'review-2' }, response: { questionKey: 'q', correct: true, unanswered: false }, now });
  assert.equal(parallel.independentCorrectStreak, 2);
  assert.equal(parallel.status, 'mastered');
  const retry = transitionObjectiveReview({ state: first, attempt: { ...reviewAttempt, attemptId: 'retry', practiceOrigin: 'result_retry' }, response: { questionKey: 'q', correct: true, unanswered: false }, now: first.nextDueAt });
  assert.equal(retry.independentCorrectStreak, 1);
});

test('second submitted manual correct masters, wrong reactivates, and unanswered preserves state', () => {
  const now = 1_700_000_000_000;
  const attempt = { attemptId: 'review-2', status: 'submitted', practiceOrigin: 'review_center_manual', reviewEligibleQuestionKeys: ['q'] };
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
  assert.equal(readded.nextDueAt, null);
});

test('translation review scheduling is manual and preserves its first mark timestamp', () => {
  const now = 1_700_000_000_000;
  const attempt = { attemptId: 'translation-attempt', examId: 'e', bankId: 'b', packageId: 'p', paperKey: 'paper', unitKey: 'unit' };
  const needs = scheduleTranslationReview({ attempt, questionKey: 't', status: 'needs_review', now });
  const mostly = scheduleTranslationReview({ existing: needs, attempt, questionKey: 't', status: 'mostly_mastered', now: now + 1 });
  const mastered = scheduleTranslationReview({ existing: mostly, attempt, questionKey: 't', status: 'mastered', now: now + 2 });
  assert.equal(needs.nextDueAt, null);
  assert.equal(mostly.nextDueAt, null);
  assert.equal(mostly.createdAt, needs.createdAt);
  assert.equal(mastered.nextDueAt, null);
});
