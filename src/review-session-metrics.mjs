const VALID_QUALITIES = new Set([1, 3, 5]);

function normalizeWordIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(Number)
    .filter(Number.isFinite))];
}

function normalizeAttempt(raw, fallbackSequence) {
  const attemptId = String(raw?.attemptId || raw?.id || '');
  const wordId = Number(raw?.wordId);
  const quality = Number(raw?.quality);
  if (!attemptId || !Number.isFinite(wordId) || !VALID_QUALITIES.has(quality)) return null;
  return {
    attemptId,
    wordId,
    quality,
    sequence: Math.max(0, Number(raw?.sequence) || fallbackSequence)
  };
}

function normalizedQuality(...values) {
  for (const value of values) {
    const quality = Number(value);
    if (VALID_QUALITIES.has(quality)) return quality;
  }
  return null;
}

export function mergeTodayReviewedWord(existing = null, incoming = null) {
  const prior = existing && typeof existing === 'object' ? existing : {};
  const next = incoming && typeof incoming === 'object' ? incoming : {};
  const priorWeakest = normalizedQuality(prior.weakestQuality, prior.quality);
  const nextWeakest = normalizedQuality(next.weakestQuality, next.quality);
  const weakestQuality = priorWeakest && nextWeakest
    ? Math.min(priorWeakest, nextWeakest)
    : priorWeakest || nextWeakest;
  const lastQuality = normalizedQuality(next.lastQuality, next.quality, prior.lastQuality, prior.quality);
  return {
    ...prior,
    ...next,
    ...(lastQuality ? { quality: lastQuality, lastQuality } : {}),
    ...(weakestQuality ? { weakestQuality } : {}),
    mastered: Boolean(prior.mastered || next.mastered || lastQuality === 5)
  };
}

/**
 * Tracks the user-facing result of a flashcard session independently from
 * the scheduler's exposure queue. Reinsertions therefore cannot inflate the
 * original word total or result buckets.
 */
export function createReviewSessionMetrics({ originalWordIds = [], snapshot = null } = {}) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : null;
  const ids = normalizeWordIds(source?.originalWordIds?.length ? source.originalWordIds : originalWordIds);
  const originalIds = new Set(ids);
  const attempts = new Map();
  let nextSequence = 0;

  for (const raw of source?.attempts || []) {
    const attempt = normalizeAttempt(raw, nextSequence);
    if (!attempt || !originalIds.has(attempt.wordId)) continue;
    attempts.set(attempt.attemptId, attempt);
    nextSequence = Math.max(nextSequence, attempt.sequence + 1);
  }

  function recordRating(ratingInput) {
    const { attemptId, wordId, quality } = ratingInput && typeof ratingInput === 'object' ? ratingInput : {};
    const id = Number(wordId);
    const rating = Number(quality);
    const key = String(attemptId || '');
    if (!key || !originalIds.has(id) || !VALID_QUALITIES.has(rating)) return false;
    const existing = attempts.get(key);
    // A correction belongs to the original user action. It replaces that
    // action rather than becoming a second exposure in session metrics.
    attempts.set(key, {
      attemptId: key,
      wordId: id,
      quality: rating,
      sequence: existing?.sequence ?? nextSequence++
    });
    return true;
  }

  function resultForWord(wordId) {
    const id = Number(wordId);
    if (!originalIds.has(id)) return null;
    const wordAttempts = [...attempts.values()]
      .filter(attempt => attempt.wordId === id)
      .sort((a, b) => a.sequence - b.sequence);
    if (!wordAttempts.length) return null;
    return {
      weakestQuality: Math.min(...wordAttempts.map(attempt => attempt.quality)),
      lastQuality: wordAttempts.at(-1).quality,
      mastered: wordAttempts.some(attempt => attempt.quality === 5)
    };
  }

  function summary() {
    let known = 0;
    let uncertain = 0;
    let unknown = 0;
    let mastered = 0;
    let rated = 0;
    for (const wordId of ids) {
      const result = resultForWord(wordId);
      if (!result) continue;
      rated += 1;
      if (result.mastered) mastered += 1;
      if (result.weakestQuality === 5) known += 1;
      if (result.weakestQuality === 3) uncertain += 1;
      if (result.weakestQuality === 1) unknown += 1;
    }
    const total = ids.length;
    return {
      total,
      mastered,
      masteryRate: total ? Math.round((mastered / total) * 100) : 0,
      known,
      uncertain,
      unknown,
      rated
    };
  }

  function serialize() {
    return {
      schemaVersion: 1,
      originalWordIds: [...ids],
      attempts: [...attempts.values()].sort((a, b) => a.sequence - b.sequence).map(attempt => ({ ...attempt }))
    };
  }

  return Object.freeze({
    recordRating,
    getWordResult: resultForWord,
    summary,
    snapshot: serialize
  });
}
