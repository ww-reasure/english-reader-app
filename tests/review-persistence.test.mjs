import assert from 'node:assert/strict';
import test from 'node:test';

import { createReviewPersistence } from '../src/review-persistence.mjs';
import { summarizeReviewPersistenceStatus } from '../src/review-persistence-status.mjs';

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

test('rating drain emits idle after the final completed row no longer remains pending', async () => {
  const storage = memoryStorage();
  const events = [];
  const persistence = createReviewPersistence({
    storage,
    onStatus: event => events.push(event),
    executeRating: async () => undefined
  });

  persistence.enqueueRating({
    operationId: 'op-drained',
    attemptId: 'attempt-drained',
    wordId: 13,
    expectedRevision: 0,
    srsData: { state: 'review' },
    event: { rating: 5 }
  });
  await persistence.flush();

  assert.deepEqual(events.at(-1), {
    type: 'rating_idle', pending: 0, failed: 0, running: false, operationIds: [], nextRetryAt: 0, errorCodes: []
  });
});

test('a legacy v1 journal row is migrated to a versioned rating intent before it is applied', async () => {
  const storage = memoryStorage();
  storage.setItem('english-reader:pending-review-writes:v1', JSON.stringify([{
    operationId: 'legacy-v1',
    attemptId: 'legacy-attempt',
    wordId: 14,
    expectedRevision: 2,
    srsData: { state: 'review', interval: 9 },
    event: { rating: 3, sessionDebt: 1, source: 'flashcard' },
    status: 'queued'
  }]));
  const calls = [];
  const persistence = createReviewPersistence({
    storage,
    db: {
      applyReviewRatingIntent: async (wordId, intent, options) => calls.push({ wordId, intent, options })
    }
  });

  await persistence.flush();

  assert.deepEqual(calls, [{
    wordId: 14,
    intent: {
      version: 2,
      rating: 3,
      sessionDebt: 1,
      occurredAt: 0,
      source: 'flashcard',
      sawAnswer: false
    },
    options: {
      attemptId: 'legacy-attempt',
      expectedRevision: 2,
      correlationId: undefined
    }
  }]);
  assert.equal(storage.dump('english-reader:pending-review-writes:v1'), '[]');
});

test('an unrecoverable legacy journal row remains visible instead of being silently cleared', () => {
  const storage = memoryStorage();
  storage.setItem('english-reader:pending-review-writes:v1', JSON.stringify([{
    operationId: 'broken-v1', attemptId: 'broken-attempt', wordId: 15, event: { rating: 2 }
  }]));

  const persistence = createReviewPersistence({ storage, executeRating: async () => undefined });

  assert.deepEqual(persistence.getStatus().rating.errorCodes, ['DATA_CORRUPT']);
  assert.equal(persistence.getStatus().rating.pending, 1);
  assert.equal(persistence.getStatus().rating.failed, 1);
  assert.match(storage.dump('english-reader:pending-review-writes:v1'), /broken-v1/);
});

test('a retrying word does not block a ready rating for another word', async () => {
  const storage = memoryStorage();
  const calls = [];
  let first = true;
  const persistence = createReviewPersistence({
    storage,
    retryDelays: [200],
    executeRating: async operation => {
      calls.push(operation.operationId);
      if (operation.operationId === 'word-a-1' && first) {
        first = false;
        throw new Error('temporary');
      }
    }
  });

  persistence.enqueueRating({ operationId: 'word-a-1', attemptId: 'a-1', wordId: 20, event: { rating: 1 } });
  persistence.enqueueRating({ operationId: 'word-b-1', attemptId: 'b-1', wordId: 21, event: { rating: 5 } });
  await tick();
  await tick();

  assert.deepEqual(calls, ['word-a-1', 'word-b-1']);
  assert.equal(persistence.getStatus().rating.pending, 1);
});

test('a later rating for the same word cannot overtake an earlier failed rating', async () => {
  const calls = [];
  const persistence = createReviewPersistence({
    storage: memoryStorage(),
    retryDelays: [],
    executeRating: async operation => {
      calls.push(operation.operationId);
      if (operation.operationId === 'same-word-first') throw new Error('permanent');
    }
  });

  persistence.enqueueRating({ operationId: 'same-word-first', attemptId: 'same-1', wordId: 30, event: { rating: 1 } });
  persistence.enqueueRating({ operationId: 'same-word-second', attemptId: 'same-2', wordId: 30, event: { rating: 5 } });
  persistence.enqueueRating({ operationId: 'other-word', attemptId: 'other-1', wordId: 31, event: { rating: 5 } });
  await tick();
  await tick();

  assert.deepEqual(calls, ['same-word-first', 'other-word']);
  assert.equal(persistence.getStatus().rating.pending, 2);
  assert.equal(persistence.getStatus().rating.failed, 1);
});

