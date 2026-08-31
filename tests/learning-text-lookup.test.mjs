import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { bindSentenceLongPress } from '../src/components/sentence-long-press.mjs';

async function loadLookupModule() {
  const source = await readFile(new URL('../src/components/reading-word-lookup.js', import.meta.url), 'utf8');
  const dependencies = `
    const { Tooltip, ContextualSense, getDefinitionSenses, Dictionary, getContextSentenceAtPoint, bindSentenceLongPress } = globalThis.__learningLookupMocks;
  `;
  const body = source
    .replace(/^import .+;\r?\n/gm, '')
    .replace(/^export \{.+;\r?\n/gm, '');
  return import(`data:text/javascript;base64,${Buffer.from(dependencies + body + `\n// ${Math.random()}`).toString('base64')}`);
}

function createRoot() {
  const listeners = new Map();
  return {
    addEventListener(type, handler, options) {
      const entries = listeners.get(type) || [];
      entries.push({ handler, capture: options === true || options?.capture === true });
      listeners.set(type, entries);
    },
    removeEventListener(type, handler) {
      listeners.set(type, (listeners.get(type) || []).filter(entry => entry.handler !== handler));
    },
    contains(target) {
      return Boolean(target?.inside);
    },
    async emit(type, event) {
      const entries = [...(listeners.get(type) || [])].sort((a, b) => Number(b.capture) - Number(a.capture));
      for (const entry of entries) {
        await entry.handler(event);
        if (event.immediateStopped) break;
      }
    },
    listenerCount(type) {
      return (listeners.get(type) || []).length;
    }
  };
}

function createTarget({ learning = false, longpress = false, control = false, disabled = false } = {}) {
  const surface = { inside: true, contains: node => node === target };
  const target = {
    inside: true,
    nodeType: 1,
    parentElement: null,
    dataset: {},
    closest(selector) {
      if (selector === '[data-learning-text="click"]') return learning ? surface : null;
      if (selector === '[data-learning-text="longpress"]') return longpress ? surface : null;
      if (selector.includes('button') || selector.includes('[role="button"]')) return control ? target : null;
      if (selector.includes('[data-word-lookup="disabled"]')) return disabled ? target : null;
      if (selector === '[data-word-lookup-token]') return null;
      return null;
    }
  };
  return target;
}

function installEnvironment() {
  const lookups = [];
  const shows = [];
  const errors = [];
  let activeLookupId = 0;
  const tooltipElement = { contains: () => false };
  const tooltip = {
    contains: () => false,
    isVisible: () => false,
    getWordAtPoint: event => event.target?.lookupWord || 'practice',
    beginLookup: () => ++activeLookupId,
    isCurrent: lookupId => lookupId === activeLookupId,
    show: async (...args) => { shows.push({ data: args[3], options: args.at(-1) }); return true; },
    showError(...args) { errors.push(args); },
    hide() {},
    attachAutoDismiss: () => () => {}
  };
  globalThis.__learningLookupMocks = {
    Tooltip: tooltip,
    ContextualSense: { resolve: async () => null },
    getDefinitionSenses: () => [],
    Dictionary: { lookup: async word => (lookups.push(word), { word, translation: '练习' }) },
    getContextSentenceAtPoint: () => '',
    bindSentenceLongPress
  };
  globalThis.document = {
    getElementById: () => tooltipElement,
    addEventListener() {},
    removeEventListener() {}
  };
  globalThis.window = { getSelection: () => ({ isCollapsed: true }) };
  return { lookups, shows, errors, tooltip };
}

function clickEvent(target) {
  const event = {
    type: 'click',
    target,
    clientX: 20,
    clientY: 30,
    stopPropagation() { event.propagationStopped = true; },
    stopImmediatePropagation() { event.immediateStopped = true; },
    preventDefault() { event.defaultPrevented = true; }
  };
  return event;
}

function pointerEvent(target, overrides = {}) {
  return {
    type: overrides.type || 'pointerdown',
    target,
    isPrimary: true,
    pointerType: 'touch',
    pointerId: 7,
    clientX: 24,
    clientY: 36,
    preventDefault() {},
    ...overrides
  };
}

test('app-wide lookup only handles declared learning text and requests the compact card', async () => {
  const { lookups, shows, tooltip } = installEnvironment();
  const { bindLearningTextLookup } = await loadLookupModule();
  const root = createRoot();
  const cleanup = bindLearningTextLookup({ root, tooltip });

  await root.emit('click', clickEvent(createTarget()));
  await root.emit('click', clickEvent(createTarget({ learning: true, control: true })));
  await root.emit('click', clickEvent(createTarget({ learning: true, disabled: true })));
  await root.emit('click', clickEvent(createTarget({ learning: true })));

  assert.deepEqual(lookups, ['practice']);
  assert.equal(shows[0].options.density, 'compact');
  assert.equal(root.listenerCount('click'), 1);

  cleanup();
  assert.equal(root.listenerCount('click'), 0);
});

test('exam option long press looks up one word and suppresses only its synthesized answer click', async () => {
  const { lookups, tooltip } = installEnvironment();
  const { bindLearningTextLookup } = await loadLookupModule();
  const root = createRoot();
  let answers = 0;
  const option = createTarget({ longpress: true, control: true });
  const cleanup = bindLearningTextLookup({ root, tooltip, longPressDuration: 5 });
  root.addEventListener('click', event => {
    if (event.target === option) answers += 1;
  });

  await root.emit('pointerdown', pointerEvent(option));
  await new Promise(resolve => setTimeout(resolve, 12));
  await root.emit('pointerup', pointerEvent(option, { type: 'pointerup' }));
  const synthesizedClick = clickEvent(option);
  await root.emit('click', synthesizedClick);

  assert.deepEqual(lookups, ['practice']);
  assert.equal(answers, 0);
  assert.equal(synthesizedClick.defaultPrevented, true);

  const normalClick = clickEvent(option);
  await root.emit('click', normalClick);
  assert.equal(answers, 1, 'only the click caused by the successful long press is suppressed');

  cleanup();
});

test('moving beyond twelve pixels cancels option lookup and leaves the answer click untouched', async () => {
  const { lookups, tooltip } = installEnvironment();
  const { bindLearningTextLookup } = await loadLookupModule();
  const root = createRoot();
  const option = createTarget({ longpress: true, control: true });
  const cleanup = bindLearningTextLookup({ root, tooltip, longPressDuration: 5 });

  await root.emit('pointerdown', pointerEvent(option));
  await root.emit('pointermove', pointerEvent(option, { type: 'pointermove', clientX: 40 }));
  await new Promise(resolve => setTimeout(resolve, 12));
  const click = clickEvent(option);
  await root.emit('click', click);

  assert.deepEqual(lookups, []);
  assert.equal(click.defaultPrevented, undefined);

  cleanup();
  assert.equal(root.listenerCount('pointerdown'), 0);
  assert.equal(root.listenerCount('pointermove'), 0);
  assert.equal(root.listenerCount('pointerup'), 0);
});

test('a late dictionary result cannot overwrite the card for a newer word', async () => {
  const { shows, tooltip } = installEnvironment();
  const pending = new Map();
  globalThis.__learningLookupMocks.Dictionary.lookup = word => new Promise(resolve => pending.set(word, resolve));
  const { bindLearningTextLookup } = await loadLookupModule();
  const root = createRoot();
  const first = createTarget({ learning: true });
  const second = createTarget({ learning: true });
  first.lookupWord = 'first';
  second.lookupWord = 'second';
  const cleanup = bindLearningTextLookup({ root, tooltip });

  const firstClick = root.emit('click', clickEvent(first));
  const secondClick = root.emit('click', clickEvent(second));
  pending.get('second')({ word: 'second', translation: '第二个' });
  await secondClick;
  pending.get('first')({ word: 'first', translation: '第一个' });
  await firstClick;

  assert.deepEqual(shows.map(entry => entry.data.word), ['second']);
  cleanup();
});

test('a failed lookup offers one explicit retry and does not guess with AI', async () => {
  const { lookups, shows, errors, tooltip } = installEnvironment();
  let attempts = 0;
  globalThis.__learningLookupMocks.Dictionary.lookup = async word => {
    lookups.push(word);
    attempts += 1;
    if (attempts === 1) throw new Error('offline');
    return { word, translation: '练习' };
  };
  const { bindLearningTextLookup } = await loadLookupModule();
  const root = createRoot();
  const target = createTarget({ learning: true });
  const cleanup = bindLearningTextLookup({ root, tooltip });

  await root.emit('click', clickEvent(target));
  assert.equal(errors.length, 1);
  assert.equal(typeof errors[0][4], 'function', 'the error card exposes a retry action');

  await errors[0][4]();
  assert.deepEqual(lookups, ['practice', 'practice']);
  assert.deepEqual(shows.map(entry => entry.data.word), ['practice']);

  cleanup();
});
