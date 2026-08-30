import assert from 'node:assert/strict';
import test from 'node:test';
import { StudySessionTimer } from '../src/study-session-timer.mjs';

function fixture(startedAt = new Date(2026, 7, 24, 9).getTime()) {
  let now = startedAt;
  const timer = new StudySessionTimer({ sessionId: 's1', mode: 'flashcard', now: () => now, idleMs: 30_000 });
  return {
    timer,
    advance(ms) { now += ms; },
    setNow(value) { now = value; }
  };
}

test('activity does not reset already accumulated active time', () => {
  const { timer, advance } = fixture();
  timer.start({ contextKey: 'recall' });
  advance(10_000);
  timer.noteActivity();
  advance(5_000);
  assert.equal(timer.getActiveDuration(), 15_000);
});

test('switchContext closes the old slice and starts the new one', () => {
  const { timer, advance } = fixture();
  timer.start({ contextKey: 'reading_mcq' });
  advance(12_000);
  timer.switchContext({ contextKey: 'translation' });
  advance(8_000);
  const slices = timer.finish();
  assert.deepEqual(slices.map(item => [item.contextKey, item.durationMs]), [['reading_mcq', 12_000], ['translation', 8_000]]);
});

test('midnight splits a single active interval into two local-day slices', () => {
  const startedAt = new Date(2026, 7, 24, 23, 59, 50).getTime();
  const { timer, advance } = fixture(startedAt);
  timer.start({ contextKey: 'recall' });
  advance(20_000);
  assert.deepEqual(timer.finish().map(item => item.dayKey), ['2026-08-24', '2026-08-25']);
});

test('idle time is capped and pause and finish are idempotent', () => {
  const { timer, advance } = fixture();
  timer.start({ contextKey: 'recall' });
  advance(35_000);
  assert.equal(timer.getActiveDuration(), 30_000);
  const paused = timer.pause('idle');
  const first = timer.finish();
  const second = timer.finish();
  assert.equal(paused[0].reason, 'idle');
  assert.equal(paused[0].durationMs, 30_000);
  assert.deepEqual(first, []);
  assert.deepEqual(second, []);
});
