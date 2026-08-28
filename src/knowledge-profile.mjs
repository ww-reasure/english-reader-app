/**
 * Personal knowledge evidence is intentionally separate from saved vocabulary
 * and SRS cards. A word can be observed without making a mastery claim.
 */

import {
  CALIBRATION_WORD_QUESTION_COUNT,
  isQualifiedReading,
  minimumActiveReadingSeconds
} from './calibration-engine.mjs';

export const KNOWLEDGE_PROFILE_SCHEMA_VERSION = 3;
export const CALIBRATION_DIAGNOSTIC_QUESTION_COUNT = CALIBRATION_WORD_QUESTION_COUNT;
export const CALIBRATION_QUALIFIED_READING_TARGET = 3;
export const MIN_QUALIFIED_READING_SECONDS = minimumActiveReadingSeconds(0);
export const READING_WORDS_PER_MINUTE_BASELINE = 400;
export const MIN_INDEPENDENT_EVIDENCE_GAP_MS = 24 * 60 * 60 * 1000;

export const KnowledgeEvidenceStatus = Object.freeze({
  OBSERVABLE: 'observable',
  PROVISIONAL: 'provisional',
  ESTABLISHED: 'established'
});

export const DifficultyFeedbackOptions = Object.freeze([
  'too_hard',
  'fitting',
  'too_easy'
]);

const DIFFICULTY_FEEDBACK_ALIASES = new Map([
  ['too-hard', 'too_hard'],
  ['too_hard', 'too_hard'],
  ['appropriate', 'fitting'],
  ['fitting', 'fitting'],
  ['too-easy', 'too_easy'],
  ['too_easy', 'too_easy']
]);

const DIRECT_EVIDENCE_KINDS = new Set(['diagnostic', 'recall', 'review']);
const ALLOWED_EVIDENCE_KINDS = new Set([...DIRECT_EVIDENCE_KINDS, 'lookup', 'context']);
const WORD_STATUSES = new Set(Object.values(KnowledgeEvidenceStatus));
const storageMutationTails = new WeakMap();

const asNonNegativeInteger = value => Math.max(0, Math.trunc(Number(value) || 0));
const asFiniteTimestamp = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const normalizeOptionalString = value => String(value || '').trim();

function normalizeWord(value) {
  const word = normalizeOptionalString(value).toLocaleLowerCase('en-US');
  if (!word || word.length > 100) throw new TypeError('需要有效的英文词元');
  return word;
}

function normalizeBand(value) {
  const band = normalizeOptionalString(value).toLocaleLowerCase('en-US');
  if (!band || band.length > 100) throw new TypeError('需要有效的词汇频率层');
  return band;
}

function normalizeIdentifier(value) {
  const normalized = normalizeOptionalString(value);
  return normalized.slice(0, 160);
}

function normalizeStatus(value) {
  return WORD_STATUSES.has(value) ? value : KnowledgeEvidenceStatus.OBSERVABLE;
}

function emptyWordProfile(lemma, now) {
  return {
    lemma,
    status: KnowledgeEvidenceStatus.OBSERVABLE,
    successCount: 0,
    independentSuccessCount: 0,
    failureCount: 0,
    independentFailureCount: 0,
    observedReadingCount: 0,
    contextKnownCount: 0,
    assistedContextKnownCount: 0,
    contextUncertainCount: 0,
    contextFailureCount: 0,
    lastSuccessfulAt: null,
    lastSuccessfulSource: '',
    lastSuccessfulAttemptId: '',
    lastSuccessfulContextKey: '',
    lastFailureAt: null,
    lastFailureSource: '',
    lastFailureAttemptId: '',
    lastFailureContextKey: '',
    lastIndependentEvidenceAt: null,
    lastIndependentEvidenceSource: '',
    lastIndependentEvidenceAttemptId: '',
    lastIndependentEvidenceContextKey: '',
    lastEvidenceAt: null,
    createdAt: now,
    updatedAt: now,
    schemaVersion: KNOWLEDGE_PROFILE_SCHEMA_VERSION
  };
}

function emptyBandProfile(band, now) {
  return withBandEstimate({
    band,
    successCount: 0,
    independentSuccessCount: 0,
    failureCount: 0,
    independentFailureCount: 0,
    observedReadingCount: 0,
    contextKnownCount: 0,
    assistedContextKnownCount: 0,
    contextUncertainCount: 0,
    contextFailureCount: 0,
    createdAt: now,
    updatedAt: now,
    schemaVersion: KNOWLEDGE_PROFILE_SCHEMA_VERSION
  });
}

