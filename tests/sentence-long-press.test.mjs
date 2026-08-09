import assert from 'node:assert/strict';
import test from 'node:test';

import { bindSentenceLongPress } from '../src/components/sentence-long-press.mjs';

function fakeTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    emit(type, event = {}) { listeners.get(type)?.(event); },
    listeners
  };
}

function pointer(overrides = {}) {
  return {
    pointerId: 1,
    pointerType: 'touch',
    isPrimary: true,
    clientX: 40,
    clientY: 80,
    target: {},
    ...overrides
  };
}

test('sentence long press fires once for a stationary touch or pen pointer', () => {
  const root = fakeTarget();
  const callbacks = [];
  let timer = null;
  const cleanup = bindSentenceLongPress({
    root,
    onLongPress: event => callbacks.push(event.pointerType),
    setTimer: callback => { timer = callback; return 1; },
    clearTimer: () => { timer = null; }
  });

  root.emit('pointerdown', pointer({ pointerType: 'pen' }));
  assert.equal(typeof timer, 'function');
  timer();
  root.emit('pointerup', pointer({ pointerType: 'pen' }));
  assert.deepEqual(callbacks, ['pen']);

  cleanup();
  assert.equal(root.listeners.size, 0);
});

test('sentence long press reports pointer release after a completed gesture', () => {
  const root = fakeTarget();
  let timer = null;
  const lifecycle = [];
  bindSentenceLongPress({
    root,
    onLongPress: () => lifecycle.push('selected'),
    onLongPressEnd: () => lifecycle.push('ended'),
    setTimer: callback => { timer = callback; return 1; },
    clearTimer: () => { timer = null; }
  });
  root.emit('pointerdown', pointer());
  timer();
  root.emit('pointerup', pointer());
  assert.deepEqual(lifecycle, ['selected', 'ended']);
});

test('sentence long press cancels after movement, scrolling, release, or mouse input', () => {
  const root = fakeTarget();
  let timer = null;
  let calls = 0;
  bindSentenceLongPress({
    root,
    movementThreshold: 10,
    onLongPress: () => { calls += 1; },
    setTimer: callback => { timer = callback; return 1; },
    clearTimer: () => { timer = null; }
  });

  root.emit('pointerdown', pointer());
  root.emit('pointermove', pointer({ clientX: 60 }));
  assert.equal(timer, null);

  root.emit('pointerdown', pointer());
  root.emit('scroll');
  assert.equal(timer, null);

  root.emit('pointerdown', pointer());
  root.emit('pointerup', pointer());
  assert.equal(timer, null);

  root.emit('pointerdown', pointer({ pointerType: 'mouse' }));
  assert.equal(timer, null);
  assert.equal(calls, 0);
});

test('sentence long press ignores controls and non-primary pointers', () => {
  const root = fakeTarget();
  let timer = null;
  bindSentenceLongPress({
    root,
    shouldIgnore: event => event.target.control === true,
    onLongPress: () => {},
    setTimer: callback => { timer = callback; return 1; },
    clearTimer: () => { timer = null; }
  });

  root.emit('pointerdown', pointer({ target: { control: true } }));
  assert.equal(timer, null);
  root.emit('pointerdown', pointer({ isPrimary: false }));
  assert.equal(timer, null);
});
