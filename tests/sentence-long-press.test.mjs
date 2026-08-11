import assert from 'node:assert/strict';
import test from 'node:test';

import { bindSentenceLongPress, createLongPressSelectionGuard } from '../src/components/sentence-long-press.mjs';

function fakeTarget() {
  const listeners = new Map();
  const classes = new Set();
  return {
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    emit(type, event = {}) { listeners.get(type)?.(event); },
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); }
    },
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

test('native text selection is suppressed only while a touch long-press candidate is active', () => {
  const root = fakeTarget();
  let timer = null;
  bindSentenceLongPress({
    root,
    onLongPress: () => {},
    preventNativeTextSelection: true,
    setTimer: callback => { timer = callback; return 1; },
    clearTimer: () => { timer = null; }
  });

  const before = { prevented: false, preventDefault() { this.prevented = true; } };
  root.emit('selectstart', before);
  assert.equal(before.prevented, false);

  root.emit('pointerdown', pointer());
  assert.equal(root.classList.contains('sentence-long-press-pending'), true);

  const selectStart = { prevented: false, preventDefault() { this.prevented = true; } };
  const contextMenu = { prevented: false, preventDefault() { this.prevented = true; } };
  root.emit('selectstart', selectStart);
  root.emit('contextmenu', contextMenu);
  assert.equal(selectStart.prevented, true);
  assert.equal(contextMenu.prevented, true);

  timer();
  assert.equal(root.classList.contains('sentence-long-press-pending'), false);
  const afterAutomaticSelection = { prevented: false, preventDefault() { this.prevented = true; } };
  root.emit('selectstart', afterAutomaticSelection);
  assert.equal(afterAutomaticSelection.prevented, true);

  root.emit('pointerup', pointer());
  assert.equal(root.classList.contains('sentence-long-press-pending'), false);
  const after = { prevented: false, preventDefault() { this.prevented = true; } };
  root.emit('selectstart', after);
  assert.equal(after.prevented, false);
});

test('native text selection suppression clears when a long press moves, scrolls, or is cancelled', () => {
  const root = fakeTarget();
  let timer = null;
  bindSentenceLongPress({
    root,
    onLongPress: () => {},
    preventNativeTextSelection: true,
    setTimer: callback => { timer = callback; return 1; },
    clearTimer: () => { timer = null; }
  });

  for (const end of [
    () => root.emit('pointermove', pointer({ clientX: 80 })),
    () => root.emit('scroll'),
    () => root.emit('pointercancel', pointer())
  ]) {
    root.emit('pointerdown', pointer());
    assert.equal(root.classList.contains('sentence-long-press-pending'), true);
    end();
    assert.equal(timer, null);
    assert.equal(root.classList.contains('sentence-long-press-pending'), false);
  }
});

test('long-press selection guard reserves one trailing click and hides automatic selection from generic menus', () => {
  const guard = createLongPressSelectionGuard();

  assert.equal(guard.shouldIgnoreSelection(), false);
  assert.equal(guard.consumeClick(), false);

  guard.markAutomaticSelection();
  assert.equal(guard.shouldIgnoreSelection(), true);
  assert.equal(guard.consumeClick(), true);
  assert.equal(guard.consumeClick(), false);

  guard.clear();
  assert.equal(guard.shouldIgnoreSelection(), false);
});
