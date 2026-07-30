import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CALIBRATION_DIAGNOSTIC_QUESTION_COUNT,
  CALIBRATION_QUALIFIED_READING_TARGET,
  KNOWLEDGE_PROFILE_SCHEMA_VERSION,
  MIN_INDEPENDENT_EVIDENCE_GAP_MS,
  KnowledgeEvidenceStatus,
  buildCalibrationProgress,
  buildReadingFeedbackCheckpoint,
  createKnowledgeProfileRepository,
  isQualifyingReadingEvidence
} from '../src/knowledge-profile.mjs';

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createMemoryStorage() {
  const words = new Map();
  const bands = new Map();
  const evidence = [];
  const meta = new Map();

  return {
    async getKnowledgeWord(lemma) {
      return clone(words.get(lemma) || null);
    },
    async getKnowledgeBand(band) {
      return clone(bands.get(band) || null);
    },
    async getKnowledgeProfileMeta(key) {
      return clone(meta.get(key) || null);
    },
    async getKnowledgeEvidenceByCalibrationKey(calibrationKey) {
      return clone(evidence.find(item => item.calibrationKey === calibrationKey) || null);
    },
    async saveKnowledgeProfileMeta(record) {
      meta.set(record.key, clone(record));
      return record.key;
    },
    async saveKnowledgeProfileUpdate(update) {
      words.set(update.word.lemma, clone(update.word));
      bands.set(update.band.band, clone(update.band));
      evidence.push(clone(update.evidence));
      return { word: clone(update.word), band: clone(update.band), evidence: clone(update.evidence) };
    },
    snapshot() {
      return {
        words: [...words.values()].map(clone),
        bands: [...bands.values()].map(clone),
        evidence: evidence.map(clone),
        meta: [...meta.values()].map(clone)
      };
    }
  };
}

const FIRST = Date.parse('2026-07-26T08:00:00.000Z');

test('context successes stay separate while only context failure lowers mastery', async () => {
  const storage = createMemoryStorage();
  const profile = createKnowledgeProfileRepository(storage, { now: () => FIRST });

  const known = await profile.recordEvidence({ word: 'context', band: 'ngsl-1', kind: 'context', contextResult: 'known', assistedLookupCount: 0 });
  assert.equal(known.word.contextKnownCount, 1);
  assert.equal(known.word.successCount, 0);
  assert.equal(known.word.status, KnowledgeEvidenceStatus.OBSERVABLE);

  const assisted = await profile.recordEvidence({ word: 'context', band: 'ngsl-1', kind: 'context', contextResult: 'known', assistedLookupCount: 1 });
  assert.equal(assisted.word.assistedContextKnownCount, 1);
  assert.equal(assisted.word.successCount, 0);

  const uncertain = await profile.recordEvidence({ word: 'context', band: 'ngsl-1', kind: 'context', contextResult: 'uncertain' });
  assert.equal(uncertain.word.contextUncertainCount, 1);
  assert.equal(uncertain.word.failureCount, 0);

  const failed = await profile.recordEvidence({ word: 'context', band: 'ngsl-1', kind: 'context', contextResult: 'unknown' });
  assert.equal(failed.word.contextFailureCount, 1);
  assert.equal(failed.word.failureCount, 1);
  assert.equal(failed.word.status, KnowledgeEvidenceStatus.OBSERVABLE);
});

test('short repeated successes in one context do not inflate independent success, while a new context does', async () => {
  const storage = createMemoryStorage();
  const profile = createKnowledgeProfileRepository(storage, { now: () => FIRST });

  await profile.initialize();
  const first = await profile.recordEvidence({
    word: 'Analyze',
    band: 'ngsl-1',
    kind: 'diagnostic',
    correct: true,
    source: 'flashcard-review',
    attemptId: 'assessment-1',
    contextId: 'card-1',
    occurredAt: FIRST
  });

  assert.equal(first.word.status, KnowledgeEvidenceStatus.PROVISIONAL);
  assert.equal(first.word.successCount, 1);
  assert.equal(first.band.masteryProbability, 2 / 3);
  assert.equal(first.band.confidence, 1 / 7);

  const repeated = await profile.recordEvidence({
    word: 'analyze',
    band: 'ngsl-1',
    kind: 'recall',
    correct: true,
    source: 'flashcard-review',
    attemptId: 'flashcard-1',
    contextId: 'card-1',
    occurredAt: FIRST + 60_000
  });

  assert.equal(repeated.word.status, KnowledgeEvidenceStatus.PROVISIONAL);
  assert.equal(repeated.word.successCount, 2);
  assert.equal(repeated.word.independentSuccessCount, 1);
  assert.equal(repeated.band.successCount, 2);
  assert.equal(repeated.band.independentSuccessCount, 1);

  const independent = await profile.recordEvidence({
    word: 'analyze',
    band: 'ngsl-1',
    kind: 'recall',
    correct: true,
    source: 'flashcard-review',
    attemptId: 'flashcard-2',
    contextId: 'card-2',
    occurredAt: FIRST + 2 * 60_000
  });

  assert.equal(independent.word.status, KnowledgeEvidenceStatus.ESTABLISHED);
  assert.equal(independent.word.successCount, 3);
  assert.equal(independent.word.independentSuccessCount, 2);
  assert.equal(independent.band.successCount, 3);
  assert.equal(independent.band.independentSuccessCount, 2);
  assert.equal(independent.band.independentFailureCount, 0);
  assert.equal(independent.band.independentDirectEvidenceCount, 2);
  assert.deepEqual(storage.snapshot().bands[0], independent.band);
});

