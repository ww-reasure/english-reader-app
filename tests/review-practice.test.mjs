import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRACTICE_DONE_LEGACY_PREFIX,
  PRACTICE_DONE_PREFIX,
  PRACTICE_SESSION_KEY,
  clearPracticeScopeDone,
  clearPracticeSession,
  createPracticeSession,
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

function installLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    get length() { return store.size; },
    key: index => [...store.keys()][index] ?? null,
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

test('completed time-scoped practice locks the entry for the same local day', () => {
  const store = installLocalStorage();
  const morning = new Date('2026-08-11T09:00:00+08:00').getTime();
  const evening = new Date('2026-08-11T21:00:00+08:00').getTime();

  assert.equal(readPracticeScopeDone('today_added', { now: morning }), null);

  markPracticeScopeDone('today_added', { wordIds: [11, 12], now: morning });
  const done = readPracticeScopeDone('today_added', { now: evening });
  assert.ok(done, '同一天内再次进入仍能看到完成标记');
  assert.deepEqual(done.wordIds, [11, 12]);
  assert.equal(done.completedAt, morning);

  assert.ok(store.has(`${PRACTICE_DONE_PREFIX}today_added`), 'v2 单键存储');
});

test('completion markers accumulate as a union across multiple rounds', () => {
  const store = installLocalStorage();
  const now = new Date('2026-08-11T12:00:00+08:00').getTime();

  markPracticeScopeDone('today_added', { wordIds: [11, 12], now });
  markPracticeScopeDone('today_added', { wordIds: [12, 13, 14], now });

  assert.deepEqual(readPracticeScopeDone('today_added', { now }).wordIds, [11, 12, 13, 14]);
  assert.equal(JSON.parse(store.get(`${PRACTICE_DONE_PREFIX}today_added`)).completedAt, now);
});

test('today_added markers expire on a new local day while recent_added keeps a rolling window', () => {
  const store = installLocalStorage();
  markPracticeScopeDone('recent_added', { now: new Date('2026-08-11T12:00:00+08:00').getTime() });
  markPracticeScopeDone('today_added', { now: new Date('2026-08-11T12:00:00+08:00').getTime() });

  assert.ok(readPracticeScopeDone('recent_added', { now: new Date('2026-08-11T23:00:00+08:00').getTime() }));
  // 跨天：today_added 失效，recent_added 仍在同一 7 天窗口内
  assert.equal(readPracticeScopeDone('today_added', { now: new Date('2026-08-12T00:30:00+08:00').getTime() }), null);
  assert.ok(readPracticeScopeDone('recent_added', { now: new Date('2026-08-12T00:30:00+08:00').getTime() }));
  // 超过 7 天：recent_added 也失效，整窗重新开放
  assert.equal(readPracticeScopeDone('recent_added', { now: new Date('2026-08-19T12:00:00+08:00').getTime() }), null);
  assert.ok(store.has(`${PRACTICE_DONE_PREFIX}recent_added`));
});

test('manual scope is never locked and unknown scopes are ignored', () => {
  const store = installLocalStorage();

  markPracticeScopeDone('manual', { wordIds: [31] });
  assert.equal(readPracticeScopeDone('manual'), null);
  assert.equal([...store.keys()].some(key => key.includes(':manual')), false);

  markPracticeScopeDone('article', { wordIds: [1] });
  assert.equal(readPracticeScopeDone('article'), null);
  assert.equal(store.size, 0);
});

test('corrupt completion markers read back as null and clear removes v2 and legacy keys', () => {
  const store = installLocalStorage();
  store.set(`${PRACTICE_DONE_PREFIX}today_added`, '{not-json');
  assert.equal(readPracticeScopeDone('today_added', { now: new Date('2026-08-11T12:00:00+08:00').getTime() }), null);

  markPracticeScopeDone('today_added', { now: new Date('2026-08-11T12:00:00+08:00').getTime() });
  store.set(`${PRACTICE_DONE_LEGACY_PREFIX}today_added:2026-08-10`, JSON.stringify({ wordIds: [9], completedAt: 1 }));
  clearPracticeScopeDone('today_added', { now: new Date('2026-08-11T12:00:00+08:00').getTime() });
  assert.equal(readPracticeScopeDone('today_added', { now: new Date('2026-08-11T12:00:00+08:00').getTime() }), null);
  assert.ok(!store.has(`${PRACTICE_DONE_LEGACY_PREFIX}today_added:2026-08-10`));
});

test('legacy date-keyed markers migrate into the v2 single key on read', () => {
  const store = installLocalStorage();
  const now = new Date('2026-08-11T12:00:00+08:00').getTime();
  const legacyKey = `${PRACTICE_DONE_LEGACY_PREFIX}today_added:2026-08-11`;
  store.set(legacyKey, JSON.stringify({ wordIds: [7, 8], completedAt: now }));

  const migrated = readPracticeScopeDone('today_added', { now });
  assert.deepEqual(migrated.wordIds, [7, 8]);
  assert.ok(store.has(`${PRACTICE_DONE_PREFIX}today_added`), 'v2 键已写入');
  assert.ok(!store.has(legacyKey), '旧键已删除');
});

test('getPracticeScopeStatus drives the three entry states', () => {
  installLocalStorage();
  const now = new Date('2026-08-11T12:00:00+08:00').getTime();
  const currentIds = [11, 12, 13];

  // 无标记：全部可复习
  assert.deepEqual(getPracticeScopeStatus({ scope: 'today_added', currentWordIds: currentIds, now }), {
    done: false,
    reviewedIds: [],
    newIds: [11, 12, 13]
  });

  // 部分完成：新增词单独列出，入口不锁定
  markPracticeScopeDone('today_added', { wordIds: [11, 12], now });
  assert.deepEqual(getPracticeScopeStatus({ scope: 'today_added', currentWordIds: currentIds, now }), {
    done: false,
    reviewedIds: [11, 12],
    newIds: [13]
  });

  // 全部完成：锁定
  markPracticeScopeDone('today_added', { wordIds: [13], now });
  assert.deepEqual(getPracticeScopeStatus({ scope: 'today_added', currentWordIds: currentIds, now }), {
    done: true,
    reviewedIds: [11, 12, 13],
    newIds: []
  });

  // manual 永不锁定
  assert.deepEqual(getPracticeScopeStatus({ scope: 'manual', currentWordIds: currentIds, now }), {
    done: false,
    reviewedIds: [],
    newIds: [11, 12, 13]
  });
});

test('recent_added status keeps reviewed words out across days within the rolling window', () => {
  installLocalStorage();
  const day1 = new Date('2026-08-11T12:00:00+08:00').getTime();
  const day2 = new Date('2026-08-12T09:00:00+08:00').getTime();
  const currentIds = [21, 22];

  markPracticeScopeDone('recent_added', { wordIds: [21, 22], now: day1 });

  // 跨天后：昨天复习过的词不算新增，词集无新词 → 锁定
  const status = getPracticeScopeStatus({ scope: 'recent_added', currentWordIds: currentIds, now: day2 });
  assert.equal(status.done, true);
  assert.deepEqual(status.reviewedIds, [21, 22]);
  assert.deepEqual(status.newIds, []);

  // 有新收藏词：只把新词列为可复习
  const withNew = getPracticeScopeStatus({ scope: 'recent_added', currentWordIds: [21, 22, 23], now: day2 });
  assert.equal(withNew.done, false);
  assert.deepEqual(withNew.reviewedIds, [21, 22]);
  assert.deepEqual(withNew.newIds, [23]);
});