function normalizeWordProfile(value, lemma, now) {
  const existing = value && typeof value === 'object' ? value : {};
  const successCount = asNonNegativeInteger(existing.successCount);
  const failureCount = asNonNegativeInteger(existing.failureCount);
  return {
    ...emptyWordProfile(lemma, now),
    ...existing,
    lemma,
    status: normalizeStatus(existing.status),
    successCount,
    independentSuccessCount: Math.min(successCount, asNonNegativeInteger(existing.independentSuccessCount)),
    failureCount,
    independentFailureCount: Math.min(failureCount, asNonNegativeInteger(existing.independentFailureCount)),
    observedReadingCount: asNonNegativeInteger(existing.observedReadingCount),
    contextKnownCount: asNonNegativeInteger(existing.contextKnownCount),
    assistedContextKnownCount: asNonNegativeInteger(existing.assistedContextKnownCount),
    contextUncertainCount: asNonNegativeInteger(existing.contextUncertainCount),
    contextFailureCount: asNonNegativeInteger(existing.contextFailureCount),
    lastSuccessfulAt: Number.isFinite(Number(existing.lastSuccessfulAt)) ? Number(existing.lastSuccessfulAt) : null,
    lastSuccessfulSource: normalizeIdentifier(existing.lastSuccessfulSource),
    lastSuccessfulAttemptId: normalizeIdentifier(existing.lastSuccessfulAttemptId),
    lastSuccessfulContextKey: normalizeIdentifier(existing.lastSuccessfulContextKey),
    lastFailureAt: Number.isFinite(Number(existing.lastFailureAt)) ? Number(existing.lastFailureAt) : null,
    lastFailureSource: normalizeIdentifier(existing.lastFailureSource),
    lastFailureAttemptId: normalizeIdentifier(existing.lastFailureAttemptId),
    lastFailureContextKey: normalizeIdentifier(existing.lastFailureContextKey),
    lastIndependentEvidenceAt: Number.isFinite(Number(existing.lastIndependentEvidenceAt))
      ? Number(existing.lastIndependentEvidenceAt)
      : null,
    lastIndependentEvidenceSource: normalizeIdentifier(existing.lastIndependentEvidenceSource),
    lastIndependentEvidenceAttemptId: normalizeIdentifier(existing.lastIndependentEvidenceAttemptId),
    lastIndependentEvidenceContextKey: normalizeIdentifier(existing.lastIndependentEvidenceContextKey),
    lastEvidenceAt: Number.isFinite(Number(existing.lastEvidenceAt)) ? Number(existing.lastEvidenceAt) : null,
    createdAt: asFiniteTimestamp(existing.createdAt, now),
    updatedAt: asFiniteTimestamp(existing.updatedAt, now),
    schemaVersion: KNOWLEDGE_PROFILE_SCHEMA_VERSION
  };
}

function normalizeBandProfile(value, band, now) {
  const existing = value && typeof value === 'object' ? value : {};
  const successCount = asNonNegativeInteger(existing.successCount);
  const failureCount = asNonNegativeInteger(existing.failureCount);
  return withBandEstimate({
    ...emptyBandProfile(band, now),
    ...existing,
    band,
    successCount,
    independentSuccessCount: Math.min(successCount, asNonNegativeInteger(existing.independentSuccessCount)),
    failureCount,
    independentFailureCount: Math.min(failureCount, asNonNegativeInteger(existing.independentFailureCount)),
    observedReadingCount: asNonNegativeInteger(existing.observedReadingCount),
    contextKnownCount: asNonNegativeInteger(existing.contextKnownCount),
    assistedContextKnownCount: asNonNegativeInteger(existing.assistedContextKnownCount),
    contextUncertainCount: asNonNegativeInteger(existing.contextUncertainCount),
    contextFailureCount: asNonNegativeInteger(existing.contextFailureCount),
    createdAt: asFiniteTimestamp(existing.createdAt, now),
    updatedAt: asFiniteTimestamp(existing.updatedAt, now),
    schemaVersion: KNOWLEDGE_PROFILE_SCHEMA_VERSION
  });
}

/**
 * Beta(1, 1) posterior for direct evidence only. Reading exposure deliberately
 * affects neither mastery probability nor confidence.
 */
