/**
 * Session Scheduler (V2)
 *
 * 会话内“隔 N 个其他词”重插队列：
 * - 认识：本会话不再出现（交由 Recovery/Long-term 结算）。
 * - 模糊：debt +1，隔 6 个其他词后重新出现。
 * - 忘记：debt +2，隔 3 个其他词后重新出现。
 * - 单词单会话最多重插 3 次，超过后标记顽固词，会话内不再出现。
 * - 不依赖真实分钟数、不依赖轮次边界；只有词数足够时间隔才有意义。
 */

export const SESSION_CONSTANTS = Object.freeze({
  FORGOT_SPACING: 3,
  FUZZY_SPACING: 6,
  MAX_REINSERT: 3
});

export const ACTIVE_SESSION_KEY = 'review-session-active';

const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function createSessionQueue(words = [], { now = Date.now() } = {}) {
  const queue = [...(words || [])];
  const buffer = []; // { wordId, spacing, remaining }
  const debt = new Map(); // wordId -> session debt
  const reinsertCount = new Map(); // wordId -> reinsert count
  const stubborn = new Map(); // wordId -> timestamp

  const snapshot = () => ({
    id: ACTIVE_SESSION_KEY,
    kind: 'review-session',
    queue: [...queue],
    buffer: buffer.map(entry => ({ ...entry })),
    debt: Object.fromEntries(debt),
    reinsertCount: Object.fromEntries(reinsertCount),
    stubborn: Object.fromEntries(stubborn),
    updatedAt: Date.now(),
    createdAt: now
  });

  const restore = (data = {}) => {
    queue.length = 0;
    queue.push(...(Array.isArray(data.queue) ? data.queue : []));
    buffer.length = 0;
    buffer.push(...(Array.isArray(data.buffer) ? data.buffer.map(entry => ({ ...entry })) : []));
    debt.clear();
    for (const [key, value] of Object.entries(data.debt || {})) debt.set(Number(key), Number(value));
    reinsertCount.clear();
    for (const [key, value] of Object.entries(data.reinsertCount || {})) reinsertCount.set(Number(key), Number(value));
    stubborn.clear();
    for (const [key, value] of Object.entries(data.stubborn || {})) stubborn.set(Number(key), Number(value));
  };

  return {
    isEmpty() {
      return queue.length === 0 && buffer.length === 0;
    },

    next() {
      if (queue.length) {
        // 主队列取一个词：所有等待重插的词“隔词数”减一
        for (const entry of buffer) entry.remaining = Math.max(0, entry.remaining - 1);
        return queue.shift();
      }
      if (buffer.length) {
        // 主队列耗尽：最早到点（remaining 最小）者先出
        buffer.sort((a, b) => (a.remaining - b.remaining) || 0);
        const entry = buffer.shift();
        return entry.wordId;
      }
      return null;
    },

    getDebt(wordId) {
      return debt.get(Number(wordId)) || 0;
    },

    getReinsertCount(wordId) {
      return reinsertCount.get(Number(wordId)) || 0;
    },

    isStubborn(wordId) {
      return stubborn.has(Number(wordId));
    },

    /**
     * 评分。
     * @returns {{ final: boolean, reinserted: boolean, stubborn: boolean }}
     */
    rate(wordId, rating, { now: eventNow = Date.now(), expectedRevision } = {}) {
      const id = Number(wordId);
      const quality = Number(rating);
      const currentDebt = debt.get(id) || 0;

      if (quality !== 5) {
        debt.set(id, currentDebt + (quality === 1 ? 2 : 1));
        const count = (reinsertCount.get(id) || 0) + 1;
        reinsertCount.set(id, count);
        if (count > SESSION_CONSTANTS.MAX_REINSERT) {
          stubborn.set(id, eventNow);
          return { final: true, reinserted: false, stubborn: true };
        }
        const spacing = quality === 1 ? SESSION_CONSTANTS.FORGOT_SPACING : SESSION_CONSTANTS.FUZZY_SPACING;
        buffer.push({ wordId: id, spacing, remaining: spacing, expectedRevision: Number(expectedRevision) || undefined });
        return { final: false, reinserted: true, stubborn: false };
      }

      return { final: true, reinserted: false, stubborn: stubborn.has(id) };
    },

    /**
     * 同步一个词的 expectedRevision（评分/重新取词后调用），避免重插后被
     * reviewRevision 守卫误判为“已在别处复习”。
     */
    syncExpectedRevision(wordId, expectedRevision) {
      const id = Number(wordId);
      for (const entry of buffer) {
        if (entry.wordId === id) entry.expectedRevision = Number(expectedRevision) || undefined;
      }
    },

    getExpectedRevision(wordId) {
      const id = Number(wordId);
      const entry = buffer.find(item => item.wordId === id);
      return entry?.expectedRevision;
    },

    snapshot,
    restore,

    getPendingCount() {
      return queue.length + buffer.length;
    }
  };
}

export async function persistSessionQueue(queue, { db, key = ACTIVE_SESSION_KEY } = {}) {
  if (!db?.saveReviewSession) return;
  await db.saveReviewSession({ ...queue.snapshot(), id: key });
}

export async function loadSessionQueue({ db, key = ACTIVE_SESSION_KEY } = {}) {
  if (!db?.getReviewSession) return null;
  const data = await db.getReviewSession(key);
  if (!data || (!Array.isArray(data.queue) && !Array.isArray(data.buffer))) return null;
  const queue = createSessionQueue();
  queue.restore(data);
  return queue;
}

export async function clearSessionQueue({ db, key = ACTIVE_SESSION_KEY } = {}) {
  if (!db?.deleteReviewSession) return;
  await db.deleteReviewSession(key);
}

export function createStubbornAwareQueue(words, { now = Date.now() } = {}) {
  // 顽固词优先：stubbornUntil <= now 的词排最前（由调用方通过 coordinator 排序，
  // 这里仅提供一致的排序键辅助）
  return createSessionQueue(words, { now });
}

export const sessionDebtValue = (quality) => (Number(quality) === 1 ? 2 : Number(quality) === 3 ? 1 : 0);
