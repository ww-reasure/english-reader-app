import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createReviewPersistence } from '../src/review-persistence.mjs';
import { summarizeReviewPersistenceStatus } from '../src/review-persistence-status.mjs';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function tick() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

test('result save status distinguishes saving, failed, and fully saved states', () => {
  assert.deepEqual(
    summarizeReviewPersistenceStatus({ rating: { pending: 4, failed: 0, running: true } }),
    {
      state: 'saving',
      pending: 4,
      failed: 0,
      running: true,
      message: '正在保存 4 条复习记录…',
      retryable: false
    }
  );

  assert.deepEqual(
    summarizeReviewPersistenceStatus({ rating: { pending: 3, failed: 2, running: false } }),
    {
      state: 'failed',
      pending: 3,
      failed: 2,
      running: false,
      message: '还有 3 条复习记录待同步',
      retryable: true
    }
  );

  assert.deepEqual(
    summarizeReviewPersistenceStatus({ rating: { pending: 0, failed: 0, running: false } }),
    {
      state: 'saved',
      pending: 0,
      failed: 0,
      running: false,
      message: '复习记录已全部保存',
      retryable: false
    }
  );
});

test('result status treats a running writer as saving even before a queued count is visible', () => {
  const status = summarizeReviewPersistenceStatus({ rating: { pending: 0, failed: 0, running: true } });

  assert.equal(status.state, 'saving');
  assert.equal(status.message, '正在保存 0 条复习记录…');
});

test('a result page can observe pending ratings become fully saved without changing the UI contract', async () => {
  const storage = memoryStorage();
  let release;
  let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const executeRating = async () => {
    signalStarted();
    await new Promise(resolve => { release = resolve; });
  };
  const persistence = createReviewPersistence({ storage, executeRating });

  persistence.enqueueRating({
    operationId: 'result-pending-1',
    attemptId: 'result-attempt-1',
    wordId: 1,
    expectedRevision: 0,
    srsData: { state: 'review' },
    event: { rating: 5 }
  });
  await started;
  await tick();

  assert.equal(summarizeReviewPersistenceStatus(persistence.getStatus()).state, 'saving');
  release();
  await persistence.flush();
  await tick();
  assert.equal(summarizeReviewPersistenceStatus(persistence.getStatus()).state, 'saved');
});

test('failed result-page saves remain visible and retryFailed can recover them', async () => {
  const storage = memoryStorage();
  let shouldFail = true;
  const persistence = createReviewPersistence({
    storage,
    retryDelays: [],
    executeRating: async () => {
      if (shouldFail) throw new Error('offline');
    }
  });

  persistence.enqueueRating({
    operationId: 'result-retry-1',
    attemptId: 'result-retry-attempt-1',
    wordId: 2,
    expectedRevision: 0,
    srsData: { state: 'review' },
    event: { rating: 3 }
  });
  await tick();
  assert.deepEqual(summarizeReviewPersistenceStatus(persistence.getStatus()), {
    state: 'failed',
    pending: 1,
    failed: 1,
    running: false,
    message: '还有 1 条复习记录待同步',
    retryable: true
  });

  shouldFail = false;
  await persistence.retryFailed();
  assert.equal(summarizeReviewPersistenceStatus(persistence.getStatus()).state, 'saved');
});

test('formal result pages update an independent global persistence status and retry without rerendering', async () => {
  const [flashcard, context, persistence] = await Promise.all([
    readFile(new URL('../src/views/flashcard.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/context-review.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/review-persistence.mjs', import.meta.url), 'utf8')
  ]);

  for (const source of [flashcard, context]) {
    assert.match(source, /data-review-persistence-status/);
    assert.match(source, /reviewPersistence\?\.subscribe/);
    assert.match(source, /reviewPersistence\?\.getStatus/);
    assert.match(source, /retryFailed/);
    assert.match(source, /reviewPersistence\?\.flush/);
    assert.doesNotMatch(source, /renderResult\(.*\)[\s\S]{0,900}await this\.reviewPersistence\?\.flush/);
  }

  assert.match(flashcard, /review\.rating_accepted/);
  assert.doesNotMatch(flashcard, /review\.rating_saved/);
  assert.match(persistence, /review\.write_completed/);
});

test('practice result does not expose or flush formal review persistence status', async () => {
  const source = await readFile(new URL('../src/views/flashcard.js', import.meta.url), 'utf8');
  const resultStart = source.indexOf('  renderResult(container)');
  assert.ok(resultStart >= 0);

  const resultSource = source.slice(resultStart, source.indexOf('\n  invalidateCardRequests()', resultStart));
  assert.match(resultSource, /!isPractice[\s\S]*data-review-persistence-status/);
  assert.match(resultSource, /if \(!isPractice\)[\s\S]*reviewPersistence\?\.flush/);
});
