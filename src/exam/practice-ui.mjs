export const SNAP_ORDER = Object.freeze(['peek', 'low', 'mid', 'high']);
export const SNAP_HEIGHTS = Object.freeze({ peek: 12, low: 24, mid: 52, high: 88 });

export function closestSnap(currentPct) {
  return SNAP_ORDER.reduce((best, snap) => {
    const distance = Math.abs(SNAP_HEIGHTS[snap] - currentPct);
    return distance < Math.abs(SNAP_HEIGHTS[best] - currentPct) ? snap : best;
  }, SNAP_ORDER[0]);
}

export function isFinalPracticeQuestion({
  practiceKind = 'unit',
  currentUnitIndex = 0,
  unitCount = 1,
  currentQuestionIndex = 0,
  currentUnitQuestionCount = 0
} = {}) {
  if (currentUnitQuestionCount <= 0 || currentQuestionIndex !== currentUnitQuestionCount - 1) return false;
  return practiceKind !== 'full_paper' || currentUnitIndex === unitCount - 1;
}
