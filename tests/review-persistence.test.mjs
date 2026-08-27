import assert from 'node:assert/strict';
import test from 'node:test';

import { createReviewPersistence } from '../src/review-persistence.mjs';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    dump(key) { return values.get(key) ?? null; }
  };
}

function tick() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

test('rating is journaled before the asynchronous database write starts', async () => {
  const storage = memoryStorage();
  let release;
  const started = new Promise(resolve => { release = resolve; });
  const executeRating = async operation => {
    release();
    await new Promise(resolve => setTimeout(resolve, 30));
    return { operationId: operation.operationId };
  };
  const persistence = createReviewPersistence({ storage, executeRating });

  const accepted = persistence.enqueueRating({
    operationId: 'op-1',
    attemptId: 'attempt-1',
    wordId: 7,
    expectedRevision: 2,
    srsData: { state: 'review', interval: 3 },
    event: { rating: 5, source: 'flashcard' }
  });

  assert.equal(accepted.accepted, true);
  assert.match(storage.dump('english-reader:pending-review-writes:v1'), /op-1/);
  await started;
  assert.deepEqual(persistence.getPendingWordIds(), [7]);
  await persistence.flush();
  assert.deepEqual(persistence.getPendingWordIds(), []);
});

test('session saves are single-flight and retain the latest snapshot', async () => {
  const storage = memoryStorage();
  const writes = [];
  let releaseFirst;
  const firstStarted = new Promise(resolve => { releaseFirst = resolve; });
  let call = 0;
  const saveSession = async snapshot => {
    writes.push(snapshot.sequence);
    if (call++ === 0) {
      releaseFirst();
      await new Promise(resolve => setTimeout(resolve, 15));
    }
  };
  const persistence = createReviewPersistence({ storage, saveSession });

  persistence.enqueueSession({ key: 'review-session-active', snapshot: { sequence: 1, queue: [1] } });
  await firstStarted;
  persistence.enqueueSession({ key: 'review-session-active', snapshot: { sequence: 2, queue: [2] } });
  persistence.enqueueSession({ key: 'review-session-active', snapshot: { sequence: 3, queue: [3] } });

  await persistence.flush();
  assert.deepEqual(writes, [1, 3]);
});

test('failed session persistence remains retryable and does not reject a queued UI action', async () => {
  const storage = memoryStorage();
  let attempts = 0;
  const persistence = createReviewPersistence({
    storage,
    retryDelays: [],
    saveSession: async () => {
      attempts += 1;
      throw new Error('offline');
    }
  });

  const accepted = persistence.enqueueSession({ key: 'review-session-active', snapshot: { sequence: 1, queue: [9] } });
  assert.equal(accepted.accepted, true);
  await tick();
  assert.equal(persistence.getStatus().session.failed, 1);
  assert.deepEqual(persistence.getStatus().session.pendingKeys, ['review-session-active']);
  assert.equal(attempts, 1);
});

test('pending rating journal can be replayed by a fresh persistence instance', async () => {
  const storage = memoryStorage();
  const executed = [];
  const first = createReviewPersistence({
    storage,
    executeRating: async operation => { executed.push(operation.operationId); }
  });
  first.enqueueRating({
    operationId: 'op-replay',
    attemptId: 'attempt-replay',
    wordId: 11,
    expectedRevision: 0,
    srsData: { state: 'review' },
    event: { rating: 5 }
  });
  await first.flush();

  const second = createReviewPersistence({
    storage,
    executeRating: async operation => { executed.push(operation.operationId); }
  });
  await second.replay();
  assert.deepEqual(executed, ['op-replay']);
});

test('restored session sequences advance and a late save cannot resurrect a cleared session', async () => {
  const storage = memoryStorage();
  const saved = [];
  const deleted = [];
  let release;
  const started = new Promise(resolve => { release = resolve; });
  let first = true;
  const persistence = createReviewPersistence({
    storage,
    db: {
      saveReviewSession: async snapshot => {
        saved.push(snapshot.sequence);
        if (first) {
          first = false;
          await started;
        }
      },
      deleteReviewSession: async key => { deleted.push(key); }
    }
  });

  persistence.enqueueSession({ key: 'review-session-active', snapshot: { sequence: 40, queue: [1] } });
  await new Promise(resolve => setTimeout(resolve, 0));
  const clearPromise = persistence.clearSession({ key: 'review-session-active' });
  await clearPromise;
  release();
  await persistence.flush();

  persistence.enqueueSession({ key: 'review-session-active', snapshot: { sequence: 40, queue: [2] } });
  await persistence.flush();
  assert.deepEqual(saved, [40, 41]);
  assert.ok(deleted.length >= 2);
});

test('flush respects its deadline when an IndexedDB write never resolves', async () => {
  const storage = memoryStorage();
  let releaseStarted;
  const started = new Promise(resolve => { releaseStarted = resolve; });
  const persistence = createReviewPersistence({
    storage,
    executeRating: async () => {
      releaseStarted();
      return new Promise(() => {});
    }
  });

  persistence.enqueueRating({
    operationId: 'op-hung',
    attemptId: 'attempt-hung',
    wordId: 12,
    expectedRevision: 0,
    srsData: { state: 'review' },
    event: { rating: 5, source: 'flashcard' }
  });
  await started;

  const startedAt = Date.now();
  const status = await persistence.flush({ timeoutMs: 20 });
  assert.ok(Date.now() - startedAt < 250, 'flush should return after its deadline');
  assert.equal(status.rating.pending, 1);
  assert.equal(status.rating.running, true);
});
