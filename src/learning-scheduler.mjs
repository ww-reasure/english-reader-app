const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const validRating = rating => [1, 3, 5].includes(rating) ? rating : 3;
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function legacyState(word) {
  if (word.state) return word.state;
  if (!number(word.reviewCount)) return 'new';
  if (number(word.interval) < 1 || number(word.reviewCount) < 2) return 'learning';
  return 'review';
}

function nextAt(now, delay) {
  return now + delay;
}

function easeFor(ease, rating) {
  if (rating === 5) return Math.min(3, Math.round((ease + 0.1) * 100) / 100);
  if (rating === 3) return Math.max(1.3, Math.round((ease - 0.08) * 100) / 100);
  return Math.max(1.3, Math.round((ease - 0.2) * 100) / 100);
}

/**
 * Compatibility scheduler v2. It preserves legacy fields while adding explicit
 * learning/relearning states. `now` is injectable so all interval decisions are testable.
 */
export function scheduleReview(word = {}, rating, now = Date.now()) {
  const quality = validRating(rating);
  const state = legacyState(word);
  const interval = Math.max(0, number(word.interval));
  const reviewCount = Math.max(0, number(word.reviewCount));
  const learningStep = Math.max(0, number(word.learningStep));
  const lapseCount = Math.max(0, number(word.lapseCount));
  const easeFactor = number(word.easeFactor, 2.5);

  const base = {
    easeFactor: easeFor(easeFactor, quality),
    reviewCount,
    lastReview: new Date(now),
    lastQuality: quality,
    lapseCount,
    schedulerVersion: 2
  };

  if (quality === 1) {
    return {
      ...base,
      state: 'relearning',
      learningStep: 0,
      interval: 0,
      lapseCount: lapseCount + 1,
      nextReview: nextAt(now, 10 * MINUTE)
    };
  }

  if (state === 'relearning') {
    if (quality === 3) {
      return {
        ...base,
        state: 'relearning',
        learningStep: 0,
        interval: 0,
        nextReview: nextAt(now, 30 * MINUTE)
      };
    }
    return {
      ...base,
      state: 'learning',
      learningStep: 1,
      interval: 1,
      reviewCount: reviewCount + 1,
      nextReview: nextAt(now, DAY)
    };
  }

  if (state === 'new') {
    if (quality === 3) {
      return {
        ...base,
        state: 'learning',
        learningStep: 0,
        interval: 0,
        nextReview: nextAt(now, 30 * MINUTE)
      };
    }
    return {
      ...base,
      state: 'learning',
      learningStep: 1,
      interval: 1,
      reviewCount: reviewCount + 1,
      nextReview: nextAt(now, DAY)
    };
  }

  if (state === 'learning') {
    if (interval < 1 || learningStep === 0) {
      return {
        ...base,
        state: 'learning',
        learningStep: quality === 5 ? 1 : 0,
        interval: quality === 5 ? 1 : 0,
        nextReview: nextAt(now, quality === 5 ? DAY : 30 * MINUTE)
      };
    }
    return {
      ...base,
      state: 'review',
      learningStep: null,
      interval: quality === 5 ? 3 : 2,
      reviewCount: reviewCount + 1,
      nextReview: nextAt(now, (quality === 5 ? 3 : 2) * DAY)
    };
  }

  const multiplier = quality === 5 ? easeFor(easeFactor, quality) : Math.max(1.2, easeFor(easeFactor, quality) * 0.8);
  const nextInterval = Math.max(1, Math.round(Math.max(1, interval) * multiplier));
  return {
    ...base,
    state: 'review',
    learningStep: null,
    interval: nextInterval,
    reviewCount: reviewCount + 1,
    nextReview: nextAt(now, nextInterval * DAY)
  };
}

function relativeOverdueness(word, now) {
  const due = number(word.nextReview, now);
  const interval = Math.max(1, number(word.interval, 1));
  return Math.max(0, now - due) / (interval * DAY);
}

/** Returns due reviews first, then at most `newLimit` unseen words. */
export function selectReviewQueue(words = [], { now = Date.now(), limit = 20, newLimit = 10 } = {}) {
  const due = words.filter(word => word.nextReview && number(word.nextReview) <= now)
    .sort((a, b) => relativeOverdueness(b, now) - relativeOverdueness(a, now));
  const newWords = words.filter(word => !word.nextReview)
    .slice(0, Math.max(0, newLimit));

  return [...due, ...newWords].slice(0, Math.max(0, limit));
}

export const SchedulerConstants = { MINUTE, DAY };
