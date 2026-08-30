import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ActivityType,
  Completeness,
  importWordDedupeKey,
  normalizeLearningActivity
} from '../src/learning-activity.mjs';

test('normalizes bounded learning activity records', () => {
  const event = normalizeLearningActivity({
    id: 'event-1',
    type: ActivityType.READING_WORD_LOOKUP,
    occurredAt: new Date(2026, 7, 24, 9).getTime(),
    sessionId: 'reading:7',
    payload: { lemma: 'Constraint', title: 'x'.repeat(400) }
  });
  assert.equal(event.dayKey, '2026-08-24');
  assert.equal(event.payload.lemma, 'constraint');
  assert.equal(event.payload.title.length, 240);
  assert.equal(Completeness.PARTIAL, 'partial');
});

test('builds one stable per-day import key', () => {
  assert.equal(importWordDedupeKey('2026-08-24', 'Constraint'), 'import-word:2026-08-24:constraint');
});
