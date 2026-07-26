const asNumber = value => Number.isFinite(Number(value)) ? Number(value) : 0;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * A transparent reading-performance summary. It deliberately does not infer a
 * vocabulary population from lookup behaviour or self-report.
 */
export function buildReadingProfile(attempts = []) {
  const valid = attempts.filter(attempt => asNumber(attempt.wordCount) > 0);
  const wordCount = valid.reduce((sum, attempt) => sum + asNumber(attempt.wordCount), 0);
  const elapsedSeconds = valid.reduce((sum, attempt) => sum + asNumber(attempt.elapsedSeconds), 0);
  const comprehensionCorrect = valid.reduce((sum, attempt) => sum + asNumber(attempt.comprehensionCorrect), 0);
  const comprehensionTotal = valid.reduce((sum, attempt) => sum + asNumber(attempt.comprehensionTotal), 0);
  const explicitLookups = valid.reduce((sum, attempt) => sum + asNumber(attempt.explicitLookups), 0);
  const averageConfidence = valid.length
    ? Math.round((valid.reduce((sum, attempt) => sum + clamp(asNumber(attempt.confidence), 1, 5), 0) / valid.length) * 10) / 10
    : 0;
  const averageWpm = elapsedSeconds ? Math.round(wordCount / (elapsedSeconds / 60)) : 0;
  const comprehensionAccuracy = comprehensionTotal ? Math.round((comprehensionCorrect / comprehensionTotal) * 100) : null;
  const lookupRate = wordCount ? Math.round((explicitLookups / wordCount) * 1000) / 10 : 0;

  const recommendedTrack = comprehensionAccuracy === null
    ? 'cet4'
    : comprehensionAccuracy >= 80 && lookupRate <= 18 ? 'cet6'
      : comprehensionAccuracy >= 65 ? 'cet4'
        : 'support';

  return {
    attempts: valid.length,
    wordCount,
    averageWpm,
    comprehensionAccuracy,
    explicitLookups,
    lookupRate,
    averageConfidence,
    recommendedTrack
  };
}
