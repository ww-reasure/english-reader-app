const DAY_MS = 86_400_000;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function externalReviewCreditDays(interval) {
  return Math.max(1, Math.min(7, Math.round(Math.max(0, finite(interval)) * 0.25)));
}

export function scheduleExternalReview(word = {}, now = Date.now()) {
  const externalReviewCount = Math.max(0, Math.trunc(finite(word.externalReviewCount))) + 1;
  const contactPatch = { externalReviewCount, lastExternalReviewAt: now };
  if (Math.max(0, Math.trunc(finite(word.recoveryStage))) > 0) {
    return { reason: 'recovery', scheduleChanged: false, creditDays: 0, patch: contactPatch };
  }
  if (finite(word.stubbornUntil) > 0) {
    return { reason: 'stubborn', scheduleChanged: false, creditDays: 0, patch: contactPatch };
  }
  const creditDays = externalReviewCreditDays(word.interval);
  const candidate = now + creditDays * DAY_MS;
  const existing = finite(word.nextReview, now);
  if (existing >= candidate) {
    return { reason: 'existing_schedule_later', scheduleChanged: false, creditDays, patch: contactPatch };
  }
  return {
    reason: 'credited',
    scheduleChanged: true,
    creditDays,
    patch: {
      ...contactPatch,
      nextReview: candidate,
      reviewRevision: Math.max(0, Math.trunc(finite(word.reviewRevision))) + 1
    }
  };
}