test('short repeated failures stay visible without inflating independent band failure evidence', async () => {
  const storage = createMemoryStorage();
  const profile = createKnowledgeProfileRepository(storage, { now: () => FIRST });

  await profile.recordEvidence({
    word: 'retain', band: 'ngsl-1', kind: 'diagnostic', correct: true,
    source: 'initial-assessment', attemptId: 'assessment-1', contextId: 'question-1', occurredAt: FIRST
  });
  const firstFailure = await profile.recordEvidence({
    word: 'retain', band: 'ngsl-1', kind: 'review', correct: false,
    source: 'flashcard-review', attemptId: 'review-1', contextId: 'card-1', occurredAt: FIRST + 60_000
  });
  const retry = await profile.recordEvidence({
    word: 'retain', band: 'ngsl-1', kind: 'review', correct: false,
    source: 'flashcard-review', attemptId: 'review-2', contextId: 'card-1', occurredAt: FIRST + 120_000
  });
  const spacedRetry = await profile.recordEvidence({
    word: 'retain', band: 'ngsl-1', kind: 'review', correct: false,
    source: 'flashcard-review', attemptId: 'review-3', contextId: 'card-1',
    occurredAt: FIRST + MIN_INDEPENDENT_EVIDENCE_GAP_MS + 120_000
  });

  assert.equal(firstFailure.band.independentFailureCount, 1);
  assert.equal(retry.band.failureCount, 2);
  assert.equal(retry.band.independentFailureCount, 1);
  assert.equal(spacedRetry.band.failureCount, 3);
  assert.equal(spacedRetry.band.independentFailureCount, 2);
  assert.equal(spacedRetry.band.independentDirectEvidenceCount, 3);
  assert.equal(spacedRetry.band.independentMasteryProbability, 2 / 5);
});

test('one short context cannot become two independent observations merely by changing from success to failure', async () => {
  const storage = createMemoryStorage();
  const profile = createKnowledgeProfileRepository(storage, { now: () => FIRST });

  await profile.recordEvidence({
    word: 'context', band: 'ngsl-1', kind: 'recall', correct: true,
    source: 'flashcard-review', attemptId: 'one', contextId: 'card-1', occurredAt: FIRST
  });
  const changedOutcome = await profile.recordEvidence({
    word: 'context', band: 'ngsl-1', kind: 'review', correct: false,
    source: 'flashcard-review', attemptId: 'two', contextId: 'card-1', occurredAt: FIRST + 60_000
  });

  assert.equal(changedOutcome.band.successCount, 1);
  assert.equal(changedOutcome.band.failureCount, 1);
  assert.equal(changedOutcome.band.independentSuccessCount, 1);
  assert.equal(changedOutcome.band.independentFailureCount, 0);
  assert.equal(changedOutcome.band.independentDirectEvidenceCount, 1);
});

test('legacy knowledge snapshots keep total evidence but never invent independent evidence', async () => {
  const storage = createMemoryStorage();
  await storage.saveKnowledgeProfileUpdate({
    word: {
      lemma: 'legacy', status: KnowledgeEvidenceStatus.ESTABLISHED,
      successCount: 5, failureCount: 2, schemaVersion: 1
    },
    band: {
      band: 'ngsl-1', successCount: 12, failureCount: 4, schemaVersion: 1
    },
    evidence: { lemma: 'legacy', band: 'ngsl-1', kind: 'diagnostic', occurredAt: FIRST }
  });

  const profile = createKnowledgeProfileRepository(storage, { now: () => FIRST + 1 });
  const band = await profile.getBandProfile('ngsl-1');

  assert.equal(band.successCount, 12);
  assert.equal(band.failureCount, 4);
  assert.equal(band.independentSuccessCount, 0);
  assert.equal(band.independentFailureCount, 0);
  assert.equal(band.independentDirectEvidenceCount, 0);
  assert.equal(band.independentMasteryProbability, null);
});

