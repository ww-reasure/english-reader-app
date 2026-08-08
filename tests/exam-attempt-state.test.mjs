import assert from 'node:assert/strict';
import test from 'node:test';
import { createAttempt, createResponse, createResponseId, submitAttempt } from '../src/exam/attempt-state.mjs';

const base = {
  examId: 'kaoyan_en1',
  bankId: 'synthetic_kaoyan_bank',
  packageId: 'synthetic.kaoyan.en1',
  paperKey: 'synthetic_kaoyan_2026',
  unitKey: 'synthetic_kaoyan_2026_text_1',
  questionKeys: ['q21', 'q22'],
  optionOrders: { q21: ['A', 'B', 'C', 'D'], q22: ['A', 'B', 'C', 'D'] },
  packVersion: '1.0.0',
  contentHashSnapshot: 'sha256:abc'
};

test('createAttempt starts in_progress with deterministic response ids', () => {
  const attempt = createAttempt(base);
  assert.equal(attempt.status, 'in_progress');
  assert.equal(attempt.currentQuestionKey, 'q21');
  assert.equal(createResponseId(attempt.attemptId, 'q21'), `${attempt.attemptId}:q21`);
  const response = createResponse(attempt, 'q21', { answer: 'B' });
  assert.equal(response.responseId, `${attempt.attemptId}:q21`);
  assert.equal(response.answer, 'B');
  assert.equal(response.submittedAt, null);
});

test('createAttempt persists an explicit review origin and eligible question snapshot', () => {
  const attempt = createAttempt({
    ...base,
    mode: 'wrong_review',
    practiceOrigin: 'review_center_due',
    reviewEligibleQuestionKeys: ['q22']
  });
  assert.equal(attempt.practiceOrigin, 'review_center_due');
  assert.deepEqual(attempt.reviewEligibleQuestionKeys, ['q22']);
});

test('submitAttempt grades every response and makes the attempt immutable', () => {
  const attempt = createAttempt(base);
  const questions = [
    { questionKey: 'q21', type: 'single_choice', points: 2, answer: 'B' },
    { questionKey: 'q22', type: 'single_choice', points: 2, answer: 'A' }
  ];
  const responses = [
    createResponse(attempt, 'q21', { answer: 'B' }),
    createResponse(attempt, 'q22', { answer: null })
  ];
  const result = submitAttempt({ attempt, responses, questions, activeDurationMs: 1200 });
  assert.equal(result.attempt.status, 'submitted');
  assert.equal(result.attempt.activeDurationMs, 1200);
  assert.equal(result.responses[0].correct, true);
  assert.equal(result.responses[0].pointsEarned, 2);
  assert.equal(result.responses[1].correct, false);
  assert.equal(result.responses[1].unanswered, true);
  assert.throws(
    () => submitAttempt({ attempt: result.attempt, responses, questions }),
    /不可修改/
  );
});
