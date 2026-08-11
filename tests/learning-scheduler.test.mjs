import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { scheduleReview, selectReviewQueue } from '../src/learning-scheduler.mjs';

const NOW = new Date('2026-07-22T12:00:00.000Z').getTime();

test('a forgotten review enters a short relearning step before tomorrow', () => {
  const result = scheduleReview({ id: 1, interval: 12, reviewCount: 5, easeFactor: 2.4 }, 1, NOW);

  assert.equal(result.state, 'relearning');
  assert.equal(result.learningStep, 0);
  assert.equal(result.interval, 0);
  assert.equal(result.nextReview, NOW + 10 * 60 * 1000);
  assert.equal(result.schedulerVersion, 2);
});

test('a known new word starts one-day learning without pretending it is mastered', () => {
  const result = scheduleReview({ id: 2 }, 5, NOW);

  assert.equal(result.state, 'learning');
  assert.equal(result.learningStep, 1);
  assert.equal(result.interval, 1);
  assert.equal(result.nextReview, NOW + 24 * 60 * 60 * 1000);
  assert.equal(result.reviewCount, 1);
});

test('queue keeps overdue reviews ahead of new cards and caps new cards', () => {
  const words = [
    { id: 'new-1' }, { id: 'new-2' }, { id: 'new-3' },
    { id: 'old-short', interval: 2, nextReview: NOW - 24 * 60 * 60 * 1000 },
    { id: 'old-long', interval: 20, nextReview: NOW - 2 * 24 * 60 * 60 * 1000 }
  ];

  const queue = selectReviewQueue(words, { now: NOW, limit: 5, newLimit: 1 });

  assert.deepEqual(queue.map(word => word.id), ['old-short', 'old-long', 'new-1']);
});

test('a fuzzy answer repeats a relearning step instead of graduating the card', () => {
  const result = scheduleReview({ id: 3, state: 'relearning', learningStep: 0, interval: 0 }, 3, NOW);

  assert.equal(result.state, 'relearning');
  assert.equal(result.learningStep, 0);
  assert.equal(result.nextReview, NOW + 30 * 60 * 1000);
});

test('the legacy SRS facade delegates scheduling and queue selection to scheduler v2', async () => {
  const source = await readFile(new URL('../src/spaced-repetition.js', import.meta.url), 'utf8');

  assert.match(source, /import \{ scheduleReview, selectReviewQueue \} from '\.\/learning-scheduler\.mjs';/);
  assert.match(source, /return scheduleReview\(word, quality\);/);
  assert.match(source, /return selectReviewQueue\(words, \{ limit, \.\.\.options \}\);/);
});

test('database migration stores immutable review events with the word update', async () => {
  const source = await readFile(new URL('../src/db.js', import.meta.url), 'utf8');

  const version = source.match(/DB_VERSION:\s*(\d+)/)?.[1];
  assert.ok(version, 'database version should be declared');
  assert.ok(Number(version) >= 9, 'review-event migration requires database version 9 or later');
  assert.match(source, /createObjectStore\('reviewEvents'/);
  assert.match(source, /recordLearnWordReview\(id, srsData, event\)/);
  assert.match(source, /async settleSessionReview\(id, srsData, event(?: = \{\})?\)/);
  assert.match(source, /addReviewEvent\(event\)/);
  assert.match(source, /db\.transaction\(\['learnWords', 'reviewEvents'\], 'readwrite'\)/);
});

test('flashcard records explicit answer visibility with every settled score', async () => {
  const source = await readFile(new URL('../src/views/flashcard.js', import.meta.url), 'utf8');

  assert.match(source, /DB\.settleSessionReview\(word\.id, srsData, \{/);
  assert.match(source, /source:\s*'flashcard'/);
  assert.match(source, /const meaningRevealed = Boolean\(this\.reviewState\.meaningRevealed\);/);
  assert.match(source, /sawAnswer:\s*meaningRevealed/);
});