test('a lookup or answer-revealed score lowers evidence instead of preserving a hidden mastery claim', async () => {
  const storage = createMemoryStorage();
  const profile = createKnowledgeProfileRepository(storage);

  await profile.recordEvidence({
    word: 'stable', band: 'ngsl-1', kind: 'diagnostic', correct: true,
    source: 'assessment', attemptId: 'a', occurredAt: FIRST
  });
  await profile.recordEvidence({
    word: 'stable', band: 'ngsl-1', kind: 'recall', correct: true,
    source: 'flashcard', attemptId: 'b', occurredAt: FIRST + 1
  });
  const result = await profile.recordEvidence({
    word: 'stable', band: 'ngsl-1', kind: 'review', correct: true, sawAnswer: true,
    source: 'flashcard', attemptId: 'c', occurredAt: FIRST + 2
  });

  assert.equal(result.word.status, KnowledgeEvidenceStatus.PROVISIONAL);
  assert.equal(result.word.failureCount, 1);
  assert.equal(result.word.successCount, 2);
  assert.equal(result.band.failureCount, 1);
  assert.equal(result.band.masteryProbability, 3 / 5);
});

test('exposes only evidence-backed frequency-band estimates to article matching', async () => {
  const storage = createMemoryStorage();
  const profile = createKnowledgeProfileRepository(storage);

  assert.equal(await profile.getBandProfile('ngsl-1'), null);
  await profile.recordEvidence({
    word: 'evidence', band: 'ngsl-1', kind: 'diagnostic', correct: true,
    source: 'assessment', attemptId: 'diagnostic-1', occurredAt: FIRST
  });

  const band = await profile.getBandProfile('ngsl-1');
  const many = await profile.getBandProfiles(['ngsl-1', 'ngsl-2']);
  assert.equal(band.masteryProbability, 2 / 3);
  assert.equal(band.confidence, 1 / 7);
  assert.equal(many.get('ngsl-1').masteryProbability, 2 / 3);
  assert.equal(many.get('ngsl-2'), null);
});

test('only quality-gated foreground reading is stored as observable evidence and it never upgrades mastery', async () => {
  const storage = createMemoryStorage();
  const profile = createKnowledgeProfileRepository(storage);
  const shortForeground = {
    word: 'coast',
    band: 'ngsl-1',
    articleId: 'article-1',
    completed: true,
    visibleRatio: 0.8,
    foregroundSeconds: 59,
    wordCount: 200,
    occurredAt: FIRST
  };

  assert.equal(isQualifyingReadingEvidence(shortForeground), false);
  assert.deepEqual(await profile.recordReadingEvidence(shortForeground), {
    accepted: false,
    reason: 'insufficient-reading-quality'
  });
  assert.deepEqual(storage.snapshot().evidence, []);

  const qualifying = {
    ...shortForeground,
    foregroundSeconds: 60
  };
  assert.equal(isQualifyingReadingEvidence(qualifying), true);

  const result = await profile.recordReadingEvidence(qualifying);
  assert.equal(result.accepted, true);
  assert.equal(result.word.status, KnowledgeEvidenceStatus.OBSERVABLE);
  assert.equal(result.word.successCount, 0);
  assert.equal(result.band.observedReadingCount, 1);
  assert.equal(result.band.masteryProbability, null);
  assert.equal(result.band.confidence, 0);
});

