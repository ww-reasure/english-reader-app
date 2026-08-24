import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRACTICE_DONE_PREFIX,
  PRACTICE_SESSION_KEY,
  clearPracticeScopeDone,
  clearPracticeSession,
  createPracticeSession,
  finalizePracticeSession,
  getPracticeScopeStatus,
  markPracticeScopeDone,
  readPracticeScopeDone,
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

function createStorage() {
  const store = new Map();
  return {
    get length() { return store.size; },
    key(index) { return [...store.keys()][index] ?? null; },
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
    store
  };
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

test('today completion is versioned and expires at the next local day', () => {
  const storage = createStorage();
  const record = markPracticeScopeDone('today_added', {
    wordIds: [11, 11, 12],
    now: NOW,
    storage
  });

  assert.deepEqual(record, {
    version: 2,
    scope: 'today_added',
    wordIds: [11, 12],
    completedAt: NOW
  });
  assert.deepEqual(readPracticeScopeDone('today_added', { now: NOW + 1000, storage }), record);

  const tomorrow = new Date(NOW);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 1);
  assert.equal(readPracticeScopeDone('today_added', { now: tomorrow.getTime(), storage }), null);
});

test('recent completion unlocks only new ids and expires after seven days', () => {
  const storage = createStorage();
  markPracticeScopeDone('recent_added', { wordIds: [21, 22], now: NOW, storage });

  assert.deepEqual(getPracticeScopeStatus({
    scope: 'recent_added',
    currentWordIds: [21, 22, 23, 23],
    now: NOW + DAY,
    storage
  }), {
    done: false,
    hasCompletion: true,
    reviewedIds: [21, 22],
    newIds: [23]
  });

  markPracticeScopeDone('recent_added', { wordIds: [23], now: NOW + DAY, storage });
  assert.deepEqual(readPracticeScopeDone('recent_added', { now: NOW + DAY, storage })?.wordIds, [21, 22, 23]);
  assert.equal(readPracticeScopeDone('recent_added', { now: NOW + DAY * 8 + 1, storage }), null);
});

test('manual scope never locks and completion storage failures degrade to unlocked', () => {
  const storage = createStorage();
  assert.equal(markPracticeScopeDone('manual', { wordIds: [1], now: NOW, storage }), null);
  assert.deepEqual(getPracticeScopeStatus({ scope: 'manual', currentWordIds: [1], now: NOW, storage }), {
    done: false,
    hasCompletion: false,
    reviewedIds: [],
    newIds: [1]
  });

  const unavailable = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
    get length() { throw new Error('blocked'); },
    key() { throw new Error('blocked'); }
  };
  assert.doesNotThrow(() => markPracticeScopeDone('today_added', { wordIds: [1], now: NOW, storage: unavailable }));
  assert.equal(readPracticeScopeDone('today_added', { now: NOW, storage: unavailable }), null);
  assert.deepEqual(getPracticeScopeStatus({ scope: 'today_added', currentWordIds: [1], now: NOW, storage: unavailable }).newIds, [1]);
  assert.doesNotThrow(() => clearPracticeScopeDone('today_added', { storage: unavailable }));
});

test('legacy date-key completion migrates without deleting it when v2 write fails', () => {
  const storage = createStorage();
  const date = '2026-08-11';
  const legacyKey = `review-practice-done-v1:today_added:${date}`;
  storage.setItem(legacyKey, JSON.stringify({ wordIds: [41], completedAt: NOW }));

  const migrated = readPracticeScopeDone('today_added', { now: NOW, storage });
  assert.deepEqual(migrated?.wordIds, [41]);
  assert.equal(storage.getItem(legacyKey), null);
  assert.ok(storage.getItem(`${PRACTICE_DONE_PREFIX}today_added`));

  const failing = createStorage();
  failing.setItem(legacyKey, JSON.stringify({ wordIds: [42], completedAt: NOW }));
  const originalSet = failing.setItem.bind(failing);
  failing.setItem = (key, value) => {
    if (key.startsWith(PRACTICE_DONE_PREFIX)) throw new Error('quota');
    originalSet(key, value);
  };
  assert.deepEqual(readPracticeScopeDone('today_added', { now: NOW, storage: failing })?.wordIds, [42]);
  assert.ok(failing.getItem(legacyKey));
});

test('finalization requires every valid id, marks completion, and clears only a completed session', () => {
  const completionStorage = createStorage();
  const sessionStorage = createStorage();
  sessionStorage.setItem(PRACTICE_SESSION_KEY, JSON.stringify({ scope: 'recent_added', wordIds: [1, 2] }));

  assert.equal(finalizePracticeSession({
    scope: 'recent_added',
    expectedWordIds: [1, 2],
    completedWordIds: [1],
    now: NOW,
    storage: completionStorage,
    sessionStorage
  }), false);
  assert.ok(sessionStorage.getItem(PRACTICE_SESSION_KEY));
  assert.equal(readPracticeScopeDone('recent_added', { now: NOW, storage: completionStorage }), null);

  assert.equal(finalizePracticeSession({
    scope: 'recent_added',
    expectedWordIds: [1, 2, 2],
    completedWordIds: [2, 1],
    now: NOW,
    storage: completionStorage,
    sessionStorage
  }), true);
  assert.equal(sessionStorage.getItem(PRACTICE_SESSION_KEY), null);
  assert.deepEqual(readPracticeScopeDone('recent_added', { now: NOW, storage: completionStorage })?.wordIds, [1, 2]);
});

test('empty and unknown practice rounds never finalize', () => {
  const storage = createStorage();
  const sessionStorage = createStorage();
  assert.equal(finalizePracticeSession({
    scope: 'today_added', expectedWordIds: [], completedWordIds: [], now: NOW, storage, sessionStorage
  }), false);
  assert.equal(finalizePracticeSession({
    scope: 'unknown', expectedWordIds: [1], completedWordIds: [1], now: NOW, storage, sessionStorage
  }), false);
});
