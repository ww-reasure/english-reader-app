import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WORD_PHRASES_CACHE_VERSION,
  createWordPhrases,
  normalizeWordPhrasePayload
} from '../src/components/word-phrases.mjs';

function createStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
    values
  };
}

test('normalizes common target-word phrases and rejects unrelated or untranslated rows', () => {
  const phrases = normalizeWordPhrasePayload('graduate', {
    phrases: [
      { phrase: 'graduate from', glossZh: '毕业于' },
      { phrase: 'graduate from', glossZh: '从……毕业' },
      { phrase: 'graduate with honors', glossZh: '以优异成绩毕业' },
      { phrase: 'finish school', glossZh: '完成学业' },
      { phrase: 'graduate study', glossZh: '研究生学习' },
      { phrase: 'graduate program', glossZh: '研究生项目' },
      { phrase: 'graduate degree', glossZh: '研究生学位' },
      { phrase: 'graduate school', glossZh: '研究生院' }
    ]
  });

  assert.deepEqual(phrases, [
    { phrase: 'graduate from', glossZh: '毕业于' },
    { phrase: 'graduate with honors', glossZh: '以优异成绩毕业' },
    { phrase: 'graduate study', glossZh: '研究生学习' },
    { phrase: 'graduate program', glossZh: '研究生项目' },
    { phrase: 'graduate degree', glossZh: '研究生学位' }
  ]);
});

test('accepts a base-form phrase when the requested word is inflected', () => {
  assert.deepEqual(normalizeWordPhrasePayload('graduates', {
    phrases: [
      { phrase: 'graduate from', glossZh: '毕业于' },
      { phrase: 'graduate with honors', glossZh: '以优异成绩毕业' },
      { phrase: 'graduate school', glossZh: '研究生院' }
    ]
  }), [
    { phrase: 'graduate from', glossZh: '毕业于' },
    { phrase: 'graduate with honors', glossZh: '以优异成绩毕业' },
    { phrase: 'graduate school', glossZh: '研究生院' }
  ]);
});

test('rejects a phrase payload when fewer than three valid rows remain', () => {
  assert.deepEqual(normalizeWordPhrasePayload('graduate', {
    phrases: [
      { phrase: 'graduate from', glossZh: '毕业于' },
      { phrase: 'graduate school', glossZh: '研究生院' }
    ]
  }), []);
});

test('uses a versioned persistent cache and shares one in-flight request per word', async () => {
  const storage = createStorage();
  let calls = 0;
  let resolveRequest;
  const service = createWordPhrases({
    storage,
    request: () => {
      calls += 1;
      return new Promise(resolve => { resolveRequest = resolve; });
    }
  });

  const first = service.get('Graduate');
  const second = service.get(' graduate ');
  assert.equal(calls, 1);

  const generated = [
    { phrase: 'graduate from', glossZh: '毕业于' },
    { phrase: 'graduate school', glossZh: '研究生院' },
    { phrase: 'graduate degree', glossZh: '研究生学位' }
  ];
  resolveRequest({ phrases: generated });
  assert.deepEqual(await first, generated);
  assert.deepEqual(await second, generated);

  const cached = await service.get('graduate');
  assert.deepEqual(cached, generated);
  assert.equal(calls, 1);
  const stored = JSON.parse(storage.getItem('word_phrases_v1_graduate'));
  assert.equal(stored.schemaVersion, WORD_PHRASES_CACHE_VERSION);
});

test('does not cache malformed, failed, or aborted phrase requests', async () => {
  const storage = createStorage();
  const controller = new AbortController();
  let seenSignal;
  const service = createWordPhrases({
    storage,
    request: (_word, { signal }) => new Promise((resolve, reject) => {
      seenSignal = signal;
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })
  });

  const pending = service.get('graduate', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, error => error?.name === 'AbortError');
  assert.equal(seenSignal.aborted, true);
  assert.equal(storage.getItem('word_phrases_v1_graduate'), null);

  const malformedStorage = createStorage();
  const malformed = createWordPhrases({
    storage: malformedStorage,
    request: async () => ({ phrases: [{ phrase: 'finish school', glossZh: '完成学业' }] })
  });
  await assert.rejects(malformed.get('graduate'), /没有返回可用词组/);
  assert.equal(malformedStorage.getItem('word_phrases_v1_graduate'), null);
});
