export const DAY_MS = 24 * 60 * 60 * 1000;
export const FIRST_REVIEW_DELAY_MS = DAY_MS;
export const SECOND_REVIEW_DELAY_MS = 3 * DAY_MS;
export const TRANSLATION_MOSTLY_MASTERED_DELAY_MS = 7 * DAY_MS;

function stateKey(attempt, questionKey) {
  return `${attempt.bankId}:${questionKey}`;
}

export function isObjectiveDue(state, now) {
  return state?.status === 'active' && Number.isFinite(state.nextDueAt) && state.nextDueAt <= now;
}

export function addWrongState({ now, attempt, questionKey }) {
  return {
    key: stateKey(attempt, questionKey),
    examId: attempt.examId,
    bankId: attempt.bankId,
    packageId: attempt.packageId,
    paperKey: attempt.paperKey,
    unitKey: attempt.unitKey,
    questionKey,
    status: 'active',
    firstAddedAt: now,
    originAttemptId: attempt.attemptId,
    lastWrongAt: now,
    lastReviewedAt: null,
    lastReviewAttemptId: null,
    nextDueAt: null,
    independentCorrectStreak: 0,
    lastIndependentCorrectAt: null,
    wrongCount: 1,
    reviewCount: 0,
    masteredAt: null,
    createdAt: now,
    updatedAt: now
  };
}

export function reactivateWrongState({ state, now, attemptId = null, reviewed = false }) {
  return {
    ...state,
    status: 'active',
    independentCorrectStreak: 0,
    lastWrongAt: now,
    lastReviewedAt: reviewed ? now : state.lastReviewedAt ?? null,
    lastReviewAttemptId: reviewed ? attemptId : state.lastReviewAttemptId ?? null,
    nextDueAt: null,
    wrongCount: (Number(state.wrongCount) || 0) + 1,
    reviewCount: (Number(state.reviewCount) || 0) + (reviewed ? 1 : 0),
    masteredAt: null,
    updatedAt: now
  };
}

export function readdMasteredWrongState({ state, now }) {
  return {
    ...state,
    status: 'active',
    independentCorrectStreak: 0,
    lastIndependentCorrectAt: null,
    nextDueAt: null,
    masteredAt: null,
    updatedAt: now
  };
}

function eligibleManualReview({ state, attempt, questionKey }) {
  return ['review_center_manual', 'review_center_due'].includes(attempt?.practiceOrigin)
    && attempt?.status === 'submitted'
    && Array.isArray(attempt.reviewEligibleQuestionKeys)
    && attempt.reviewEligibleQuestionKeys.includes(questionKey)
    && state?.lastReviewAttemptId !== attempt.attemptId;
}

export function transitionObjectiveReview({ state, attempt, response, now }) {
  if (!state || !response || response.questionKey !== state.questionKey) return state;
  const isEligible = eligibleManualReview({ state, attempt, questionKey: response.questionKey });
  if (response.unanswered) return state;

  if (response.correct === false) {
    return reactivateWrongState({
      state,
      now,
      attemptId: attempt?.attemptId || null,
      reviewed: isEligible
    });
  }

  if (response.correct !== true || !isEligible) return state;

  const nextStreak = (Number(state.independentCorrectStreak) || 0) + 1;
  const base = {
    ...state,
    independentCorrectStreak: nextStreak,
    lastIndependentCorrectAt: now,
    lastReviewedAt: now,
    lastReviewAttemptId: attempt.attemptId,
    reviewCount: (Number(state.reviewCount) || 0) + 1,
    updatedAt: now
  };
  if (nextStreak >= 2) {
    return { ...base, status: 'mastered', masteredAt: now, nextDueAt: null };
  }
  return { ...base, status: 'active', nextDueAt: null, masteredAt: null };
}

export function scheduleTranslationReview({ existing = null, attempt, questionKey, status, now }) {
  const firstMarkedAt = existing?.firstMarkedAt || existing?.createdAt || now;
  const createdAt = existing?.createdAt || now;
  const nextDueAt = null;
  return {
    ...(existing || {}),
    key: existing?.key || stateKey(attempt, questionKey),
    examId: attempt.examId,
    bankId: attempt.bankId,
    packageId: attempt.packageId,
    paperKey: attempt.paperKey,
    unitKey: attempt.unitKey,
    questionKey,
    status,
    firstMarkedAt,
    lastReviewedAt: now,
    nextDueAt,
    sourceAttemptId: existing?.sourceAttemptId || attempt.attemptId,
    createdAt,
    updatedAt: now
  };
}

export function normalizeLegacyWrongState({ state, now }) {
  if (state?.status === 'mastered' || state?.nextDueAt != null) return state;
  return {
    ...state,
    status: 'active',
    nextDueAt: now,
    independentCorrectStreak: Number(state?.independentCorrectStreak) || 0,
    firstAddedAt: state?.firstAddedAt || state?.createdAt || state?.updatedAt || now,
    originAttemptId: state?.originAttemptId || null,
    lastReviewedAt: state?.lastReviewedAt ?? null,
    lastReviewAttemptId: state?.lastReviewAttemptId ?? null,
    lastIndependentCorrectAt: state?.lastIndependentCorrectAt ?? null,
    masteredAt: state?.masteredAt ?? null
  };
}
