import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SESSION_CONSTANTS,
  clearSessionQueue,
  createSessionQueue,
  loadSessionQueue,
  persistSessionQueue,
  sessionDebtValue
} from '../src/review-session.mjs';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key)
  };
}

test('忘记后隔 3 个其他词重新出现', () => {
  const queue = createSessionQueue([1, 2, 3, 4, 5]);
  assert.equal(queue.next(), 1);
  queue.rate(1, 1); // 忘记
  assert.equal(queue.getDebt(1), 2);

  assert.equal(queue.next(), 2);
  assert.equal(queue.next(), 3);
  assert.equal(queue.next(), 4);
  assert.equal(queue.next(), 5);
  assert.equal(queue.next(), 1, '隔 3 个词后重新出现');
  assert.equal(queue.isEmpty(), true);
});

test('模糊后隔 6 个其他词重新出现', () => {
  const queue = createSessionQueue([1, 2, 3, 4, 5, 6, 7, 8]);
  queue.next();
  queue.rate(1, 3); // 模糊
  assert.equal(queue.getDebt(1), 1);

  const order = [];
  let next;
  while ((next = queue.next()) !== null) order.push(next);
  assert.equal(order[0], 2);
  assert.equal(order.indexOf(1), 7, '隔 6 个其他词（2..7）后重新出现');
});

test('debt 累计：忘记=2、模糊=1、认识不增加', () => {
  const queue = createSessionQueue([1]);
  queue.next();
  queue.rate(1, 1);
  queue.next();
  queue.rate(1, 3);
  queue.next();
  queue.rate(1, 5);
  assert.equal(queue.getDebt(1), 3, '2 + 1，认识不增加');
  assert.equal(sessionDebtValue(1), 2);
  assert.equal(sessionDebtValue(3), 1);
  assert.equal(sessionDebtValue(5), 0);
});

test('单会话最多重插 3 次，超过后标记顽固词不再出现', () => {
  const queue = createSessionQueue([1, 2]);
  queue.next();
  queue.rate(1, 1); // 第 1 次
  queue.next(); // 2（主队列），buffer 中 1 的 remaining -> 2
  queue.next(); // 1（buffer 最早到点）
  queue.rate(1, 1); // 第 2 次
  queue.next(); // buffer 无其他词，1 直接再出
  queue.rate(1, 1); // 第 3 次
  queue.next();
  const outcome = queue.rate(1, 1); // 第 4 次 → 顽固
  assert.equal(outcome.stubborn, true);
  assert.equal(outcome.final, true);
  assert.equal(queue.isStubborn(1), true);

  assert.equal(queue.next(), null);
});

test('多个错词同时等待：remaining 最小者先出', () => {
  const queue = createSessionQueue([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  queue.next();
  queue.rate(1, 1); // 隔 3
  queue.next();
  queue.rate(2, 3); // 隔 6

  const order = [];
  let next;
  while ((next = queue.next()) !== null) order.push(next);
  const firstOf = order.indexOf(1);
  const secondOf = order.indexOf(2);
  assert.ok(firstOf >= 0 && secondOf >= 0);
  assert.ok(firstOf < secondOf, '忘记（隔 3）先于模糊（隔 6）重新出现');
});

test('只有 1~3 个词时无间隔可等待，直接顺序出', () => {
  const queue = createSessionQueue([1, 2, 3]);
  assert.equal(queue.next(), 1);
  queue.rate(1, 1);
  assert.equal(queue.next(), 2);
  assert.equal(queue.next(), 3);
  assert.equal(queue.next(), 1, '剩余唯一词直接出');
  assert.equal(queue.isEmpty(), true);
});

test('认识即 final，不再重插', () => {
  const queue = createSessionQueue([1, 2]);
  queue.next();
  const outcome = queue.rate(1, 5);
  assert.equal(outcome.final, true);
  assert.equal(outcome.reinserted, false);
  assert.equal(queue.next(), 2);
  assert.equal(queue.next(), null);
});

test('重插词记录最新 expectedRevision，避免被 revision 守卫误跳过', () => {
  const queue = createSessionQueue([1, 2, 3, 4, 5]);
  queue.next();
  queue.rate(1, 1, { expectedRevision: 7 });
  assert.equal(queue.getExpectedRevision(1), 7);

  // 再取词后同步（评分后 revision 变化）
  queue.syncExpectedRevision(1, 8);
  assert.equal(queue.getExpectedRevision(1), 8);

  const snap = queue.snapshot();
  assert.equal(snap.buffer.find(entry => entry.wordId === 1).expectedRevision, 8);
});

test('会话快照可持久化与恢复（断点续练）', async () => {
  const storage = memoryStorage();
  const queue = createSessionQueue([1, 2, 3, 4, 5, 6]);
  queue.next();
  queue.rate(1, 1);
  queue.next();
  await persistSessionQueue(queue, {
    db: {
      saveReviewSession: async session => storage.setItem('review-session-active', JSON.stringify(session))
    }
  });

  const restored = await loadSessionQueue({
    db: {
      getReviewSession: async () => JSON.parse(storage.getItem('review-session-active'))
    }
  });
  assert.equal(restored.getDebt(1), 2);
  assert.equal(restored.getPendingCount(), queue.getPendingCount());

  await clearSessionQueue({
    db: { deleteReviewSession: async () => storage.removeItem('review-session-active') }
  });
  assert.equal(storage.getItem('review-session-active'), null);
});

test('队列耗尽后 isEmpty', () => {
  const queue = createSessionQueue([1]);
  assert.equal(queue.isEmpty(), false);
  queue.next();
  queue.rate(1, 5);
  assert.equal(queue.isEmpty(), true);
  assert.equal(SESSION_CONSTANTS.FORGOT_SPACING, 3);
  assert.equal(SESSION_CONSTANTS.FUZZY_SPACING, 6);
  assert.equal(SESSION_CONSTANTS.MAX_REINSERT, 3);
});