test('retry leaves a corrupt historical row failed instead of executing an empty intent', async () => {
  const storage = memoryStorage();
  storage.setItem('english-reader:pending-review-writes:v1', JSON.stringify([{
    operationId: 'broken-retry', attemptId: 'broken-retry-attempt', wordId: 32, event: { rating: 2 }
  }]));
  const calls = [];
  const persistence = createReviewPersistence({
    storage,
    executeRating: async operation => calls.push(operation)
  });

  await persistence.retryFailed();
  await tick();

  assert.deepEqual(calls, []);
  assert.equal(persistence.getStatus().rating.pending, 1);
  assert.equal(persistence.getStatus().rating.failed, 1);
  assert.deepEqual(persistence.getStatus().rating.errorCodes, ['DATA_CORRUPT']);
});

test('flush returns promptly when every queued row is waiting for its retry time', async () => {
  const persistence = createReviewPersistence({
    storage: memoryStorage(),
    retryDelays: [1000],
    executeRating: async () => { throw new Error('temporary'); }
  });
  persistence.enqueueRating({ operationId: 'future-retry', attemptId: 'future-retry-attempt', wordId: 33, event: { rating: 3 } });
  await tick();
  await tick();

  const startedAt = Date.now();
  const status = await persistence.flush({ timeoutMs: 500 });

  assert.ok(Date.now() - startedAt < 100, 'flush should not spin until its timeout while a retry timer owns the next attempt');
  assert.equal(status.rating.pending, 1);
  assert.ok(status.rating.nextRetryAt > Date.now());
});

test('an operation due earlier than the pending retry timer re-arms the wake timer', async () => {
  const storage = memoryStorage();
  const base = Date.now();
  // A restored journal row whose retry window is far in the future.
  storage.setItem('english-reader:pending-review-writes:v1', JSON.stringify([{
    operationId: 'seed-late',
    attemptId: 'seed-late-attempt',
    wordId: 101,
    expectedRevision: 1,
    intent: { version: 2, rating: 5, sessionDebt: 0, occurredAt: base, source: 'flashcard', sawAnswer: true },
    queuedAt: base,
    attempts: 1,
    nextRetryAt: base + 1200,
    status: 'queued'
  }]));
  const calls = [];
  const persistence = createReviewPersistence({
    storage,
    retryDelays: [100],
    executeRating: async operation => {
      calls.push(operation.operationId);
      const failures = calls.filter(id => id === 'early-b').length;
      if (operation.operationId === 'early-b' && failures === 1) throw new Error('temporary');
    }
  });

  // Lets the drain arm its wake timer for the late restored row.
  await persistence.flush({ timeoutMs: 0 });
  await tick();

  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const timerLog = [];
  let sequence = 0;
  const handles = new Map();
  try {
    globalThis.setTimeout = (fn, delay) => {
      const id = `spy-${sequence++}`;
      timerLog.push({ kind: 'set', id, delay: Number(delay) });
      handles.set(id, realSetTimeout(fn, delay));
      return id;
    };
    globalThis.clearTimeout = id => {
      timerLog.push({ kind: 'clear', id });
      handles.delete(id);
      return realClearTimeout(handles.get(id));
    };

    persistence.enqueueRating({
      operationId: 'early-b',
      attemptId: 'early-b-attempt',
      wordId: 102,
      expectedRevision: 0,
      event: { rating: 5 }
    });
    await tick();
    await tick();
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }

  const wakeEvents = timerLog.filter(entry => entry.kind === 'set');
  const clears = timerLog.filter(entry => entry.kind === 'clear');
  assert.ok(wakeEvents.length >= 2, 'a second wake timer must be scheduled for the earlier-due operation');
  assert.ok(clears.length >= 1, 'the stale late wake timer must be cancelled');
  const lastWake = wakeEvents.at(-1);
  assert.ok(lastWake.delay <= 150, `the re-armed timer must target the earlier retry time, got ${lastWake.delay}ms`);

  // The re-armed timer really fires and retries the earlier operation.
  await new Promise(resolve => realSetTimeout(resolve, 250));
  assert.ok(calls.filter(id => id === 'early-b').length >= 2);
  assert.ok(!calls.includes('seed-late'), 'the late row must keep its own scheduled wake');
});