export function withBandEstimate(bandProfile) {
  const successCount = asNonNegativeInteger(bandProfile.successCount);
  const failureCount = asNonNegativeInteger(bandProfile.failureCount);
  const independentSuccessCount = Math.min(successCount, asNonNegativeInteger(bandProfile.independentSuccessCount));
  const independentFailureCount = Math.min(failureCount, asNonNegativeInteger(bandProfile.independentFailureCount));
  const directEvidenceCount = successCount + failureCount;
  const independentDirectEvidenceCount = independentSuccessCount + independentFailureCount;

  return {
    ...bandProfile,
    successCount,
    independentSuccessCount,
    failureCount,
    independentFailureCount,
    observedReadingCount: asNonNegativeInteger(bandProfile.observedReadingCount),
    contextKnownCount: asNonNegativeInteger(bandProfile.contextKnownCount),
    assistedContextKnownCount: asNonNegativeInteger(bandProfile.assistedContextKnownCount),
    contextUncertainCount: asNonNegativeInteger(bandProfile.contextUncertainCount),
    contextFailureCount: asNonNegativeInteger(bandProfile.contextFailureCount),
    directEvidenceCount,
    masteryProbability: directEvidenceCount ? (successCount + 1) / (directEvidenceCount + 2) : null,
    confidence: directEvidenceCount / (directEvidenceCount + 6),
    independentDirectEvidenceCount,
    independentMasteryProbability: independentDirectEvidenceCount
      ? (independentSuccessCount + 1) / (independentDirectEvidenceCount + 2)
      : null,
    independentConfidence: independentDirectEvidenceCount / (independentDirectEvidenceCount + 6)
  };
}

function getEvidenceContextKey(evidence) {
  if (evidence.contextId) return normalizeIdentifier(`context:${evidence.contextId}`);
  if (evidence.questionId) return normalizeIdentifier(`question:${evidence.questionId}`);
  if (evidence.articleId) return normalizeIdentifier(`article:${evidence.articleId}`);
  return '';
}

function isIndependentFromPrevious(evidence, {
  at,
  source,
  contextKey
}) {
  if (evidence.independent === true) return true;

  const hasPreviousTimestamp = at !== null && at !== '' && Number.isFinite(Number(at));
  if (hasPreviousTimestamp) {
    const elapsed = evidence.occurredAt - Number(at);
    if (elapsed >= MIN_INDEPENDENT_EVIDENCE_GAP_MS) return true;
  }

  const currentContextKey = getEvidenceContextKey(evidence);
  if (currentContextKey && contextKey) return currentContextKey !== contextKey;
  if (currentContextKey || contextKey) return false;

  // When a caller cannot provide a durable context id, a different evidence
  // source is the only conservative cross-context signal we retain. A new
  // attempt id alone deliberately never makes a short retry independent.
  return Boolean(evidence.source && source && evidence.source !== source);
}

function isIndependentDirectEvidence(word, evidence) {
  if (word.independentSuccessCount + word.independentFailureCount === 0) return true;
  return isIndependentFromPrevious(evidence, {
    at: word.lastIndependentEvidenceAt ?? word.lastSuccessfulAt ?? word.lastFailureAt,
    source: word.lastIndependentEvidenceSource || word.lastSuccessfulSource || word.lastFailureSource,
    contextKey: word.lastIndependentEvidenceContextKey || word.lastSuccessfulContextKey || word.lastFailureContextKey
  });
}

function storeIndependentEvidenceContext(word, evidence) {
  word.lastIndependentEvidenceAt = evidence.occurredAt;
  word.lastIndependentEvidenceSource = evidence.source;
  word.lastIndependentEvidenceAttemptId = evidence.attemptId;
  word.lastIndependentEvidenceContextKey = getEvidenceContextKey(evidence);
}

