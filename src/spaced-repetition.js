/**
 * Backward-compatible facade for the learning scheduler.
 * Existing screens continue to use the historical field names while every new
 * score receives an explicit scheduler-v2 state and relearning step.
 */
import { scheduleReview, selectReviewQueue } from './learning-scheduler.mjs';

export const SpacedRepetition = {
  defaults: {
    easeFactor: 2.5,
    interval: 0,
    reviewCount: 0,
    nextReview: null,
    lastReview: null,
    lastQuality: null,
    state: 'new',
    learningStep: null,
    lapseCount: 0,
    schedulerVersion: 2
  },

  calculateNext(word, quality) {
    return scheduleReview(word, quality);
  },

  getDueWords(words, limit = 20, options = {}) {
    return selectReviewQueue(words, { limit, ...options });
  },

  getDueCount(words) {
    const now = Date.now();
    return words.filter(word => !word.nextReview || word.nextReview <= now).length;
  },

  getStatus(word) {
    // Recovery is an active transient state: a mature word being relearned must
    // never be reported as stable, even if its stored interval is long or it
    // was previously mastered.
    if (Math.max(0, Number(word.recoveryStage) || 0) > 0) return 'relearning';
    if (word.state === 'mastered') return 'stable';
    if (word.state === 'relearning') return 'relearning';
    if (word.state === 'learning' || (!word.reviewCount && word.nextReview)) return 'learning';
    if (!word.reviewCount) return 'new';
    if (word.interval >= 21) return 'stable';
    return 'review';
  },

  isStable(word) {
    return this.getStatus(word) === 'stable';
  },

  getStatusDisplay(word) {
    const status = this.getStatus(word);
    const map = {
      new: { label: '新词', color: 'var(--state-new)', icon: '🆕' },
      learning: { label: '学习中', color: 'var(--state-learning)', icon: '📖' },
      relearning: { label: '重新学习', color: 'var(--state-learning)', icon: '↻' },
      review: { label: '待复习', color: 'var(--state-review)', icon: '🔄' },
      stable: { label: '长期巩固', color: 'var(--state-mastered)', icon: '✅' }
    };
    return map[status] || map.new;
  },

  getIntervalText(interval) {
    if (!interval || interval === 0) return '短时复习';
    if (interval === 1) return '1 天';
    if (interval < 30) return `${interval} 天`;
    if (interval < 365) return `${Math.round(interval / 30)} 个月`;
    return `${Math.round(interval / 365)} 年`;
  },

  ratings: [
    { quality: 1, label: '忘了', desc: '完全不认识', color: 'var(--danger)' },
    { quality: 3, label: '模糊', desc: '想了一下', color: 'var(--warning)' },
    { quality: 5, label: '认识', desc: '立刻想起', color: 'var(--success)' }
  ]
};
