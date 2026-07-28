import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createKnowledgeEvidenceBridge,
  getTrustedFrequencyBand
} from '../src/components/knowledge-evidence-bridge.mjs';

const NOW = Date.parse('2026-07-26T09:00:00.000Z');

function createTrustedEntry(overrides = {}) {
  return {
    lemma: 'researcher',
    quality: 'limited',
    sourceRefs: ['ngsl-1.2'],
    layers: {
      frequency: [{ band: 'ngsl-2', sourceRef: 'ngsl-1.2' }]
    },
    ...overrides
  };
}

function createBridge({ entry = createTrustedEntry(), rejectWrite = false } = {}) {
  const calls = [];
  const readingCalls = [];
  const storage = { name: 'injected-db' };
  let receivedStorage = null;
  const profile = {
    async recordEvidence(input) {
      calls.push(input);
      if (rejectWrite) throw new Error('IndexedDB unavailable');
      return { accepted: true, evidence: input };
    },
    async recordQualifiedReadingObservation(input) {
      readingCalls.push(input);
      if (rejectWrite) throw new Error('IndexedDB unavailable');
      return { accepted: true, checkpoint: { qualifiedReadingCount: 1 } };
    }
  };
  const bridge = createKnowledgeEvidenceBridge({
    lexiconLoader: {
      async lookup() {
        return entry;
      }
    },
    storage,
    createProfileRepository(injectedStorage) {
      receivedStorage = injectedStorage;
      return profile;
    },
    now: () => NOW
  });

  return { bridge, calls, readingCalls, storage, get receivedStorage() { return receivedStorage; } };
}

test('maps a traceable frequency layer into an injected knowledge repository for unseen flashcard recall', async () => {
  const fixture = createBridge();

  const result = await fixture.bridge.recordFlashcardRating({
    word: 'Researchers',
    quality: 5,
    meaningRevealed: false,
    attemptId: 'review-1',
    contextId: 'card-1'
  });

  assert.equal(fixture.receivedStorage, fixture.storage);
  assert.equal(result.accepted, true);
  assert.deepEqual(fixture.calls, [{
    word: 'researcher',
    band: 'ngsl-2',
    kind: 'recall',
    correct: true,
    sawAnswer: false,
    source: 'flashcard-review',
    attemptId: 'review-1',
    contextId: 'card-1',
    occurredAt: NOW
  }]);
});

test('records vague, forgotten, and answer-revealed flashcard ratings as negative review evidence', async () => {
  const fixture = createBridge();

  await fixture.bridge.recordFlashcardRating({ word: 'researcher', quality: 3, attemptId: 'vague' });
  await fixture.bridge.recordFlashcardRating({ word: 'researcher', quality: 1, attemptId: 'forgotten' });
  await fixture.bridge.recordFlashcardRating({
    word: 'researcher', quality: 5, meaningRevealed: true, attemptId: 'answer-revealed'
  });

  assert.deepEqual(fixture.calls.map(({ kind, correct, sawAnswer, attemptId }) => ({ kind, correct, sawAnswer, attemptId })), [
    { kind: 'review', correct: false, sawAnswer: false, attemptId: 'vague' },
    { kind: 'review', correct: false, sawAnswer: false, attemptId: 'forgotten' },
    { kind: 'review', correct: true, sawAnswer: true, attemptId: 'answer-revealed' }
  ]);
});

test('lookup is negative evidence and uses the lexicon lemma instead of an inflected surface form', async () => {
  const fixture = createBridge();

  const result = await fixture.bridge.recordLookup({
    word: 'Researchers',
    articleId: 'article-7',
    contextId: 'tooltip-1',
    attemptId: 'lookup-1'
  });

  assert.equal(result.accepted, true);
  assert.deepEqual(fixture.calls, [{
    word: 'researcher',
    band: 'ngsl-2',
    kind: 'lookup',
    source: 'word-lookup',
    attemptId: 'lookup-1',
    contextId: 'tooltip-1',
    articleId: 'article-7',
    occurredAt: NOW
  }]);
});

test('records a qualified article-level reading observation without resolving or changing word evidence', async () => {
  const fixture = createBridge();

  const result = await fixture.bridge.recordQualifiedReadingObservation({
    articleId: 'article-7',
    wordCount: 200,
    completed: true,
    scrollDepth: 0.8,
    activeSeconds: 45
  });

  assert.deepEqual(result, { accepted: true, checkpoint: { qualifiedReadingCount: 1 } });
  assert.deepEqual(fixture.readingCalls, [{
    articleId: 'article-7',
    wordCount: 200,
    completed: true,
    scrollDepth: 0.8,
    activeSeconds: 45
  }]);
  assert.deepEqual(fixture.calls, []);
});

test('does not invent a frequency band when a lexicon entry is rejected or lacks a declared frequency source', async () => {
  assert.equal(getTrustedFrequencyBand(createTrustedEntry({ quality: 'rejected' })), null);
  assert.equal(getTrustedFrequencyBand(createTrustedEntry({
    layers: { frequency: [{ band: 'ngsl-2' }] }
  })), null);
  assert.equal(getTrustedFrequencyBand(createTrustedEntry({
    sourceRefs: ['oewn'],
    layers: { frequency: [{ band: 'ngsl-2', sourceRef: 'ngsl-1.2' }] }
  })), null);

  const fixture = createBridge({ entry: createTrustedEntry({ layers: {} }) });
  const result = await fixture.bridge.recordLookup({ word: 'researcher' });

  assert.deepEqual(result, { accepted: false, reason: 'untrusted-frequency-layer' });
  assert.deepEqual(fixture.calls, []);
});

test('does not resolve or persist an empty surface form even if a loader fixture returns an entry', async () => {
  const fixture = createBridge();

  const result = await fixture.bridge.recordLookup({ word: '   ' });

  assert.deepEqual(result, { accepted: false, reason: 'invalid-word' });
  assert.deepEqual(fixture.calls, []);
});

test('non-blocking bridge functions contain storage failures instead of rejecting the caller', async () => {
  const fixture = createBridge({ rejectWrite: true });

  const result = await fixture.bridge.recordFlashcardRating({
    word: 'researcher', quality: 5, meaningRevealed: false
  });

  assert.deepEqual(result, { accepted: false, reason: 'evidence-write-failed' });
  assert.equal(fixture.calls.length, 1);
});