function normalizeEvidence(input, now) {
  const kind = normalizeOptionalString(input?.kind).toLocaleLowerCase('en-US');
  if (!ALLOWED_EVIDENCE_KINDS.has(kind)) {
    throw new TypeError('不支持的掌握证据类型');
  }

  const directEvidence = DIRECT_EVIDENCE_KINDS.has(kind);
  if (directEvidence && typeof input.correct !== 'boolean') {
    throw new TypeError('直接答题证据必须明确标记正误');
  }

  const sawAnswer = Boolean(input.sawAnswer);
  const contextResult = kind === 'context' ? normalizeOptionalString(input.contextResult).toLocaleLowerCase('en-US') : '';
  if (kind === 'context' && !['known', 'uncertain', 'unknown'].includes(contextResult)) {
    throw new TypeError('语境掌握证据需要有效结果');
  }
  const outcome = kind === 'context'
    ? contextResult === 'unknown' ? 'negative' : contextResult === 'known' ? 'context-success' : 'context-uncertain'
    : kind === 'lookup' || sawAnswer || input.correct === false ? 'negative' : 'success';

  const calibrationKey = normalizeIdentifier(input.calibrationKey);
  const evidence = {
    lemma: normalizeWord(input.word),
    band: normalizeBand(input.band),
    kind,
    outcome,
    correct: directEvidence ? Boolean(input.correct) : null,
    sawAnswer,
    contextResult,
    assistedLookupCount: kind === 'context' ? asNonNegativeInteger(input.assistedLookupCount) : 0,
    source: normalizeIdentifier(input.source) || kind,
    attemptId: normalizeIdentifier(input.attemptId),
    contextId: normalizeIdentifier(input.contextId),
    questionId: normalizeIdentifier(input.questionId),
    articleId: normalizeIdentifier(input.articleId),
    independent: input.independent === true,
    occurredAt: asFiniteTimestamp(input.occurredAt, now),
    schemaVersion: KNOWLEDGE_PROFILE_SCHEMA_VERSION
  };
  if (calibrationKey) evidence.calibrationKey = calibrationKey;
  return evidence;
}

function applyContextEvidence(word, band, evidence) {
  if (evidence.contextResult === 'unknown') {
    const failed = applyDirectEvidence(word, band, { ...evidence, outcome: 'negative', correct: false });
    return {
      word: { ...failed.word, contextFailureCount: failed.word.contextFailureCount + 1 },
      band: withBandEstimate({ ...failed.band, contextFailureCount: failed.band.contextFailureCount + 1 })
    };
  }

  const assisted = evidence.assistedLookupCount > 0;
  const wordField = evidence.contextResult === 'known'
    ? assisted ? 'assistedContextKnownCount' : 'contextKnownCount'
    : 'contextUncertainCount';
  const nextWord = {
    ...word,
    [wordField]: word[wordField] + 1,
    lastEvidenceAt: evidence.occurredAt,
    updatedAt: evidence.occurredAt
  };
  const nextBand = withBandEstimate({
    ...band,
    [wordField]: band[wordField] + 1,
    updatedAt: evidence.occurredAt
  });
  return { word: nextWord, band: nextBand };
}

function applyDirectEvidence(word, band, evidence) {
  const nextWord = { ...word };
  const nextBand = { ...band };

  if (evidence.outcome === 'success') {
    const independent = isIndependentDirectEvidence(nextWord, evidence);
    nextWord.successCount += 1;
    if (independent) {
      nextWord.independentSuccessCount += 1;
      storeIndependentEvidenceContext(nextWord, evidence);
    }
    nextWord.status = nextWord.independentSuccessCount >= 2
      ? KnowledgeEvidenceStatus.ESTABLISHED
      : KnowledgeEvidenceStatus.PROVISIONAL;
    nextWord.lastSuccessfulAt = evidence.occurredAt;
    nextWord.lastSuccessfulSource = evidence.source;
    nextWord.lastSuccessfulAttemptId = evidence.attemptId;
    nextWord.lastSuccessfulContextKey = getEvidenceContextKey(evidence);
    nextBand.successCount += 1;
    if (independent) nextBand.independentSuccessCount += 1;
  } else {
    const independent = isIndependentDirectEvidence(nextWord, evidence);
    nextWord.failureCount += 1;
    if (independent) {
      nextWord.independentFailureCount += 1;
      storeIndependentEvidenceContext(nextWord, evidence);
    }
    nextBand.failureCount += 1;
    if (independent) nextBand.independentFailureCount += 1;
    if (nextWord.status === KnowledgeEvidenceStatus.ESTABLISHED) {
      nextWord.status = KnowledgeEvidenceStatus.PROVISIONAL;
      nextWord.independentSuccessCount = 1;
    } else {
      nextWord.status = KnowledgeEvidenceStatus.OBSERVABLE;
      nextWord.independentSuccessCount = 0;
    }
    nextWord.lastFailureAt = evidence.occurredAt;
    nextWord.lastFailureSource = evidence.source;
    nextWord.lastFailureAttemptId = evidence.attemptId;
    nextWord.lastFailureContextKey = getEvidenceContextKey(evidence);
  }

  nextWord.lastEvidenceAt = evidence.occurredAt;
  nextWord.updatedAt = evidence.occurredAt;
  nextBand.updatedAt = evidence.occurredAt;
  return { word: nextWord, band: withBandEstimate(nextBand) };
}

