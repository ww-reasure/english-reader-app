import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOptionOrders, createOptionOrder, gradeSingleChoice, mulberry32 } from '../src/exam/grading.mjs';

const options = [
  { key: 'A', text: 'One' },
  { key: 'B', text: 'Two' },
  { key: 'C', text: 'Three' },
  { key: 'D', text: 'Four' }
];

test('null seed keeps the original stable option order', () => {
  assert.deepEqual(createOptionOrder(options, null), ['A', 'B', 'C', 'D']);
});

test('same seed produces the same deterministic order', () => {
  assert.deepEqual(createOptionOrder(options, 42), createOptionOrder(options, 42));
  assert.deepEqual(createOptionOrder(options, 7), createOptionOrder(options, 7));
});

test('a different seed can reorder options while preserving stable keys', () => {
  const first = createOptionOrder(options, 42);
  const second = createOptionOrder(options, 7);
  assert.deepEqual([...first].sort(), ['A', 'B', 'C', 'D']);
  assert.deepEqual([...second].sort(), ['A', 'B', 'C', 'D']);
  assert.notDeepEqual(first, second);
});

test('mulberry32 is deterministic', () => {
  const random = mulberry32(123);
  const first = [random(), random(), random()];
  const again = mulberry32(123);
  assert.deepEqual(first, [again(), again(), again()]);
});

test('single choice grading uses stable keys and flags unanswered', () => {
  const question = { points: 2, answer: 'B', options };
  assert.deepEqual(gradeSingleChoice(question, 'B'), { correct: true, pointsEarned: 2, unanswered: false });
  assert.deepEqual(gradeSingleChoice(question, 'A'), { correct: false, pointsEarned: 0, unanswered: false });
  assert.deepEqual(gradeSingleChoice(question, null), { correct: false, pointsEarned: 0, unanswered: true });
});

test('buildOptionOrders maps every question to a stable key order', () => {
  const questions = [
    { questionKey: 'q1', options },
    { questionKey: 'q2', options }
  ];
  const orders = buildOptionOrders(questions, 9);
  assert.equal(orders.q1.length, 4);
  assert.equal(orders.q2.length, 4);
  assert.deepEqual([...orders.q1].sort(), ['A', 'B', 'C', 'D']);
});

