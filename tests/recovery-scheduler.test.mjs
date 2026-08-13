import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compressionForDebt,
  debtToRecoveryTarget,
  settleSessionReview
} from '../src/recovery-scheduler.mjs';

const NOW = Date.parse('2026-08-11T08:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

const mature = overrides => ({
  id: 1,
  word: 'settler',
  interval: 30,
  reviewCount: 8,
  easeFactor: 2.5,
  state: 'review',
  learningStep: null,
  lapseCount: 0,
  nextReview: NOW - DAY,
  reviewRevision: 4,
  ...overrides
});

test('直接认识：debt 0，不进入 recovery，正常长期 SRS', () => {
  const next = settleSessionReview(mature(), 5, 0, NOW);
  assert.equal(next.recoveryStage, 0);
  assert.equal(next.recoveryTarget, 0);
  assert.ok(next.nextReview > NOW);
  assert.ok(next.interval >= 30, '成熟词正常复习按难度系数顺延');
});

test('模糊后认识：debt 1 → Fragile（需 1 次成功）', () => {
  const failed = settleSessionReview(mature(), 3, 1, NOW);
  assert.equal(failed.recoveryStage, 1);
  assert.equal(failed.recoveryTarget, 1);
  assert.equal(failed.lastDebt, 1);
  assert.equal(failed.interval, 30, 'recovery 期间保留原 interval');
  assert.equal(failed.nextReview, NOW, '下次打开 App 即可优先复习');

  const recovered = settleSessionReview(mature({ recoveryStage: 1, recoveryTarget: 1, lastDebt: 1 }), 5, 0, NOW);
  assert.equal(recovered.recoveryStage, 0);
  assert.equal(recovered.interval, 30 * 0.6, '成熟词 1 次模糊后压缩为 0.6x');
});

test('忘记后认识：debt 2 → Relearning（需 2 次成功）', () => {
  const failed = settleSessionReview(mature(), 1, 2, NOW);
  assert.equal(failed.recoveryStage, 2);
  assert.equal(failed.lastDebt, 2);

  let word = { ...failed };
  word = settleSessionReview(word, 5, 0, NOW);
  assert.equal(word.recoveryStage, 1);
  word = settleSessionReview(word, 5, 0, NOW);
  assert.equal(word.recoveryStage, 0);
  assert.equal(word.interval, 30 * 0.3, '成熟词 1 次忘记后压缩为 0.3x');
});

test('忘记→忘记→模糊→认识：debt 5 → Difficult（需 3 次成功）', () => {
  const failed = settleSessionReview(mature(), 1, 5, NOW);
  assert.equal(failed.recoveryStage, 3);
  assert.equal(failed.recoveryTarget, 3);
  assert.equal(failed.lastDebt, 5);
  assert.equal(failed.interval, 30, '多次失败也不立即清空 interval');

  let word = failed;
  for (let i = 0; i < 3; i++) word = settleSessionReview(word, 5, 0, NOW);
  assert.equal(word.recoveryStage, 0);
  assert.equal(word.interval, Math.floor(30 * 0.15), '多次失败压缩为 0.15x（向下取整）');
});

test('recovery 中再次失误：newTarget = max(旧 stage, debt 目标)，不简单覆盖', () => {
  const difficult = settleSessionReview(mature(), 1, 4, NOW);
  assert.equal(difficult.recoveryStage, 3);

  const again = settleSessionReview(difficult, 1, 2, NOW);
  assert.equal(again.recoveryStage, 3, 'max(3, 2) = 3');
  assert.equal(again.lastDebt, 2);

  const onceMore = settleSessionReview(difficult, 1, 5, NOW);
  assert.equal(onceMore.recoveryStage, 3, 'max(3, 3) = 3');
});

test('fragile 恢复期一次认识即恢复', () => {
  const word = settleSessionReview(mature({ recoveryStage: 1, recoveryTarget: 1, lastDebt: 1 }), 5, 0, NOW);
  assert.equal(word.recoveryStage, 0);
  assert.equal(word.interval, 30 * 0.6);
  assert.ok(word.nextReview > NOW);
});

test('新词完成 recovery 后从 interval 1 重新开始', () => {
  const fresh = { id: 2, word: 'novice', interval: 0, reviewCount: 0, state: 'new', nextReview: null, reviewRevision: 0 };
  const failed = settleSessionReview(fresh, 1, 2, NOW);
  assert.equal(failed.recoveryStage, 2);

  let word = failed;
  word = settleSessionReview(word, 5, 0, NOW);
  assert.equal(word.recoveryStage, 1);
  word = settleSessionReview(word, 5, 0, NOW);
  assert.equal(word.recoveryStage, 0);
  assert.equal(word.interval, 1);
});

test('debt 目标映射与压缩系数', () => {
  assert.equal(debtToRecoveryTarget(0), 0);
  assert.equal(debtToRecoveryTarget(1), 1);
  assert.equal(debtToRecoveryTarget(2), 2);
  assert.equal(debtToRecoveryTarget(3), 2);
  assert.equal(debtToRecoveryTarget(4), 3);
  assert.equal(debtToRecoveryTarget(9), 3);
  assert.equal(compressionForDebt(0), 1);
  assert.equal(compressionForDebt(1), 0.6);
  assert.equal(compressionForDebt(2), 0.3);
  assert.equal(compressionForDebt(4), 0.15);
});

test('认识不会清空 lastDebt（轨迹保留在事件层）', () => {
  const failed = settleSessionReview(mature(), 1, 2, NOW);
  let word = failed;
  word = settleSessionReview(word, 5, 0, NOW);
  assert.equal(word.lastDebt, 2, '恢复过程保留 lastDebt 用于最终压缩');
  assert.equal(word.recoveryStage, 1);
});