function applyReadingEvidence(word, band, evidence) {
  const nextWord = {
    ...word,
    observedReadingCount: word.observedReadingCount + 1,
    lastEvidenceAt: evidence.occurredAt,
    updatedAt: evidence.occurredAt
  };
  const nextBand = withBandEstimate({
    ...band,
    observedReadingCount: band.observedReadingCount + 1,
    updatedAt: evidence.occurredAt
  });
  return { word: nextWord, band: nextBand };
}

/**
 * Reading becomes observable evidence only after an intentional, foreground
 * reading session. Callers must pass foregroundSeconds, not wall-clock time.
 */
export function isQualifyingReadingEvidence(reading = {}) {
  const wordCount = Number(reading.wordCount);
  // `activeSeconds` / `scrollDepth` are the calibration engine names. Both
  // aliases mean foreground-only time and visible body progress respectively.
  const foregroundSeconds = Number(reading.foregroundSeconds ?? reading.activeSeconds);
  const visibleRatio = Number(reading.visibleRatio ?? reading.scrollDepth);

  return Number.isFinite(wordCount) && wordCount > 0 && isQualifiedReading({
    completed: reading.completed,
    scrollDepth: visibleRatio,
    activeSeconds: foregroundSeconds,
    wordCount
  });
}

export function buildCalibrationProgress(responses = []) {
  const uniqueResponses = new Map();
  for (const response of responses) {
    const questionId = normalizeIdentifier(response?.questionId);
    if (!questionId || uniqueResponses.has(questionId)) continue;
    uniqueResponses.set(questionId, response);
  }

  const accepted = [...uniqueResponses.values()];
  const correctCount = accepted.filter(response => response?.correct === true && !response?.sawAnswer).length;
  const answerRevealedCount = accepted.filter(response => response?.sawAnswer === true).length;

  return {
    completedQuestionCount: accepted.length,
    correctCount,
    answerRevealedCount,
    remainingQuestionCount: Math.max(0, CALIBRATION_DIAGNOSTIC_QUESTION_COUNT - accepted.length),
    isComplete: accepted.length >= CALIBRATION_DIAGNOSTIC_QUESTION_COUNT
  };
}

export function buildReadingFeedbackCheckpoint(readings = [], feedback = null) {
  const articleIds = new Set();
  for (const reading of readings) {
    const articleId = normalizeIdentifier(reading?.articleId);
    if (articleId && isQualifyingReadingEvidence(reading)) articleIds.add(articleId);
  }
  return buildReadingFeedbackCheckpointFromArticleIds(articleIds, feedback);
}

function buildReadingFeedbackCheckpointFromArticleIds(articleIds, feedback = null) {
  const qualifiedArticleIds = [...new Set([...articleIds]
    .map(normalizeIdentifier)
    .filter(Boolean))];
  const hasFeedback = Boolean(normalizeDifficultyFeedbackOption(feedback?.value));

  return {
    qualifiedReadingCount: qualifiedArticleIds.length,
    qualifiedArticleIds,
    shouldRequestFeedback: qualifiedArticleIds.length >= CALIBRATION_QUALIFIED_READING_TARGET && !hasFeedback,
    options: [...DifficultyFeedbackOptions]
  };
}

export function normalizeDifficultyFeedbackOption(value) {
  return DIFFICULTY_FEEDBACK_ALIASES.get(normalizeOptionalString(value).toLocaleLowerCase('en-US')) || null;
}

function requireStorage(storage) {
  const requiredMethods = [
    'getKnowledgeWord',
    'getKnowledgeBand',
    'getKnowledgeProfileMeta',
    'getKnowledgeEvidenceByCalibrationKey',
    'saveKnowledgeProfileMeta',
    'saveKnowledgeProfileUpdate'
  ];
  if (!storage || requiredMethods.some(method => typeof storage[method] !== 'function')) {
    throw new TypeError('知识画像存储接口不完整');
  }
  return storage;
}

