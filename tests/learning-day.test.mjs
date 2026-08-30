import assert from 'node:assert/strict';
import test from 'node:test';
import {
  localDayKey,
  localDayBounds,
  splitIntervalByLocalDay,
  isDayRetained
} from '../src/learning-day.mjs';

test('localDayKey uses local calendar fields instead of UTC', () => {
  const value = new Date(2026, 7, 24, 23, 30).getTime();
  assert.equal(localDayKey(value), '2026-08-24');
});

test('localDayBounds round-trips one valid local date', () => {
  const bounds = localDayBounds('2026-08-24');
  assert.equal(localDayKey(bounds.start), '2026-08-24');
  assert.equal(localDayKey(bounds.end - 1), '2026-08-24');
  assert.equal(localDayKey(bounds.end), '2026-08-25');
});

test('splitIntervalByLocalDay assigns time on both sides of midnight', () => {
  const startedAt = new Date(2026, 7, 24, 23, 59, 50).getTime();
  const endedAt = new Date(2026, 7, 25, 0, 0, 20).getTime();
  assert.deepEqual(splitIntervalByLocalDay({ startedAt, endedAt }), [
    { dayKey: '2026-08-24', startedAt, endedAt: new Date(2026, 7, 25, 0, 0, 0).getTime(), durationMs: 10_000 },
    { dayKey: '2026-08-25', startedAt: new Date(2026, 7, 25, 0, 0, 0).getTime(), endedAt, durationMs: 20_000 }
  ]);
});

test('retention includes today and the previous 29 local dates', () => {
  const now = new Date(2026, 7, 24, 12).getTime();
  assert.equal(isDayRetained('2026-07-26', { now, days: 30 }), true);
  assert.equal(isDayRetained('2026-07-25', { now, days: 30 }), false);
});
