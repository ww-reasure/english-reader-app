/**
 * Spaced Repetition Module (SM-2 Algorithm)
 * Based on SuperMemo SM-2 with Anki improvements
 *
 * Rating scale (simplified to 3 buttons):
 *   1 = Forgot (completely unknown)
 *   3 = Fuzzy (took a moment to recall)
 *   5 = Knew (immediately recognized)
 *
 * Intervals: 1d → 3d → 6d → then easeFactor * previous
 */

const SpacedRepetition = {
  // Default SRS fields for a new word
  defaults: {
    easeFactor: 2.5,
    interval: 0,
    reviewCount: 0,
    nextReview: null,
    lastReview: null,
    lastQuality: null
  },

  /**
   * Calculate next review based on SM-2 algorithm
   * @param {Object} word - word with SRS fields
   * @param {number} quality - rating 1, 3, or 5
   * @returns {Object} updated SRS fields
   */
  calculateNext(word, quality) {
    let { easeFactor = 2.5, interval = 0, reviewCount = 0 } = word;

    if (quality >= 3) {
      // Correct answer
      if (reviewCount === 0) {
        interval = 1;
      } else if (reviewCount === 1) {
        interval = 3;
      } else if (reviewCount === 2) {
        interval = 6;
      } else {
        interval = Math.round(interval * easeFactor);
      }
      reviewCount++;
    } else {
      // Wrong answer: reset but don't fully lose progress (Anki improvement)
      interval = 1;
      reviewCount = Math.max(0, reviewCount - 1);
    }

    // Adjust ease factor
    // Formula: EF' = EF + (0.1 - (5-q) * (0.08 + (5-q) * 0.02))
    const q = quality;
    easeFactor = easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    if (easeFactor < 1.3) easeFactor = 1.3;
    if (easeFactor > 3.0) easeFactor = 3.0;

    // Calculate next review at start of the day + interval days
    // This means words refresh at midnight, not 24h after review
    const now = new Date();
    const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + interval);
    const nextReview = nextDay.getTime();

    return {
      easeFactor: Math.round(easeFactor * 100) / 100,
      interval,
      reviewCount,
      nextReview,
      lastReview: now,
      lastQuality: quality
    };
  },

  /**
   * Get words that are due for review
   * @param {Array} words - all learn words
   * @param {number} limit - max words to return
   * @returns {Array} due words sorted by priority
   */
  getDueWords(words, limit = 20) {
    const now = Date.now();

    return words
      .filter(w => !w.nextReview || w.nextReview <= now)
      .sort((a, b) => {
        // Priority: new words > forgotten > due
        if (!a.nextReview && b.nextReview) return -1;
        if (a.nextReview && !b.nextReview) return 1;
        if (a.reviewCount !== b.reviewCount) return a.reviewCount - b.reviewCount;
        return (a.nextReview || 0) - (b.nextReview || 0);
      })
      .slice(0, limit);
  },

  /**
   * Get count of due words
   */
  getDueCount(words) {
    const now = Date.now();
    return words.filter(w => !w.nextReview || w.nextReview <= now).length;
  },

  /**
   * Get word status label
   * @returns {string} 'new' | 'learning' | 'review' | 'mastered'
   */
  getStatus(word) {
    if (!word.reviewCount || word.reviewCount === 0) return 'new';
    if (word.reviewCount < 3) return 'learning';
    if (word.interval >= 21) return 'mastered';  // 21+ days = mastered
    return 'review';
  },

  /**
   * Get status display info
   */
  getStatusDisplay(word) {
    const status = this.getStatus(word);
    const map = {
      new: { label: '新词', color: '#999', icon: '🆕' },
      learning: { label: '学习中', color: '#f39c12', icon: '📖' },
      review: { label: '待复习', color: '#3498db', icon: '🔄' },
      mastered: { label: '已掌握', color: '#27ae60', icon: '✅' }
    };
    return map[status] || map.new;
  },

  /**
   * Get interval display text
   */
  getIntervalText(interval) {
    if (!interval || interval === 0) return '新词';
    if (interval === 1) return '1 天';
    if (interval < 30) return interval + ' 天';
    if (interval < 365) return Math.round(interval / 30) + ' 个月';
    return Math.round(interval / 365) + ' 年';
  },

  /**
   * Rating button labels and descriptions
   */
  ratings: [
    { quality: 1, label: '忘了', desc: '完全不认识', color: '#e74c3c' },
    { quality: 3, label: '模糊', desc: '想了一下', color: '#f39c12' },
    { quality: 5, label: '认识', desc: '立刻想起', color: '#27ae60' }
  ]
};
