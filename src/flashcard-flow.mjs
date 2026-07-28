export const REVIEW_PHASES = Object.freeze({
  RECALL: 'recall',
  STUDY: 'study'
});

export function createReviewState() {
  return {
    phase: REVIEW_PHASES.RECALL,
    meaningRevealed: false,
    pendingQuality: null,
    quality: null,
    isSubmitting: false,
    isCorrecting: false,
    ratingCorrected: false
  };
}

export function revealMeaning(state) {
  if (state.phase !== REVIEW_PHASES.RECALL || state.isSubmitting) return state;
  return { ...state, meaningRevealed: true };
}

export function startRating(state, quality) {
  const isSupportedQuality = [1, 3, 5].includes(quality);
  const knownAfterReveal = state.meaningRevealed && quality === 5;
  if (state.phase !== REVIEW_PHASES.RECALL || state.isSubmitting || !isSupportedQuality || knownAfterReveal) {
    return null;
  }
  return { ...state, pendingQuality: quality, isSubmitting: true };
}

export function finishRating(state) {
  if (state.phase !== REVIEW_PHASES.RECALL || !state.isSubmitting || state.pendingQuality === null) return state;
  return {
    ...state,
    phase: REVIEW_PHASES.STUDY,
    quality: state.pendingQuality,
    pendingQuality: null,
    isSubmitting: false
  };
}

export function canCorrectKnownRating(state) {
  return state.phase === REVIEW_PHASES.STUDY
    && state.quality === 5
    && !state.isSubmitting
    && !state.ratingCorrected;
}

export function startRatingCorrection(state) {
  if (!canCorrectKnownRating(state)) return null;
  return { ...state, isSubmitting: true, isCorrecting: true };
}

export function finishRatingCorrection(state) {
  if (state.phase !== REVIEW_PHASES.STUDY || !state.isCorrecting || !state.isSubmitting) return state;
  return {
    ...state,
    quality: 1,
    isSubmitting: false,
    isCorrecting: false,
    ratingCorrected: true
  };
}

export function skipWord(state) {
  if (state.phase !== REVIEW_PHASES.RECALL || state.isSubmitting) return null;
  return createReviewState();
}

export function nextWord(state) {
  if (state.phase !== REVIEW_PHASES.STUDY) return null;
  return createReviewState();
}
