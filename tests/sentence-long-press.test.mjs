import assert from 'node:assert/strict';
import test from 'node:test';

import { bindSentenceLongPress } from '../src/components/sentence-long-press.mjs';

function createRoot() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    emit(type, event = {}) {
      listeners.get(type)?.(event);
    },
    has(type) {
      return listeners.has(type);
    }
  };
}

test('long press selects once and scrolling immediately clears the completed state', () => {
  const root = createRoot();
  const timers = [];
  const cleared = [];
  const events = [];
  const cleanup = bindSentenceLongPress({
    root,
    setTimer: callback => {
      timers.push(callback);
      return timers.length;
    },
    clearTimer: id => cleared.push(id),
    onLongPress: event => events.push(['long', event.pointerId]),
    onLongPressEnd: () => events.push(['end'])
  });

  root.emit('pointerdown', { isPrimary: true, pointerType: 'touch', pointerId: 4, clientX: 10, clientY: 10 });
  timers[0]();
  assert.deepEqual(events, [['long', 4]]);

  root.emit('scroll');
  assert.deepEqual(events, [['long', 4], ['end']]);
  root.emit('pointerup', { pointerId: 4 });
  assert.deepEqual(events, [['long', 4], ['end']]);

  cleanup();
  assert.equal(root.has('pointerdown'), false);
  assert.equal(root.has('scroll'), false);
  assert.deepEqual(cleared, []);
});

test('pointer movement cancels a pending long press without selecting a sentence', () => {
  const root = createRoot();
  const timers = [];
  let selected = 0;
  let cleared = 0;
  bindSentenceLongPress({
    root,
    setTimer: callback => {
      timers.push(callback);
      return 9;
    },
    clearTimer: () => { cleared += 1; },
    onLongPress: () => { selected += 1; }
  });

  root.emit('pointerdown', { isPrimary: true, pointerType: 'touch', pointerId: 1, clientX: 0, clientY: 0 });
  root.emit('pointermove', { pointerId: 1, clientX: 20, clientY: 0 });
  timers[0]();

  assert.equal(selected, 0);
  assert.equal(cleared, 1);
});

test('scrolling the page outlet clears a completed long press even when the article body does not scroll', () => {
  const root = createRoot();
  const pageOutlet = createRoot();
  const timers = [];
  let ended = 0;
  bindSentenceLongPress({
    root,
    scrollTargets: [pageOutlet],
    setTimer: callback => {
      timers.push(callback);
      return 7;
    },
    onLongPress: () => {},
    onLongPressEnd: () => { ended += 1; }
  });

  root.emit('pointerdown', { isPrimary: true, pointerType: 'touch', pointerId: 2, clientX: 10, clientY: 10 });
  timers[0]();
  pageOutlet.emit('scroll');

  assert.equal(ended, 1);
});
