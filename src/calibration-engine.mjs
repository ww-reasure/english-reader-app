/** Pure calibration and qualified-reading rules.  UI and IndexedDB persistence
 * deliberately stay outside this module so the evidence rules are testable. */
export const CALIBRATION_WORD_QUESTION_COUNT = 24;
export const CALIBRATION_READING_MINIMUM = Object.freeze({ correct: 2, total: 3 });
// A tier needs enough independently reviewed options to support its first
// anchor plus later adaptive follow-ups.  Sparse tiers are still usable as
// conservative fallback questions, but never presented as a complete
// stratified baseline.
export const CALIBRATION_MIN_ITEMS_PER_FREQUENCY_TIER = 6;
export const CALIBRATION_FREQUENCY_TIERS = Object.freeze([1, 2, 3, 4, 5, 6]);

const MODE_ORDER = Object.freeze(['support', 'standard', 'stretch']);
const canonical = value => String(value || '').trim().toLowerCase();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const normalizeBank = bank => {
  const seen = new Set();
  return (Array.isArray(bank) ? bank : [])
    .map(entry => ({
      lemma: canonical(entry?.lemma),
      gloss: String(entry?.gloss || '').trim(),
      frequencyTier: clamp(Number.parseInt(entry?.frequencyTier, 10) || 2, 1, 6),
      // The tier chooses the next adaptive item; the exact band is retained
      // for the personal profile and must match the lexicon validator later.
      frequencyBand: canonical(entry?.frequencyBand) || `frequency-${clamp(Number.parseInt(entry?.frequencyTier, 10) || 2, 1, 6)}`,
      quality: canonical(entry?.quality) || 'limited'
    }))
    .filter(entry => entry.lemma && entry.gloss && entry.quality === 'high' && !seen.has(entry.lemma) && (seen.add(entry.lemma) || true));
};

const seededIndex = (seed, questionIndex, length) => {
  const base = Math.abs((Number(seed) || 1) * 1103515245 + (questionIndex + 1) * 12345);
  return length ? base % length : 0;
};

const chooseTier = (bank, used, desiredTier) => {
  const remaining = bank.filter(entry => !used.includes(entry.lemma));
  if (!remaining.length) return [];
  const tiers = [...new Set(remaining.map(entry => entry.frequencyTier))]
    .sort((a, b) => Math.abs(a - desiredTier) - Math.abs(b - desiredTier) || a - b);
  return remaining.filter(entry => entry.frequencyTier === tiers[0]);
};

function describeBankStratification(bank) {
  const tierCounts = Object.fromEntries(CALIBRATION_FREQUENCY_TIERS.map(tier => [tier, 0]));
  for (const entry of bank) {
    if (Object.hasOwn(tierCounts, entry.frequencyTier)) tierCounts[entry.frequencyTier] += 1;
  }
  const anchorTiers = CALIBRATION_FREQUENCY_TIERS
    .filter(tier => tierCounts[tier] >= CALIBRATION_MIN_ITEMS_PER_FREQUENCY_TIER);
  const insufficientTiers = CALIBRATION_FREQUENCY_TIERS
    .filter(tier => tierCounts[tier] < CALIBRATION_MIN_ITEMS_PER_FREQUENCY_TIER);

  return {
    status: insufficientTiers.length ? 'partial' : 'complete',
    minimumItemsPerTier: CALIBRATION_MIN_ITEMS_PER_FREQUENCY_TIER,
    tierCounts,
    anchorTiers,
    insufficientTiers
  };
}

export function createCalibrationSession({ bank = [], targetTrack = 'cet4', seed = Date.now() } = {}) {
  const normalizedBank = normalizeBank(bank);
  if (normalizedBank.length < CALIBRATION_WORD_QUESTION_COUNT) {
    throw new Error('初测词库不足：需要至少 24 个高可信词条。');
  }
  const stratification = describeBankStratification(normalizedBank);
  return {
    version: 1,
    targetTrack: canonical(targetTrack) || 'cet4',
    seed: Number(seed) || 1,
    bank: normalizedBank,
    totalWordQuestions: CALIBRATION_WORD_QUESTION_COUNT,
    answers: [],
    used: [],
    // The first pass deliberately takes one audited item from every available
    // frequency tier. Without this, a highly adaptive run can leave a core
    // tier entirely unobserved and make later personal matching look falsely
    // certain or falsely empty. The remaining questions stay adaptive.
    anchorTiers: stratification.anchorTiers,
    stratification,
    currentTier: 2,
    correctCount: 0,
    completed: false
  };
}