test('journal rows without any stable identifier are kept as DATA_CORRUPT instead of being silently dropped', async () => {
  const storage = memoryStorage();
  storage.setItem('english-reader:pending-review-writes:v1', JSON.stringify([
    { garbage: true },
    { event: { rating: 5 } },
    { operationId: 'valid-id', attemptId: 'valid-id-attempt', wordId: 9, event: { rating: 5 } }
  ]));
  const calls = [];
  const persistence = createReviewPersistence({
    storage,
    executeRating: async operation => calls.push(operation.operationId)
  });

  const rating = persistence.getStatus().rating;
  assert.equal(rating.pending, 3);
  assert.equal(rating.failed, 2);
  assert.deepEqual(rating.errorCodes, ['DATA_CORRUPT']);

  await persistence.flush();
  assert.deepEqual(calls, ['valid-id'], 'rows without identifiers must never be executed');

  await persistence.retryFailed();
  await tick();
  assert.deepEqual(calls, ['valid-id']);
  assert.equal(persistence.getStatus().rating.failed, 2);
  assert.match(storage.dump('english-reader:pending-review-writes:v1'), /garbage/);
});

test('a mixed 14-row legacy journal migrates valid rows and keeps corrupt rows visible', async () => {
  const storage = memoryStorage();
  const rows = [];
  for (let index = 0; index < 6; index += 1) {
    rows.push({ operationId: `ok-${index}`, attemptId: `ok-attempt-${index}`, wordId: 200 + index, event: { rating: 5, source: 'flashcard' } });
  }
  for (let index = 0; index < 2; index += 1) {
    rows.push({ operationId: `conflict-${index}`, attemptId: `conflict-attempt-${index}`, wordId: 210 + index, event: { rating: 3, source: 'flashcard' } });
  }
  for (let index = 0; index < 2; index += 1) {
    rows.push({ operationId: `temp-${index}`, attemptId: `temp-attempt-${index}`, wordId: 220 + index, event: { rating: 1, source: 'flashcard' } });
  }
  for (let index = 0; index < 2; index += 1) {
    rows.push({ operationId: `corrupt-${index}`, attemptId: `corrupt-attempt-${index}`, wordId: 230 + index, event: { rating: 2 } });
  }
  rows.push({ junk: true });
  rows.push({ note: 'no identifiers at all' });
  assert.equal(rows.length, 14);
  storage.setItem('english-reader:pending-review-writes:v1', JSON.stringify(rows));

  const settled = [];
  let conflictFailures = 0;
  let tempFailures = 0;
  const persistence = createReviewPersistence({
    storage,
    retryDelays: [10],
    executeRating: async operation => {
      if (operation.operationId.startsWith('conflict-') && conflictFailures < 2) {
        conflictFailures += 1;
        throw Object.assign(new Error('revision moved'), { code: 'REVISION_CONFLICT' });
      }
      if (operation.operationId.startsWith('temp-') && tempFailures < 2) {
        tempFailures += 1;
        throw new Error('temporary storage error');
      }
      settled.push(operation.operationId);
    }
  });

  assert.equal(persistence.getStatus().rating.failed, 4, 'only the four corrupt rows start failed');
  // First pass submits the clean rows and surfaces the temporary failures;
  // the explicit replay then submits every remaining identifiable row.
  await persistence.flush({ timeoutMs: 2000 });
  await persistence.retryFailed();
  await tick();

  const expectedValid = [
    ...Array.from({ length: 6 }, (_, index) => `ok-${index}`),
    ...Array.from({ length: 2 }, (_, index) => `conflict-${index}`),
    ...Array.from({ length: 2 }, (_, index) => `temp-${index}`)
  ];
  assert.deepEqual(settled.slice().sort(), expectedValid.sort(), 'every identifiable row is submitted exactly once');
  const status = persistence.getStatus().rating;
  assert.equal(status.pending, 4);
  assert.equal(status.failed, 4);
  assert.deepEqual(status.errorCodes, ['DATA_CORRUPT']);
  assert.equal(status.running, false, 'no endless running state remains');
});

