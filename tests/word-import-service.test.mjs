import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeImportWords, analyzeWordImport, WordImportService } from '../src/word-import-service.mjs';

function fakeDbWithBatch(payload) {
  let stored = {
    batchId: 'batch-1',
    dayKey: '2026-08-24',
    words: ['one', 'two'],
    categories: { new: ['one', 'two'], externalReview: [], todayIgnored: [], invalid: [], failed: [] },
    counts: { recognized: 2, new: 2, externalReview: 0, todayIgnored: 0, invalid: 0, failed: 0 },
    completedLemmas: [],
    failed: [],
    ...payload
  };
  return {
    async saveLearningActivity(record) {
      stored = record.payload;
      return record;
    },
    getStoredBatch() {
      return stored;
    }
  };
}

function uniqueWord(index) {
  let suffix = '';
  let value = index;
  do {
    suffix = String.fromCharCode(97 + (value % 26)) + suffix;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return `word${suffix}`;
}

test('normalizes one file to unique lemmas before analysis', () => {
  assert.deepEqual(normalizeImportWords('Constraint constraint\nDERIVE, nearly'), ['constraint', 'derive', 'nearly']);
});

test('normalization reports a limit without scanning or silently accepting the next word', () => {
  const result = normalizeImportWords(
    Array.from({ length: 201 }, (_, index) => uniqueWord(index)).join(' '),
    { limit: 200, returnMeta: true }
  );
  assert.equal(result.words.length, 200);
  assert.equal(result.truncated, true);
});

test('normalization does not mark repeated words as an oversized import', () => {
  const result = normalizeImportWords(
    [...Array.from({ length: 200 }, (_, index) => uniqueWord(index)), uniqueWord(0)].join(' '),
    { limit: 200, returnMeta: true }
  );
  assert.equal(result.words.length, 200);
  assert.equal(result.truncated, false);
});

test('service uses one batch classifier for a large preview and exposes 200-word batches', async () => {
  const calls = [];
  const db = {
    async classifyWordImportCandidates(words, dayKey) {
      calls.push({ words: [...words], dayKey });
      return { existingWords: new Set(), todayProcessedWords: new Set() };
    }
  };
  const service = new WordImportService({
    db,
    now: () => new Date(2026, 7, 24, 9).getTime()
  });
  const plan = await service.createPlan(
    Array.from({ length: 401 }, (_, index) => uniqueWord(index)).join('\n'),
    { source: 'pdf' }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].words.length, 401);
  assert.equal(plan.batchCount, 3);
  assert.deepEqual(plan.batches.map(batch => batch.words.length), [200, 200, 1]);
  assert.equal(plan.source, 'pdf');
});

test('PDF preview marks more than 5000 unique words as confirmation-blocking', async () => {
  const service = new WordImportService({
    db: {
      async classifyWordImportCandidates() {
        throw new Error('classifier should not run for an oversized PDF');
      }
    },
    now: () => new Date(2026, 7, 24, 9).getTime()
  });
  const plan = await service.createPlan(
    Array.from({ length: 5001 }, (_, index) => uniqueWord(index)).join(' '),
    { source: 'pdf' }
  );
  assert.equal(plan.limitExceeded, true);
  assert.equal(plan.truncated, true);
  assert.equal(plan.wordLimit, 5000);
  assert.equal(plan.batchCount, 25);
});

test('classifies new, external, and today-ignored words before confirmation', async () => {
  const result = await analyzeWordImport({
    words: ['newword', 'oldword', 'todayword'],
    findWord: async word => word === 'newword' ? null : { id: word, word },
    findDaily: async word => word === 'todayword' ? { id: 'daily' } : null,
    dayKey: '2026-08-24'
  });
  assert.deepEqual(result.counts, { recognized: 3, new: 1, externalReview: 1, todayIgnored: 1, invalid: 0 });
});

test('service resumes an in-progress batch and never reapplies successful words', async () => {
  const applied = [];
  const service = new WordImportService({
    db: fakeDbWithBatch({ status: 'in_progress', completedLemmas: ['one'] }),
    lookup: async word => ({ word, translation: '释义' }),
    now: () => new Date(2026, 7, 24, 9).getTime()
  });
  service.applyWord = async word => { applied.push(word); return { status: 'new', lemma: word }; };
  await service.execute({
    batchId: 'batch-1',
    dayKey: '2026-08-24',
    words: ['one', 'two'],
    categories: { new: ['one', 'two'], externalReview: [], todayIgnored: [], invalid: [], failed: [] },
    counts: { recognized: 2, new: 2, externalReview: 0, todayIgnored: 0, invalid: 0, failed: 0 },
    completedLemmas: ['one']
  });
  assert.deepEqual(applied, ['two']);
});

test('service dispatches one library refresh event after an import batch', async () => {
  const events = [];
  const originalDocument = globalThis.document;
  const originalCustomEvent = globalThis.CustomEvent;
  globalThis.document = { dispatchEvent: event => events.push(event) };
  globalThis.CustomEvent = class TestCustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  };
  try {
    const service = new WordImportService({
      db: fakeDbWithBatch(),
      now: () => new Date(2026, 7, 24, 9).getTime()
    });
    service.applyWord = async word => ({ status: 'new', lemma: word });
    await service.execute({
      batchId: 'batch-refresh',
      dayKey: '2026-08-24',
      words: ['one', 'two'],
      categories: { new: ['one', 'two'], externalReview: [], todayIgnored: [], invalid: [], failed: [] },
      counts: { recognized: 2, new: 2, externalReview: 0, todayIgnored: 0, invalid: 0, failed: 0 },
      completedLemmas: []
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'word-library-changed');
    assert.deepEqual(events[0].detail, { reason: 'import', batchId: 'batch-refresh' });
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalCustomEvent === undefined) delete globalThis.CustomEvent;
    else globalThis.CustomEvent = originalCustomEvent;
  }
});
