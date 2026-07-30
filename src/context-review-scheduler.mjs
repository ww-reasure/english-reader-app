import { scheduleReview } from './learning-scheduler.mjs';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export const ContextReviewResult = Object.freeze({
  KNOWN: 'known',
  UNCERTAIN: 'uncertain',
  UNKNOWN: 'unknown',
  SKIPPED: 'skipped'
});

export function scheduleContextReview(word = {}, result, now = Date.now()) {
  if (result === ContextReviewResult.SKIPPED) return null;
  if (result === ContextReviewResult.UNKNOWN) {
    return { ...scheduleReview(word, 1, now), contextResult: result };
  }

  if (result === ContextReviewResult.UNCERTAIN) {
    return {
      easeFactor: Math.max(1.3, Math.round((number(word.easeFactor, 2.5) - 0.08) * 100) / 100),
      interval: 0,
      reviewCount: Math.max(0, number(word.reviewCount)),
      nextReview: now + 30 * MINUTE,
      lastReview: new Date(now),
      lastQuality: 3,
      state: 'relearning',
      learningStep: 0,
      lapseCount: Math.max(0, number(word.lapseCount)),
      schedulerVersion: 2,
      contextResult: result
    };
  }

  if (result !== ContextReviewResult.KNOWN) {
    throw new TypeError('不支持的语境复习结果');
  }

  const interval = Math.max(0, number(word.interval));
  const reviewCount = Math.max(0, number(word.reviewCount));
  const isNew = word.state === 'new' || interval < 1 || (!reviewCount && !word.nextReview);
  const nextInterval = isNew
    ? 1
    : Math.round(Math.min(interval * 1.25, interval + 7) * 100) / 100;

  return {
    easeFactor: number(word.easeFactor, 2.5),
    interval: nextInterval,
    reviewCount: reviewCount + 1,
    nextReview: now + nextInterval * DAY,
    lastReview: new Date(now),
    lastQuality: 5,
    state: isNew ? 'learning' : 'review',
    learningStep: isNew ? 1 : null,
    lapseCount: Math.max(0, number(word.lapseCount)),
    schedulerVersion: 2,
    contextResult: result
  };
}

export const ContextReviewSchedulerConstants = Object.freeze({ MINUTE, DAY });