test('retry scheduling emits a privacy-safe diagnostic event and a successful rating ends idle', async () => {
  const storage = memoryStorage();
  const diagnosticEvents = [];
  const previousLogger = globalThis.__englishReaderDiagnosticLogger;
  globalThis.__englishReaderDiagnosticLogger = {
    record: (type, entry) => diagnosticEvents.push({ type, entry })
  };
  let attempts = 0;
  const statusEvents = [];
  const persistence = createReviewPersistence({
    storage,
    retryDelays: [5],
    onStatus: event => statusEvents.push(event),
    executeRating: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary');
    }
  });

  try {
    persistence.enqueueRating({
      operationId: 'evidence-1',
      attemptId: 'evidence-attempt-1',
      wordId: 40,
      expectedRevision: 0,
      srsData: { state: 'review' },
      event: { rating: 5, source: 'flashcard' }
    });
    // The first failure surfaces the retry-scheduled evidence; the explicit
    // replay settles the row deterministically without racing the wake timer.
    await persistence.flush({ timeoutMs: 0 });
    await tick();
    await persistence.retryFailed();

    const retryDiagnostics = diagnosticEvents.filter(entry => entry.type === 'review.retry_scheduled');
    assert.equal(retryDiagnostics.length, 1, 'a retry schedule is visible in diagnostics');
    const payload = retryDiagnostics[0].entry.payload;
    assert.equal(payload.operationId, 'evidence-1');
    assert.ok(payload.nextRetryAt > 0);
    assert.ok(!JSON.stringify(retryDiagnostics[0].entry).includes('temporary'), 'error messages stay out of diagnostics');

    // The sequence contains every required stage in order. A trailing second
    // rating_idle is a pre-existing idempotent broadcast from a later empty
    // drain, so the assertion only pins the ordered prefix plus the final idle.
    const types = statusEvents.map(event => event.type);
    assert.deepEqual(types.slice(0, 7), [
      'rating_queued',
      'rating_started',
      'rating_retry_scheduled',
      'pending_replayed',
      'rating_started',
      'rating_completed',
      'rating_idle'
    ]);
    assert.equal(types.at(-1), 'rating_idle');
    const idle = statusEvents.at(-1);
    assert.equal(idle.pending, 0);
    assert.equal(idle.failed, 0);
    assert.equal(idle.running, false);
    assert.equal(idle.nextRetryAt, 0);
  } finally {
    if (previousLogger === undefined) delete globalThis.__englishReaderDiagnosticLogger;
    else globalThis.__englishReaderDiagnosticLogger = previousLogger;
  }
});

test('a completely corrupted journal is quarantined as DATA_CORRUPT instead of reporting saved', async () => {
  const storage = memoryStorage();
  storage.setItem('english-reader:pending-review-writes:v1', '这不是有效的JSON{{{');
  const calls = [];
  const persistence = createReviewPersistence({
    storage,
    executeRating: async operation => calls.push(operation)
  });

  const rating = persistence.getStatus().rating;
  assert.ok(rating.pending >= 1, 'a corrupted journal must not read as zero pending');
  assert.ok(rating.failed >= 1, 'a corrupted journal must surface a failure');
  assert.deepEqual(rating.errorCodes, ['DATA_CORRUPT']);
  const summary = summarizeReviewPersistenceStatus(persistence.getStatus());
  assert.notEqual(summary.state, 'saved');
  assert.equal(summary.message.includes('已全部保存'), false, 'must not claim everything is saved');

  await persistence.flush();
  await persistence.retryFailed();
  await tick();
  assert.equal(calls.length, 0, 'corrupted journal text must never be executed as a rating');
  assert.match(storage.dump('english-reader:pending-review-writes:v1'), /这不是有效的JSON/, 'the raw evidence stays preserved');
});