/**
 * Adapter around IndexedDB helpers. It intentionally never imports legacy
 * learnWords/vocabulary data: saved cards are study intent, not proof of mastery.
 */
export function createKnowledgeProfileRepository(storage, { now = () => Date.now() } = {}) {
  const persistence = requireStorage(storage);
  const schemaKey = 'knowledge-profile-schema';
  const feedbackKey = 'knowledge-profile-reading-feedback';
  const qualifiedReadingsKey = 'knowledge-profile-qualified-readings';

  // Repositories are intentionally cheap adapters. The queue must be keyed by
  // storage, not adapter instance, because views can create a new repository
  // per action while still sharing the same IndexedDB-backed DB object.
  function serializeMutation(operation) {
    const previous = storageMutationTails.get(persistence) || Promise.resolve();
    const current = previous.then(operation, operation);
    storageMutationTails.set(persistence, current.catch(() => undefined));
    return current;
  }

  async function initialize() {
    const existing = await persistence.getKnowledgeProfileMeta(schemaKey);
    if (existing?.schemaVersion === KNOWLEDGE_PROFILE_SCHEMA_VERSION && existing.legacyLearnWordsImported === false) {
      return existing;
    }
    const migration = {
      key: schemaKey,
      schemaVersion: KNOWLEDGE_PROFILE_SCHEMA_VERSION,
      migratedAt: asFiniteTimestamp(existing?.migratedAt, now()),
      legacyLearnWordsImported: false
    };
    await persistence.saveKnowledgeProfileMeta(migration);
    return migration;
  }

  async function recordEvidenceMutation(input) {
    await initialize();
    const evidence = normalizeEvidence(input, now());
    const [storedWord, storedBand] = await Promise.all([
      persistence.getKnowledgeWord(evidence.lemma),
      persistence.getKnowledgeBand(evidence.band)
    ]);
    const word = normalizeWordProfile(storedWord, evidence.lemma, evidence.occurredAt);
    const band = normalizeBandProfile(storedBand, evidence.band, evidence.occurredAt);
    const update = evidence.kind === 'context'
      ? applyContextEvidence(word, band, evidence)
      : applyDirectEvidence(word, band, evidence);
    return persistence.saveKnowledgeProfileUpdate({ ...update, evidence });
  }

  function recordEvidence(input) {
    return serializeMutation(() => recordEvidenceMutation(input));
  }

  function recordCalibrationEvidence(input) {
    if (!normalizeIdentifier(input?.questionId)) {
      return Promise.reject(new TypeError('校准证据需要题目编号'));
    }
    const calibrationKey = normalizeIdentifier(input.questionId);
    const duplicateResult = evidence => ({
      accepted: false,
      reason: 'duplicate-calibration-question',
      evidence
    });

    return serializeMutation(async () => {
      await initialize();
      const existing = await persistence.getKnowledgeEvidenceByCalibrationKey(calibrationKey);
      if (existing) return duplicateResult(existing);
      try {
        return await recordEvidenceMutation({
          ...input,
          kind: 'diagnostic',
          source: input.source || 'initial-calibration',
          attemptId: input.attemptId || `calibration:${calibrationKey}`,
          calibrationKey
        });
      } catch (error) {
        // A distinct repository/storage adapter can race this read. The DB
        // unique index is authoritative; turn that conflict into idempotency.
        const persisted = await persistence.getKnowledgeEvidenceByCalibrationKey(calibrationKey);
        if (persisted) return duplicateResult(persisted);
        throw error;
      }
    });
  }

  function recordReadingEvidence(input) {
    if (!isQualifyingReadingEvidence(input)) {
      return Promise.resolve({ accepted: false, reason: 'insufficient-reading-quality' });
    }

    return serializeMutation(async () => {
      await initialize();
      const occurredAt = asFiniteTimestamp(input.occurredAt, now());
      const evidence = {
        lemma: normalizeWord(input.word),
        band: normalizeBand(input.band),
        kind: 'reading',
        outcome: 'observable',
        correct: null,
        sawAnswer: false,
        source: normalizeIdentifier(input.source) || 'reading',
        attemptId: normalizeIdentifier(input.attemptId),
        contextId: normalizeIdentifier(input.contextId),
        questionId: '',
        articleId: normalizeIdentifier(input.articleId),
        independent: false,
        occurredAt,
        schemaVersion: KNOWLEDGE_PROFILE_SCHEMA_VERSION
      };
      const [storedWord, storedBand] = await Promise.all([
        persistence.getKnowledgeWord(evidence.lemma),
        persistence.getKnowledgeBand(evidence.band)
      ]);
      const word = normalizeWordProfile(storedWord, evidence.lemma, occurredAt);
      const band = normalizeBandProfile(storedBand, evidence.band, occurredAt);
      const update = applyReadingEvidence(word, band, evidence);
      const saved = await persistence.saveKnowledgeProfileUpdate({ ...update, evidence });
      return { accepted: true, ...saved };
    });
  }

  async function getReadingFeedbackCheckpoint(readings) {
    const feedback = await persistence.getKnowledgeProfileMeta(feedbackKey);
    return buildReadingFeedbackCheckpoint(readings, feedback);
  }

  function normalizeQualifiedReadingSummary(value) {
    const existing = value && typeof value === 'object' ? value : {};
    const articleIds = Array.isArray(existing.articleIds) ? existing.articleIds : [];
    return {
      key: qualifiedReadingsKey,
      articleIds: [...new Set(articleIds.map(normalizeIdentifier).filter(Boolean))],
      firstObservedAt: Number.isFinite(Number(existing.firstObservedAt)) ? Number(existing.firstObservedAt) : null,
      lastObservedAt: Number.isFinite(Number(existing.lastObservedAt)) ? Number(existing.lastObservedAt) : null,
      schemaVersion: KNOWLEDGE_PROFILE_SCHEMA_VERSION
    };
  }

  /**
   * Stores a de-duplicated article-level observation for the first-three-read
   * calibration feedback loop. It is deliberately not word evidence: reading
   * an article must never mutate a word or frequency-band mastery estimate.
   */
  function recordQualifiedReadingObservation(input) {
    if (!isQualifyingReadingEvidence(input)) {
      return Promise.resolve({ accepted: false, reason: 'insufficient-reading-quality' });
    }
    const articleId = normalizeIdentifier(input?.articleId);
    if (!articleId) {
      return Promise.resolve({ accepted: false, reason: 'invalid-article-id' });
    }

    return serializeMutation(async () => {
      await initialize();
      const occurredAt = asFiniteTimestamp(input?.occurredAt, now());
      const summary = normalizeQualifiedReadingSummary(
        await persistence.getKnowledgeProfileMeta(qualifiedReadingsKey)
      );
      const checkpoint = buildReadingFeedbackCheckpointFromArticleIds(summary.articleIds, await persistence.getKnowledgeProfileMeta(feedbackKey));
      if (summary.articleIds.includes(articleId)) {
        return {
          accepted: false,
          reason: 'duplicate-qualified-reading',
          observation: summary,
          checkpoint
        };
      }

      const observation = {
        ...summary,
        articleIds: [...summary.articleIds, articleId],
        firstObservedAt: summary.firstObservedAt ?? occurredAt,
        lastObservedAt: occurredAt,
        schemaVersion: KNOWLEDGE_PROFILE_SCHEMA_VERSION
      };
      await persistence.saveKnowledgeProfileMeta(observation);
      return {
        accepted: true,
        observation,
        checkpoint: buildReadingFeedbackCheckpointFromArticleIds(
          observation.articleIds,
          await persistence.getKnowledgeProfileMeta(feedbackKey)
        )
      };
    });
  }

  async function getQualifiedReadingObservationCheckpoint() {
    const [summary, feedback] = await Promise.all([
      persistence.getKnowledgeProfileMeta(qualifiedReadingsKey),
      persistence.getKnowledgeProfileMeta(feedbackKey)
    ]);
    return buildReadingFeedbackCheckpointFromArticleIds(
      normalizeQualifiedReadingSummary(summary).articleIds,
      feedback
    );
  }

  /**
   * The skipped-calibration feedback loop must use only the article-level
   * observations written after an intentional, qualified reading.  It cannot
   * be reconstructed from legacy reading stats, which may be incomplete or
   * lack foreground-time evidence.
   */
  function saveQualifiedReadingDifficultyFeedback(value, occurredAt = now()) {
    return serializeMutation(async () => {
      await initialize();
      const checkpoint = await getQualifiedReadingObservationCheckpoint();
      if (checkpoint.qualifiedReadingCount < CALIBRATION_QUALIFIED_READING_TARGET) {
        throw new RangeError('有效阅读不足，暂不应收集难度反馈');
      }
      const normalizedValue = normalizeDifficultyFeedbackOption(value);
      if (!normalizedValue) {
        throw new TypeError('不支持的难度反馈');
      }
      const feedback = {
        key: feedbackKey,
        value: normalizedValue,
        qualifiedArticleIds: checkpoint.qualifiedArticleIds,
        submittedAt: asFiniteTimestamp(occurredAt, now()),
        schemaVersion: KNOWLEDGE_PROFILE_SCHEMA_VERSION
      };
      await persistence.saveKnowledgeProfileMeta(feedback);
      return feedback;
    });
  }

  /**
   * Read-only access for article matching. Missing evidence stays `null` so a
   * caller can distinguish “not observed yet” from a weak estimate; it must
   * never be replaced with saved-word or favourite data.
   */
  async function getBandProfile(band) {
    const normalizedBand = normalizeBand(band);
    const stored = await persistence.getKnowledgeBand(normalizedBand);
    return stored ? normalizeBandProfile(stored, normalizedBand, now()) : null;
  }

  async function getBandProfiles(bands = []) {
    const result = new Map();
    for (const band of new Set(Array.isArray(bands) ? bands : [])) {
      const normalizedBand = normalizeBand(band);
      result.set(normalizedBand, await getBandProfile(normalizedBand));
    }
    return result;
  }

  /**
   * Return only the bounded, aggregate inputs needed by learner-facing
   * projections. Raw word evidence and individual lemmas stay inside this
   * repository and are never exposed to an Agent tool.
   */
  async function getSummary() {
    const [storedBands, feedback, qualifiedReadings] = await Promise.all([
      typeof persistence.getAllKnowledgeBands === 'function'
        ? persistence.getAllKnowledgeBands()
        : [],
      persistence.getKnowledgeProfileMeta(feedbackKey),
      persistence.getKnowledgeProfileMeta(qualifiedReadingsKey)
    ]);
    const bands = (Array.isArray(storedBands) ? storedBands : [])
      .map(value => {
        try {
          return normalizeBandProfile(value, normalizeBand(value?.band), now());
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .slice(0, 12);
    const qualifiedReadingCount = Math.min(100, new Set([
      ...(Array.isArray(qualifiedReadings?.articleIds) ? qualifiedReadings.articleIds : []),
      ...(Array.isArray(feedback?.qualifiedArticleIds) ? feedback.qualifiedArticleIds : [])
    ].map(normalizeIdentifier).filter(Boolean)).size);

    return {
      status: 'available',
      bands,
      difficultyFeedback: feedback && normalizeDifficultyFeedbackOption(feedback.value)
        ? {
          value: normalizeDifficultyFeedbackOption(feedback.value),
          qualifiedReadingCount,
          submittedAt: asFiniteTimestamp(feedback.submittedAt, null)
        }
        : null
    };
  }

  function saveDifficultyFeedback(readings, value, occurredAt = now()) {
    return serializeMutation(async () => {
      const checkpoint = await getReadingFeedbackCheckpoint(readings);
      if (checkpoint.qualifiedReadingCount < CALIBRATION_QUALIFIED_READING_TARGET) {
        throw new RangeError('有效阅读不足，暂不应收集难度反馈');
      }
      const normalizedValue = normalizeDifficultyFeedbackOption(value);
      if (!normalizedValue) {
        throw new TypeError('不支持的难度反馈');
      }
      const feedback = {
        key: feedbackKey,
        value: normalizedValue,
        qualifiedArticleIds: checkpoint.qualifiedArticleIds,
        submittedAt: asFiniteTimestamp(occurredAt, now()),
        schemaVersion: KNOWLEDGE_PROFILE_SCHEMA_VERSION
      };
      await persistence.saveKnowledgeProfileMeta(feedback);
      return feedback;
    });
  }

  return {
    initialize,
    recordEvidence,
    recordCalibrationEvidence,
    recordReadingEvidence,
    getBandProfile,
    getBandProfiles,
    getSummary,
    getReadingFeedbackCheckpoint,
    recordQualifiedReadingObservation,
    getQualifiedReadingObservationCheckpoint,
    saveQualifiedReadingDifficultyFeedback,
    saveDifficultyFeedback
  };
}
