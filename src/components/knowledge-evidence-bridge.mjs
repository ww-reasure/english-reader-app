/**
 * Bridges explicit learning actions into the personal knowledge profile.
 *
 * This module deliberately has no dependency on legacy vocabulary, saved-word,
 * or SRS stores. Evidence is accepted only when the versioned lexicon can
 * supply an auditable frequency layer for the resolved lemma.
 */

import { createKnowledgeProfileRepository } from '../knowledge-profile.mjs';

function asNonEmptyString(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeFrequencyBand(value) {
  const normalized = asNonEmptyString(value)?.toLocaleLowerCase('en-US') || '';
  return /^[a-z0-9][a-z0-9._-]{0,99}$/u.test(normalized) ? normalized : null;
}

function frequencyLayers(entry) {
  const layer = entry?.layers?.frequency;
  return Array.isArray(layer) ? layer : layer ? [layer] : [];
}

/**
 * A dictionary gloss can be limited while its frequency membership is still
 * traceable. For frequency evidence we require a non-rejected entry and an
 * explicit frequency source that is declared by that entry.
 */
export function getTrustedFrequencyBand(entry) {
  if (!entry || entry.quality === 'rejected') return null;

  const sourceRefs = new Set(
    Array.isArray(entry.sourceRefs)
      ? entry.sourceRefs.map(value => asNonEmptyString(value)).filter(Boolean)
      : []
  );
  if (!sourceRefs.size) return null;

  for (const layer of frequencyLayers(entry)) {
    const band = normalizeFrequencyBand(layer?.band);
    const sourceRef = asNonEmptyString(layer?.sourceRef);
    if (band && sourceRef && sourceRefs.has(sourceRef)) return band;
  }
  return null;
}

function resolveProfile({ profile, storage, createProfileRepository }) {
  if (profile && typeof profile.recordEvidence === 'function') return profile;
  if (!storage) throw new TypeError('掌握证据 bridge 需要 DB 存储或知识画像仓库');
  if (typeof createProfileRepository !== 'function') {
    throw new TypeError('掌握证据 bridge 需要知识画像仓库工厂');
  }
  const repository = createProfileRepository(storage);
  if (!repository || typeof repository.recordEvidence !== 'function') {
    throw new TypeError('知识画像仓库不支持 recordEvidence');
  }
  return repository;
}

function optionalFields(input = {}) {
  const fields = {};
  for (const name of ['attemptId', 'contextId', 'articleId']) {
    const value = asNonEmptyString(input[name]);
    if (value) fields[name] = value;
  }
  return fields;
}

function getFlashcardOutcome(input = {}) {
  const quality = Number(input.quality);
  if (![1, 3, 5].includes(quality)) return null;

  const sawAnswer = Boolean(input.meaningRevealed || input.sawAnswer);
  const recalledBeforeAnswer = quality === 5 && !sawAnswer;
  return {
    kind: recalledBeforeAnswer ? 'recall' : 'review',
    correct: recalledBeforeAnswer || quality === 5,
    sawAnswer
  };
}

/**
 * Creates a failure-contained, caller-nonblocking evidence writer. Call sites
 * can safely invoke `void bridge.record...()`; failures resolve to a small
 * status object and never surface an IndexedDB or lexicon error to the UI.
 */
export function createKnowledgeEvidenceBridge({
  lexiconLoader,
  profile,
  storage,
  createProfileRepository = createKnowledgeProfileRepository,
  now = () => Date.now()
} = {}) {
  if (!lexiconLoader || typeof lexiconLoader.lookup !== 'function') {
    throw new TypeError('掌握证据 bridge 需要版本化词库加载器');
  }

  const repository = resolveProfile({ profile, storage, createProfileRepository });

  async function resolveLexiconEvidence(word) {
    const surface = asNonEmptyString(word);
    if (!surface) return { accepted: false, reason: 'invalid-word' };

    try {
      const entry = await lexiconLoader.lookup(surface);
      const lemma = asNonEmptyString(entry?.lemma)?.toLocaleLowerCase('en-US') || null;
      const band = getTrustedFrequencyBand(entry);
      if (!lemma || !band) return { accepted: false, reason: 'untrusted-frequency-layer' };
      return { accepted: true, lemma, band };
    } catch {
      return { accepted: false, reason: 'lexicon-unavailable' };
    }
  }

  async function safelyWrite(word, buildEvidence) {
    const resolved = await resolveLexiconEvidence(word);
    if (!resolved.accepted) return resolved;

    try {
      const result = await repository.recordEvidence(buildEvidence(resolved));
      return result && typeof result === 'object' ? result : { accepted: true };
    } catch {
      return { accepted: false, reason: 'evidence-write-failed' };
    }
  }

  async function recordFlashcardRating(input = {}) {
    const outcome = getFlashcardOutcome(input);
    if (!outcome) return { accepted: false, reason: 'unsupported-flashcard-rating' };

    return safelyWrite(input.word, ({ lemma, band }) => ({
      word: lemma,
      band,
      ...outcome,
      source: asNonEmptyString(input.source) || 'flashcard-review',
      ...optionalFields(input),
      occurredAt: Number.isFinite(Number(input.occurredAt)) ? Number(input.occurredAt) : now()
    }));
  }

  async function recordLookup(input = {}) {
    return safelyWrite(input.word, ({ lemma, band }) => ({
      word: lemma,
      band,
      kind: 'lookup',
      source: asNonEmptyString(input.source) || 'word-lookup',
      ...optionalFields(input),
      occurredAt: Number.isFinite(Number(input.occurredAt)) ? Number(input.occurredAt) : now()
    }));
  }

  async function recordQualifiedReadingObservation(input = {}) {
    if (typeof repository.recordQualifiedReadingObservation !== 'function') {
      return { accepted: false, reason: 'reading-observation-unavailable' };
    }
    try {
      const result = await repository.recordQualifiedReadingObservation(input);
      return result && typeof result === 'object' ? result : { accepted: true };
    } catch {
      return { accepted: false, reason: 'reading-observation-write-failed' };
    }
  }

  return {
    recordFlashcardRating,
    recordFlashcardRatingNonBlocking: recordFlashcardRating,
    recordLookup,
    recordLookupNonBlocking: recordLookup,
    recordQualifiedReadingObservation,
    recordQualifiedReadingObservationNonBlocking: recordQualifiedReadingObservation
  };
}
