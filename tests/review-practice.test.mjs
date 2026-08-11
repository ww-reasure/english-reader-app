import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRACTICE_SESSION_KEY,
  clearPracticeSession,
  createPracticeSession,
  readPracticeSession,
  resolvePracticeScope
} from '../src/review-practice.mjs';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-11T12:00:00+08:00').getTime();

function makeDb({ saved = [], library = [] } = {}) {
  return {
    getAllWords: async () => saved,
    getAllLearnWords: async () => library
  };
}

function installSessionStorage() {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key)
  };
  return store;
}

test('today_added scope only keeps words added since local midnight that exist in the library', async () => {
  const midnight = new Date(NOW);
  midnight.setHours(0, 0, 0, 0);
  const db = makeDb({
    saved: [
      { id: 1, word: 'inevitable', createdAt: NOW - 1000 },
      { id: 2, word: 'oldword', createdAt: midnight.getTime() - 1000 },
      { id: 3, word: 'notinlibrary', createdAt: NOW - 500 }
    ],
    library: [
      { id: 11, word: 'inevitable', reviewRevision: 2 },
      { id: 12, word: 'oldword', reviewRevision: 5 }
    ]
  });

  const result = await resolvePracticeScope({ db, scope: 'today_added', now: NOW });

  assert.deepEqual(result.words.map(word => word.id), [11]);
  assert.equal(result.skipped, 1);
});

test('recent_added honors the configurable day window and deduplicates library matches', async () => {
  const db = makeDb({
    saved: [
      { id: 1, word: 'fresh', createdAt: NOW - DAY * 6 },
      { id: 2, word: 'edge', createdAt: NOW - DAY * 7 + 1000 },
      { id: 3, word: 'expired', createdAt: NOW - DAY * 7 - 1000 },
      { id: 4, word: 'fresh', createdAt: NOW - 2000 }
    ],
    library: [
      { id: 21, word: 'fresh', reviewRevision: 1 },
      { id: 22, word: 'edge', reviewRevision: 1 },
      { id: 23, word: 'expired', reviewRevision: 1 }
    ]
  });

  const result = await resolvePracticeScope({ db, scope: 'recent_added', days: 7, now: NOW });

  assert.deepEqual(result.words.map(word => word.id), [21, 22]);
  assert.equal(result.skipped, 0);
});

test('manual scope follows vocabulary ids and keeps vocabulary insertion order', async () => {
  const db = makeDb({
    saved: [
      { id: 1, word: 'alpha', createdAt: NOW },
      { id: 2, word: 'beta', createdAt: NOW },
      { id: 3, word: 'gamma', createdAt: NOW }
    ],
    library: [
      { id: 31, word: 'gamma', reviewRevision: 0 },
      { id: 32, word: 'alpha', reviewRevision: 0 },
      { id: 33, word: 'beta', reviewRevision: 0 }
    ]
  });

  const result = await resolvePracticeScope({ db, scope: 'manual', wordIds: [3, 1], now: NOW });

  assert.deepEqual(result.words.map(word => word.id), [32, 31]);
  assert.equal(result.skipped, 0);
});

test('unknown scopes are rejected', async () => {
  const db = makeDb();
  await assert.rejects(resolvePracticeScope({ db, scope: 'article' }), /不支持的专项复习范围/);
});

test('practice session round-trips through sessionStorage and clears', () => {
  installSessionStorage();
  createPracticeSession({ scope: 'manual', wordIds: [31, 32], skipped: 2 });

  const session = readPracticeSession();
  assert.equal(session.scope, 'manual');
  assert.deepEqual(session.wordIds, [31, 32]);
  assert.equal(session.skipped, 2);

  clearPracticeSession();
  assert.equal(sessionStorage.getItem(PRACTICE_SESSION_KEY), null);
  assert.equal(readPracticeSession(), null);
});

test('corrupt or mismatched practice sessions read back as null', () => {
  const store = installSessionStorage();
  store.set(PRACTICE_SESSION_KEY, '{not-json');
  assert.equal(readPracticeSession(), null);

  store.set(PRACTICE_SESSION_KEY, JSON.stringify({ scope: 'unknown', wordIds: [1] }));
  assert.equal(readPracticeSession(), null);

  store.set(PRACTICE_SESSION_KEY, JSON.stringify({ scope: 'manual', wordIds: [] }));
  assert.equal(readPracticeSession(), null);
});
