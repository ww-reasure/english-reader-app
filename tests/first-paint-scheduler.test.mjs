import assert from 'node:assert/strict';
import test from 'node:test';

import { scheduleAfterFirstPaint } from '../src/first-paint-scheduler.mjs';

test('fires exactly once via the timeout when rAF never runs (background tab)', () => {
  let fired = 0;
  const timers = [];
  scheduleAfterFirstPaint(() => { fired += 1; }, {
    requestFrame: () => {},
    setTimeoutFn: fn => timers.push(fn)
  });
  assert.equal(fired, 0);
  for (const timer of timers) timer();
  assert.equal(fired, 1);
});

test('does not double-fire when rAF completes before the timeout', () => {
  let fired = 0;
  const frames = [];
  const timers = [];
  scheduleAfterFirstPaint(() => { fired += 1; }, {
    requestFrame: fn => frames.push(fn),
    setTimeoutFn: fn => timers.push(fn)
  });
  frames[0]();
  frames[1]();
  assert.equal(fired, 1);
  for (const timer of timers) timer();
  assert.equal(fired, 1);
});

test('timeout firing first suppresses the later rAF path', () => {
  let fired = 0;
  const frames = [];
  const timers = [];
  scheduleAfterFirstPaint(() => { fired += 1; }, {
    requestFrame: fn => frames.push(fn),
    setTimeoutFn: fn => timers.push(fn)
  });
  for (const timer of timers) timer();
  assert.equal(fired, 1);
  frames[0]();
  frames[1]();
  assert.equal(fired, 1);
});

test('falls back to an immediate timeout when rAF is unavailable', () => {
  let fired = 0;
  const timers = [];
  scheduleAfterFirstPaint(() => { fired += 1; }, {
    requestFrame: undefined,
    setTimeoutFn: fn => timers.push(fn)
  });
  assert.equal(fired, 0);
  for (const timer of timers) timer();
  assert.equal(fired, 1);
});
