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
const LIBRARY_NOW = new Date(2026, 7, 24, 12).getTime();
const LIBRARY_DAY = 24 * 60 * 60 * 1000;

function canonical({ id, word = `word-${id}`, libraryAddedAt = LIBRARY_NOW, source = 'import', createdAt = libraryAddedAt } = {}) {
  const reading = source === 'reading' || source === 'both';
  const imported = source === 'import' || source === 'both';
  return {
    id,
    word,
    createdAt,
    libraryAddedAt,
    archivedAt: null,
    librarySourceVersion: 1,
    librarySources: {
      reading: { active: reading, firstAddedAt: reading ? libraryAddedAt : null, lastAddedAt: reading ? libraryAddedAt : null },
      import: { active: imported, firstAddedAt: imported ? libraryAddedAt : null, lastAddedAt: imported ? libraryAddedAt : null }
    }
  };
}

function archived(values) {
  return { ...canonical(values), archivedAt: LIBRARY_NOW - 1 };
}

function canonicalDb(learnWords) {
  return { getAllLearnWords: async () => learnWords.filter(word => word.archivedAt == null) };
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

test('today_added includes imported and saved canonical words once', async () => {
  const db = canonicalDb([
    canonical({ id: 1, word: 'imported', libraryAddedAt: new Date(2026, 7, 24, 9).getTime(), source: 'import' }),
    canonical({ id: 2, word: 'saved', libraryAddedAt: new Date(2026, 7, 24, 10).getTime(), source: 'reading' }),
    canonical({ id: 3, word: 'both', libraryAddedAt: new Date(2026, 7, 24, 11).getTime(), source: 'both' })
  ]);
  const result = await resolvePracticeScope({ db, scope: 'today_added', now: LIBRARY_NOW });
  assert.deepEqual(result.words.map(word => word.id), [1, 2, 3]);
  assert.equal(result.skipped, 0);
});

test('manual uses canonical ids and skips archived or missing ids', async () => {
  const db = canonicalDb([canonical({ id: 2 }), canonical({ id: 1 }), archived({ id: 3 })]);
  const result = await resolvePracticeScope({ db, scope: 'manual', wordIds: [3, 1, 99, 2] });
  assert.deepEqual(result.words.map(word => word.id), [2, 1]);
  assert.equal(result.skipped, 2);
});

test('recent_added uses seven local calendar days and libraryAddedAt fallback', async () => {
  const db = canonicalDb([
    canonical({ id: 4, libraryAddedAt: LIBRARY_NOW - LIBRARY_DAY * 6 }),
    canonical({ id: 5, libraryAddedAt: null, createdAt: LIBRARY_NOW - LIBRARY_DAY * 6 }),
    canonical({ id: 6, libraryAddedAt: LIBRARY_NOW - LIBRARY_DAY * 8 })
  ]);
  const result = await resolvePracticeScope({ db, scope: 'recent_added', days: 7, now: LIBRARY_NOW });
  assert.deepEqual(result.words.map(word => word.id), [4, 5]);
  assert.equal(result.skipped, 0);
});

test('unknown scopes are rejected', async () => {
  const db = canonicalDb([]);
  await assert.rejects(resolvePracticeScope({ db, scope: 'article' }), /不支持的专项复习范围/);
});

test('practice session round-trips through sessionStorage and clears', () => {
  installSessionStorage();
  createPracticeSession({ scope: 'manual', wordIds: [31, 32], expectedWordIds: [30, 31, 32], skipped: 2 });

  const session = readPracticeSession();
  assert.equal(session.scope, 'manual');
  assert.deepEqual(session.wordIds, [31, 32]);
  assert.deepEqual(session.expectedWordIds, [30, 31, 32]);
  assert.equal(session.reviewAll, false);
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