test('journal rows with whitespace-only ids or an invalid wordId are quarantined, and valid padded ids are trimmed', async () => {
  const storage = memoryStorage();
  storage.setItem('english-reader:pending-review-writes:v1', JSON.stringify([
    { operationId: '   ', attemptId: 'att-space', wordId: 50, event: { rating: 5 } },
    { operationId: 'op-space', attemptId: '   ', wordId: 51, event: { rating: 5 } },
    { operationId: 'op-word-empty', attemptId: 'att-word-empty', wordId: '', event: { rating: 5 } },
    { operationId: 'op-word-text', attemptId: 'att-word-text', wordId: 'abc', event: { rating: 5 } },
    { operationId: 'op-word-zero', attemptId: 'att-word-zero', wordId: 0, event: { rating: 5 } },
    { operationId: 'op-word-negative', attemptId: 'att-word-negative', wordId: -5, event: { rating: 5 } },
    { operationId: 'op-word-fraction', attemptId: 'att-word-fraction', wordId: 2.5, event: { rating: 5 } },
    { operationId: '  op-padded  ', attemptId: '  att-padded  ', wordId: 60, event: { rating: 5 } }
  ]));
  const calls = [];
  const persistence = createReviewPersistence({
    storage,
    executeRating: async operation => calls.push(operation)
  });

  const rating = persistence.getStatus().rating;
  assert.equal(rating.failed, 7, 'only the padded-but-valid row stays replayable');
  assert.equal(rating.pending, 8);
  assert.deepEqual(rating.errorCodes, ['DATA_CORRUPT']);

  await persistence.flush();
  assert.equal(calls.length, 1, 'invalid identifier rows must never reach executeRating');
  assert.equal(calls[0].operationId, 'op-padded', 'valid ids are trimmed before use');
  assert.equal(calls[0].attemptId, 'att-padded', 'attempt ids are trimmed so the db-level idempotency index cannot be bypassed with blanks');

  await persistence.retryFailed();
  await tick();
  assert.equal(calls.length, 1, 'retry keeps quarantined rows failed instead of executing them');
  assert.equal(persistence.getStatus().rating.failed, 7);
});

test('non-object journal elements are quarantined instead of being silently dropped', async () => {
  const storage = memoryStorage();
  storage.setItem('english-reader:pending-review-writes:v1', JSON.stringify([42, null, 'bad']));
  const calls = [];
  const persistence = createReviewPersistence({
    storage,
    executeRating: async operation => calls.push(operation)
  });

  const rating = persistence.getStatus().rating;
  assert.ok(rating.pending >= 3, `a journal of three corrupted elements must not read as empty, got pending=${rating.pending}`);
  assert.ok(rating.failed >= 3, `all three elements must be quarantined as failures, got failed=${rating.failed}`);
  assert.ok(rating.errorCodes.includes('DATA_CORRUPT'));
  const summary = summarizeReviewPersistenceStatus(persistence.getStatus());
  assert.notEqual(summary.state, 'saved');
  assert.equal(summary.message.includes('已全部保存'), false);

  await persistence.flush();
  await persistence.retryFailed();
  await tick();
  assert.equal(calls.length, 0, 'corrupted elements must never be executed as ratings');
  const dumped = storage.dump('english-reader:pending-review-writes:v1');
  assert.ok(dumped.includes('42') && dumped.includes('bad'), 'the corrupted evidence stays preserved in the journal');
});

test('enqueueRating rejects non-positive-integer wordIds before they reach the journal', () => {
  for (const invalidWordId of [0, -1, 2.5, '', 'abc', Number.NaN]) {
    const storage = memoryStorage();
    const calls = [];
    const persistence = createReviewPersistence({
      storage,
      executeRating: async operation => calls.push(operation)
    });

    assert.throws(
      () => persistence.enqueueRating({
        operationId: `probe-${String(invalidWordId)}`,
        attemptId: `probe-attempt-${String(invalidWordId)}`,
        wordId: invalidWordId,
        event: { rating: 5 }
      }),
      undefined,
      `wordId ${String(invalidWordId)} must be rejected`
    );
    assert.equal(persistence.getStatus().rating.pending, 0, `wordId ${String(invalidWordId)} must not enter the journal`);
    assert.match(storage.dump('english-reader:pending-review-writes:v1') ?? '[]', /\[\]/);
  }

  const storage = memoryStorage();
  const calls = [];
  const persistence = createReviewPersistence({
    storage,
    executeRating: async operation => calls.push(operation)
  });
  persistence.enqueueRating({
    operationId: 'valid-positive',
    attemptId: 'valid-positive-attempt',
    wordId: Number.MAX_SAFE_INTEGER - 1,
    expectedRevision: 0,
    event: { rating: 5 }
  });
  return persistence.flush().then(() => {
    assert.equal(calls.length, 1, 'a legal positive safe integer still settles normally');
    assert.equal(calls[0].wordId, Number.MAX_SAFE_INTEGER - 1);
  });
});
