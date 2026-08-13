/**
 * Recovery Scheduler (V2)
 *
 * 三层复习调度中的跨会话层：
 * - Session 内重插由 review-session.mjs 负责（隔 N 个词，不依赖真实分钟）。
 * - 本模块负责评分后的记忆状态迁移：
 *   debt（模糊+1 / 忘记+2）→ recoveryTarget（1/2/3）→ recoveryStage 递减 → 恢复长期 SRS。
 *
 * 关键语义：
 * - recovery 词不再用“10/30 分钟强制复习”，nextReview = now 表示“下次打开 App 即优先出现”。
 * - 到期但没打开 App 不算失败；只有真正评分才更新状态。
 * - 最后一次“认识”不代表清空本次会话的 debt（lastDebt 保留到恢复完成）。
 * - 成熟词 recovery 期间保留原 interval（不归零），恢复完成时按 lastDebt 压缩。
 */

import { scheduleReview } from './learning-scheduler.mjs';

export const DEBT_WEAKNESS = Object.freeze({ FUZZY: 1, FORGOT: 2 });
export const RECOVERY_TARGET_BY_DEBT = Object.freeze([
  0, // debt 0 → normal
  1, // debt 1 → Fragile
  2, // debt 2 → Relearning
  2, // debt 3 → Relearning
  3  // debt >= 4 → Difficult
]);
export const COMPRESSION_BY_DEBT = Object.freeze([
  1,    // debt 0 → 不压缩
  0.6,  // 仅 1 次模糊
  0.3,  // 1 次忘记 / debt 2~3
  0.3,
  0.15  // 多次失败 debt >= 4
]);

const MIN_INTERVAL_DAYS = 1;
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function debtToRecoveryTarget(debt) {
  const value = Math.max(0, Math.trunc(Number(debt) || 0));
  return value >= 4 ? 3 : RECOVERY_TARGET_BY_DEBT[value] || 0;
}

export function compressionForDebt(debt) {
  const value = Math.max(0, Math.trunc(Number(debt) || 0));
  return COMPRESSION_BY_DEBT[Math.min(value, COMPRESSION_BY_DEBT.length - 1)] ?? 1;
}

function isMatureWord(word) {
  return Number(word?.interval) >= 1 && Number(word?.reviewCount) > 0;
}

/**
 * 会话内对单个词结算评分（每次出现评分后调用；recovery 词允许反复出现）。
 *
 * @param {object} word learnWords 记录
 * @param {number} rating 1=忘记 / 3=模糊 / 5=认识
 * @param {number} sessionDebt 本次会话累计 debt（模糊+1/忘记+2，认识不增加）
 * @param {number} now
 * @returns {object} 更新后的 word 字段（不写库，由调用方持久化）
 */
export function settleSessionReview(word = {}, rating, sessionDebt = 0, now = Date.now()) {
  const quality = [1, 3, 5].includes(Number(rating)) ? Number(rating) : 5;
  const debt = Math.max(0, Math.trunc(Number(sessionDebt) || 0));
  const currentStage = Math.max(0, Math.trunc(Number(word.recoveryStage) || 0));
  const base = { ...word };

  if (quality !== 5) {
    // 模糊/忘记：进入（或维持）recovery，目标 = max(现有 stage, debt 对应目标)
    const target = Math.max(currentStage, debtToRecoveryTarget(debt));
    return {
      ...base,
      recoveryStage: target,
      recoveryTarget: target,
      lastDebt: debt,
      nextReview: now,
      lastQuality: quality
    };
  }

  // 认识
  if (currentStage > 0) {
    const nextStage = currentStage - 1;
    if (nextStage > 0) {
      // 仍需后续巩固：保持 recovery，立即再次可复习（下次打开 App 优先出现）
      return {
        ...base,
        recoveryStage: nextStage,
        nextReview: now,
        lastQuality: 5
      };
    }
    // 恢复完成：进入长期 SRS，成熟词按 lastDebt 压缩，新词从短间隔重新开始
    const longTerm = scheduleReview(base, 5, now);
    const mature = isMatureWord(base);
    const interval = mature
      ? Math.max(MIN_INTERVAL_DAYS, Math.floor(Number(base.interval) * compressionForDebt(number(base.lastDebt))) || MIN_INTERVAL_DAYS)
      : Math.max(MIN_INTERVAL_DAYS, Number(longTerm.interval) || 1);
    return {
      ...base,
      ...longTerm,
      interval,
      nextReview: now + interval * 24 * 60 * 60 * 1000,
      recoveryStage: 0,
      recoveryTarget: 0,
      lastDebt: number(base.lastDebt)
    };
  }

  // 普通词直接认识：正常长期 SRS
  return { ...base, ...scheduleReview(base, 5, now), recoveryStage: 0, recoveryTarget: 0 };
}