export function getNextCalibrationQuestion(session) {
  if (!session || session.completed || (session.answers?.length || 0) >= session.totalWordQuestions) return null;
  const questionIndex = session.answers?.length || 0;
  const anchorTier = session.anchorTiers?.[questionIndex];
  const candidates = anchorTier
    ? (session.bank || []).filter(entry => !session.used?.includes(entry.lemma) && entry.frequencyTier === anchorTier)
    : chooseTier(session.bank || [], session.used || [], session.currentTier || 2);
  if (!candidates.length) return null;
  return candidates[seededIndex(session.seed, questionIndex, candidates.length)];
}

export function submitCalibrationAnswer(session, { lemma, outcome } = {}) {
  const question = getNextCalibrationQuestion(session);
  const normalizedOutcome = ['correct', 'incorrect', 'unsure'].includes(canonical(outcome)) ? canonical(outcome) : 'unsure';
  if (!question || canonical(lemma) !== question.lemma) throw new Error('初测答案与当前题目不匹配。');

  const correct = normalizedOutcome === 'correct';
  const nextTier = correct
    ? clamp((session.currentTier || 2) + 1, 1, 6)
    : clamp((session.currentTier || 2) - 1, 1, 6);
  const answers = [...(session.answers || []), {
    lemma: question.lemma,
    frequencyTier: question.frequencyTier,
    frequencyBand: question.frequencyBand,
    outcome: normalizedOutcome,
    countsAsKnown: correct
  }];
  return {
    ...session,
    answers,
    used: [...(session.used || []), question.lemma],
    currentTier: nextTier,
    correctCount: (session.correctCount || 0) + (correct ? 1 : 0),
    completed: answers.length >= session.totalWordQuestions
  };
}

export function recommendCalibrationMode({ targetTrack = 'cet4', answers = [], readingComprehension = {} } = {}) {
  const validAnswers = Array.isArray(answers) ? answers.filter(answer => ['correct', 'incorrect', 'unsure'].includes(canonical(answer?.outcome))) : [];
  const correct = validAnswers.filter(answer => canonical(answer.outcome) === 'correct').length;
  const wordAccuracy = validAnswers.length ? correct / validAnswers.length : 0;
  const readingCorrect = Math.max(0, Number.parseInt(readingComprehension.correct, 10) || 0);
  const readingTotal = Math.max(0, Number.parseInt(readingComprehension.total, 10) || 0);
  const readingPass = readingTotal >= CALIBRATION_READING_MINIMUM.total
    && readingCorrect >= CALIBRATION_READING_MINIMUM.correct;

  let challenge = 'support';
  let reason = 'word_check';
  if (readingPass) {
    if (wordAccuracy >= 0.75) challenge = 'stretch';
    else if (wordAccuracy >= 0.48) challenge = 'standard';
    reason = 'combined_check';
  } else {
    reason = 'reading_check';
  }

  return {
    targetTrack: canonical(targetTrack) || 'cet4',
    challenge,
    reason,
    wordAccuracy: Math.round(wordAccuracy * 1000) / 10,
    readingComprehension: { correct: readingCorrect, total: readingTotal, passed: readingPass }
  };
}

export function minimumActiveReadingSeconds(wordCount) {
  return Math.max(45, (Math.max(0, Number(wordCount) || 0) / 400) * 60);
}

/** Only foreground active time belongs in `activeSeconds`; the view pauses it on hidden/blur. */
export function isQualifiedReading({ completed, scrollDepth, activeSeconds, wordCount } = {}) {
  return Boolean(completed)
    && Number(scrollDepth) >= 0.7
    && Number(activeSeconds) >= minimumActiveReadingSeconds(wordCount);
}

export function shouldRequestReadingEaseFeedback(profile = {}) {
  return profile?.calibration?.status === 'skipped'
    && Number(profile.qualifiedReadingCount) >= 3
    && !profile.readingEaseFeedback?.choice;
}

export function applyReadingEaseFeedback(profile = {}, choice) {
  const normalizedChoice = canonical(choice);
  if (!['too_hard', 'fitting', 'too_easy'].includes(normalizedChoice)) throw new Error('无效的阅读难度反馈。');
  const current = MODE_ORDER.includes(profile.recommendedChallenge) ? profile.recommendedChallenge : 'standard';
  const index = MODE_ORDER.indexOf(current);
  const nextIndex = normalizedChoice === 'too_hard' ? index - 1 : normalizedChoice === 'too_easy' ? index + 1 : index;
  return {
    ...profile,
    recommendedChallenge: MODE_ORDER[clamp(nextIndex, 0, MODE_ORDER.length - 1)],
    readingEaseFeedback: { choice: normalizedChoice, recordedAt: Date.now() }
  };
}
