import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTEXTUAL_SENSE_CACHE_VERSION,
  createContextualSense,
  makeContextualSenseCacheKey,
  normalizeContextualSensePayload
} from '../src/components/contextual-sense.mjs';

function createStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), values };
}

const senses = [
  { pos: 'noun', glossZh: '形式；类型' },
  { pos: 'verb', glossZh: '形成；建立' },
  { pos: 'adjective', glossZh: '正式的' }
];
const sentence = 'The committee formed a new policy after a long discussion.';

test('accepts only a candidate sense index and a short Chinese reason', () => {
  assert.deepEqual(normalizeContextualSensePayload({ senseIndex: 1, reasonZh: '这里作谓语，表示形成。' }, senses), {
    senseIndex: 1,
    reasonZh: '这里作谓语，表示形成。'
  });
  assert.equal(normalizeContextualSensePayload({ senseIndex: 3, reasonZh: '越界' }, senses), null);
  assert.equal(normalizeContextualSensePayload({ senseIndex: 1, reasonZh: 'verb meaning' }, senses), null);
});

test('chooses a single offline sense locally and caches a validated multi-sense selection', async () => {
  const storage = createStorage();
  let calls = 0;
  const resolver = createContextualSense({
    storage,
    request: async () => {
      calls += 1;
      return { senseIndex: 1, reasonZh: 'formed 在句中作谓语。' };
    }
  });

  assert.deepEqual(await resolver.resolve({ word: 'form', sentence, senses: [senses[0]], lexiconVersion: 'v1' }), {
    senseIndex: 0,
    reasonZh: ''
  });
  assert.equal(calls, 0);

  const first = await resolver.resolve({ word: 'form', sentence, senses, lexiconVersion: 'v1' });
  const second = await resolver.resolve({ word: 'form', sentence, senses, lexiconVersion: 'v1' });
  assert.deepEqual(first, { senseIndex: 1, reasonZh: 'formed 在句中作谓语。' });
  assert.deepEqual(second, first);
  assert.equal(calls, 1);
  assert.equal(JSON.parse(storage.getItem(makeContextualSenseCacheKey('form', sentence, senses, 'v1'))).schemaVersion, CONTEXTUAL_SENSE_CACHE_VERSION);
});

test('does not cache malformed, cancelled, or unknown sense choices', async () => {
  const storage = createStorage();
  const controller = new AbortController();
  const resolver = createContextualSense({
    storage,
    request: (_input, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
  });
  const pending = resolver.resolve({ word: 'form', sentence, senses, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, error => error?.name === 'AbortError');
  assert.equal(storage.values.size, 0);

  const unavailable = createContextualSense({ storage, request: async () => ({ senseIndex: 9, reasonZh: '错误索引' }) });
  assert.equal(await unavailable.resolve({ word: 'form', sentence, senses }), null);
});