test('persists each qualifying article once as a reading observation without touching word or band mastery', async () => {
  const storage = createMemoryStorage();
  const profile = createKnowledgeProfileRepository(storage, { now: () => FIRST });
  const reading = articleId => ({
    articleId,
    completed: true,
    visibleRatio: 0.7,
    foregroundSeconds: 60,
    wordCount: 200,
    occurredAt: FIRST
  });

  const first = await profile.recordQualifiedReadingObservation(reading('article-1'));
  const duplicate = await profile.recordQualifiedReadingObservation(reading('article-1'));
  await profile.recordQualifiedReadingObservation(reading('article-2'));
  await profile.recordQualifiedReadingObservation(reading('article-3'));
  const checkpoint = await profile.getQualifiedReadingObservationCheckpoint();

  assert.equal(first.accepted, true);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.reason, 'duplicate-qualified-reading');
  assert.deepEqual(checkpoint.qualifiedArticleIds, ['article-1', 'article-2', 'article-3']);
  assert.equal(checkpoint.qualifiedReadingCount, 3);
  assert.equal(checkpoint.shouldRequestFeedback, true);
  assert.deepEqual(storage.snapshot().words, []);
  assert.deepEqual(storage.snapshot().bands, []);
  assert.deepEqual(storage.snapshot().evidence, []);
  assert.equal(storage.snapshot().meta.some(record => record.key === 'knowledge-profile-qualified-readings'), true);
});

test('difficulty feedback uses only de-duplicated qualified-reading observations', async () => {
  const storage = createMemoryStorage();
  const profile = createKnowledgeProfileRepository(storage, { now: () => FIRST });
  const reading = articleId => ({
    articleId,
    completed: true,
    scrollDepth: 0.7,
    activeSeconds: 60,
    wordCount: 200,
    occurredAt: FIRST
  });

  await profile.recordQualifiedReadingObservation(reading('article-1'));
  await profile.recordQualifiedReadingObservation(reading('article-2'));
  await profile.recordQualifiedReadingObservation(reading('article-3'));
  const feedback = await profile.saveQualifiedReadingDifficultyFeedback('too_easy', FIRST + 10);
  const checkpoint = await profile.getQualifiedReadingObservationCheckpoint();

  assert.equal(feedback.value, 'too_easy');
  assert.deepEqual(feedback.qualifiedArticleIds, ['article-1', 'article-2', 'article-3']);
  assert.equal(checkpoint.shouldRequestFeedback, false);
  assert.deepEqual(storage.snapshot().words, []);
  assert.deepEqual(storage.snapshot().bands, []);
  assert.deepEqual(storage.snapshot().evidence, []);
});

test('initialization creates a safe schema marker without treating legacy learning words as known', async () => {
  const storage = createMemoryStorage();
  const profile = createKnowledgeProfileRepository(storage, { now: () => FIRST });

  const migration = await profile.initialize();
  const rerun = await profile.initialize();

  assert.deepEqual(migration, {
    key: 'knowledge-profile-schema',
    schemaVersion: KNOWLEDGE_PROFILE_SCHEMA_VERSION,
    migratedAt: FIRST,
    legacyLearnWordsImported: false
  });
  assert.deepEqual(rerun, migration);
});

test('calibration helpers require 24 distinct diagnostic questions and three qualified readings before feedback', () => {
  const diagnostics = Array.from({ length: CALIBRATION_DIAGNOSTIC_QUESTION_COUNT }, (_, index) => ({
    questionId: `q-${index}`,
    correct: index % 2 === 0,
    sawAnswer: false
  }));

  const progress = buildCalibrationProgress(diagnostics);
  assert.equal(progress.completedQuestionCount, 24);
  assert.equal(progress.correctCount, 12);
  assert.equal(progress.isComplete, true);

  const incomplete = buildCalibrationProgress([...diagnostics, { ...diagnostics[0], correct: false }]);
  assert.equal(incomplete.completedQuestionCount, 24);

  const reading = index => ({
    articleId: `article-${index}`,
    completed: true,
    visibleRatio: 0.7,
    foregroundSeconds: 60,
    wordCount: 200
  });
  const checkpoint = buildReadingFeedbackCheckpoint([reading(1), reading(2), reading(3)]);

  assert.equal(CALIBRATION_QUALIFIED_READING_TARGET, 3);
  assert.equal(checkpoint.qualifiedReadingCount, 3);
  assert.equal(checkpoint.shouldRequestFeedback, true);
  assert.deepEqual(checkpoint.options, ['too_hard', 'fitting', 'too_easy']);
  assert.equal(buildReadingFeedbackCheckpoint([reading(1), reading(2), reading(3)], { value: 'appropriate' }).shouldRequestFeedback, false);
});

