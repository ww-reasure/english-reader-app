import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasCompleteAnswers,
  normalizeAnswer,
  normalizeQuestionSet
} from '../src/assessment-questions.mjs';

const validQuestions = [
  { question: 'What is the main idea?', options: ['One', 'Two', 'Three', 'Four'], answer: 'A' },
  { question: 'Which detail is correct?', options: ['One', 'Two', 'Three', 'Four'], answer: '2' },
  { question: 'What can be inferred?', options: ['One', 'Two', 'Three', 'Four'], answer: 3 }
];

test('normalizes numeric and letter answers into zero-based indexes', () => {
  assert.equal(normalizeAnswer('A', 4), 0);
  assert.equal(normalizeAnswer('d', 4), 3);
  assert.equal(normalizeAnswer('2', 4), 2);
  assert.equal(normalizeAnswer(0, 4), 0);
});

test('rejects an incomplete AI question set', () => {
  const result = normalizeQuestionSet([
    { question: 'Q', options: ['a', 'b', 'c', 'd'], answer: 'A' }
  ]);

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'expected_three_questions');
});

test('normalizes exactly three valid AI questions with letter and numeric answers', () => {
  const result = normalizeQuestionSet(validQuestions);

  assert.equal(result.valid, true);
  assert.deepEqual(result.questions.map(question => question.answer), [0, 2, 3]);
});

test('requires an answer for every valid question', () => {
  const questions = normalizeQuestionSet(validQuestions).questions;

  assert.equal(hasCompleteAnswers(questions, { 0: 0, 1: 2, 2: 3 }), true);
  assert.equal(hasCompleteAnswers(questions, { 0: 0, 1: null, 2: 3 }), false);
});
