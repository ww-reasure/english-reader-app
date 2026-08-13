import { settleSessionReview } from './recovery-scheduler.mjs';

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
    // V2：不认识 = 忘记（debt +2），进入 recovery，nextReview = now（下次打开优先）
    return { ...settleSessionReview(word, 1, 2, now), contextResult: result };
  }

  if (result === ContextReviewResult.UNCERTAIN) {
    // V2：不确定 = 模糊（debt +1）
    return { ...settleSessionReview(word, 3, 1, now), contextResult: result };
  }

  if (result !== ContextReviewResult.KNOWN) {
    throw new TypeError('不支持的语境复习结果');
  }

  // V2：认识（known）= 会话内成功；recovery 词递减 stage，普通词走长期 SRS
  return { ...settleSessionReview(word, 5, 0, now), contextResult: result };
}

export const ContextReviewSchedulerConstants = Object.freeze({ MINUTE, DAY });