test('repository records calibration answers as diagnostics and persists one feedback choice after three qualified readings', async () => {
  const storage = createMemoryStorage();
  const profile = createKnowledgeProfileRepository(storage, { now: () => FIRST });
  const calibration = await profile.recordCalibrationEvidence({
    questionId: 'q-1',
    word: 'marine',
    band: 'ngsl-2',
    correct: true,
    occurredAt: FIRST
  });
  assert.equal(calibration.evidence.kind, 'diagnostic');
  assert.equal(calibration.evidence.source, 'initial-calibration');
  await assert.rejects(
    profile.recordCalibrationEvidence({ word: 'marine', band: 'ngsl-2', correct: true }),
    /题目编号/
  );

  const readings = [1, 2, 3].map(index => ({
    articleId: `article-${index}`,
    completed: true,
    visibleRatio: 0.7,
    foregroundSeconds: 60,
    wordCount: 200
  }));
  assert.equal((await profile.getReadingFeedbackCheckpoint(readings)).shouldRequestFeedback, true);

  const feedback = await profile.saveDifficultyFeedback(readings, 'too-hard', FIRST + 10);
  assert.equal(feedback.value, 'too_hard');
  assert.equal((await profile.getReadingFeedbackCheckpoint(readings)).shouldRequestFeedback, false);
});

test('a calibration question is immutable evidence and cannot be counted again after a later retry', async () => {
  const storage = createMemoryStorage();
  const profile = createKnowledgeProfileRepository(storage);
  const first = await profile.recordCalibrationEvidence({
    questionId: 'calibration-v2:0:marine',
    word: 'marine',
    band: 'ngsl-2',
    correct: true,
    occurredAt: FIRST
  });
  const duplicate = await profile.recordCalibrationEvidence({
    questionId: 'calibration-v2:0:marine',
    word: 'marine',
    band: 'ngsl-2',
    correct: true,
    source: 'flashcard',
    attemptId: 'late-retry',
    occurredAt: FIRST + 2 * 24 * 60 * 60 * 1000
  });

  assert.equal(first.word.status, KnowledgeEvidenceStatus.PROVISIONAL);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.reason, 'duplicate-calibration-question');
  assert.equal(storage.snapshot().evidence.length, 1);
  assert.equal(storage.snapshot().words[0].successCount, 1);
  assert.equal(storage.snapshot().words[0].status, KnowledgeEvidenceStatus.PROVISIONAL);
});

test('reading evidence accepts the calibration engine foreground aliases and feedback aliases without changing the stored meaning', async () => {
  const reading = {
    articleId: 'article-alias',
    completed: true,
    scrollDepth: 0.7,
    activeSeconds: 60,
    wordCount: 200
  };
  assert.equal(isQualifyingReadingEvidence(reading), true);

  const storage = createMemoryStorage();
  const profile = createKnowledgeProfileRepository(storage);
  const readings = [1, 2, 3].map(index => ({ ...reading, articleId: `article-${index}` }));
  const feedback = await profile.saveDifficultyFeedback(readings, 'too_hard', FIRST);
  assert.equal(feedback.value, 'too_hard');
});

test('separate repository instances share a mutation queue so no evidence-derived mastery is lost', async () => {
  const storage = createMemoryStorage();
  const firstProfile = createKnowledgeProfileRepository(storage);
  const secondProfile = createKnowledgeProfileRepository(storage);
  await firstProfile.initialize();

  const originalGetWord = storage.getKnowledgeWord.bind(storage);
  let firstSnapshotTaken;
  const firstSnapshot = new Promise(resolve => { firstSnapshotTaken = resolve; });
  let releaseFirstSnapshot;
  const release = new Promise(resolve => { releaseFirstSnapshot = resolve; });
  let wordReads = 0;
  storage.getKnowledgeWord = async lemma => {
    const result = await originalGetWord(lemma);
    wordReads += 1;
    if (wordReads === 1) {
      firstSnapshotTaken();
      await release;
    }
    return result;
  };

  const first = firstProfile.recordEvidence({
    word: 'serial', band: 'ngsl-1', kind: 'diagnostic', correct: true,
    source: 'assessment', attemptId: 'one', occurredAt: FIRST
  });
  await firstSnapshot;
  const second = secondProfile.recordEvidence({
    word: 'serial', band: 'ngsl-1', kind: 'recall', correct: true,
    source: 'flashcard', attemptId: 'two', occurredAt: FIRST + 1
  });
  await new Promise(resolve => setTimeout(resolve, 10));
  releaseFirstSnapshot();
  await Promise.all([first, second]);

  const snapshot = storage.snapshot();
  assert.equal(snapshot.words[0].successCount, 2);
  assert.equal(snapshot.words[0].status, KnowledgeEvidenceStatus.ESTABLISHED);
  assert.equal(snapshot.evidence.length, 2);
});
