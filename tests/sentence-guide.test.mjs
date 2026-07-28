import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SENTENCE_GUIDE_CACHE_VERSION,
  createSentenceGuide,
  makeSentenceGuideCacheKey,
  normalizeSentenceGuidePayload
} from '../src/components/sentence-guide.mjs';

function createStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
    key(index) { return [...values.keys()][index] || null; },
    get length() { return values.size; },
    values
  };
}

const sentence = 'Although the data were limited, the researchers drew a cautious conclusion.';
const payload = {
  translationZh: '尽管数据有限，研究人员仍得出了谨慎的结论。',
  chunks: [
    { source: 'Although the data were limited', glossZh: '尽管数据有限' },
    { source: 'the researchers drew a cautious conclusion', glossZh: '研究人员得出了谨慎的结论' }
  ],
  grammar: ['although 引导让步状语从句', '主句使用一般过去时'],
  keywords: [
    { word: 'cautious', glossZh: '谨慎的' },
    { word: 'conclusion', glossZh: '结论' }
  ]
};

test('normalizes a constrained sentence guide and rejects untranslated or ungrounded fragments', () => {
  assert.deepEqual(normalizeSentenceGuidePayload(sentence, payload), payload);

  assert.equal(normalizeSentenceGuidePayload(sentence, {
    ...payload,
    translationZh: 'Although the data were limited'
  }), null);

  assert.equal(normalizeSentenceGuidePayload(sentence, {
    ...payload,
    chunks: [{ source: 'A different sentence', glossZh: '另一句话' }]
  }), null);
});

test('uses a versioned per-track cache and shares an in-flight guide request', async () => {
  const storage = createStorage();
  let calls = 0;
  let resolveRequest;
  const guide = createSentenceGuide({
    storage,
    request: () => {
      calls += 1;
      return new Promise(resolve => { resolveRequest = resolve; });
    }
  });

  const first = guide.get({ sentence, targetTrack: 'cet4' });
  const second = guide.get({ sentence: `  ${sentence}  `, targetTrack: 'cet4' });
  assert.equal(calls, 1);
  resolveRequest(payload);
  assert.deepEqual(await first, payload);
  assert.deepEqual(await second, payload);

  assert.deepEqual(await guide.get({ sentence, targetTrack: 'cet4' }), payload);
  assert.equal(calls, 1);
  const cached = JSON.parse(storage.getItem(makeSentenceGuideCacheKey(sentence, 'cet4')));
  assert.equal(cached.schemaVersion, SENTENCE_GUIDE_CACHE_VERSION);
});

test('never persists a cancelled or malformed guide response', async () => {
  const storage = createStorage();
  const controller = new AbortController();
  let requestSignal;
  const guide = createSentenceGuide({
    storage,
    request: (_input, { signal }) => new Promise((resolve, reject) => {
      requestSignal = signal;
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })
  });

  const pending = guide.get({ sentence, targetTrack: 'cet4', signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, error => error?.name === 'AbortError');
  assert.equal(requestSignal.aborted, true);
  assert.equal(storage.getItem(makeSentenceGuideCacheKey(sentence, 'cet4')), null);

  const malformedStorage = createStorage();
  const malformed = createSentenceGuide({ storage: malformedStorage, request: async () => ({ translationZh: '只有翻译' }) });
  await assert.rejects(malformed.get({ sentence, targetTrack: 'cet4' }), /没有返回可用导读/);
  assert.equal(malformedStorage.getItem(makeSentenceGuideCacheKey(sentence, 'cet4')), null);
});
