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

test('normalizes one file to unique lemmas before analysis', () => {
  assert.deepEqual(normalizeImportWords('Constraint constraint\nDERIVE, nearly'), ['constraint', 'derive', 'nearly']);
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
