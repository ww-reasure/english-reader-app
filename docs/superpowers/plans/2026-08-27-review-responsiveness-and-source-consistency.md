# 单词复习响应与词库一致性修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让回忆复习和语境复习在评分、切换单词时立即响应，同时保证评分不丢失、不重复写入，并明确两种模式的词集差异。

**Architecture:** 将界面状态更新与数据库持久化解耦。评分先更新内存队列和界面，再由可恢复的后台写入队列串行保存 SRS、复习事件和会话快照；数据库层用 `attemptId + expectedRevision` 保证幂等和并发安全。两种正式复习继续共用 `learnWords` 与 `ReviewQueue`，只修正数量、语境筛选和会话显示口径。

**Tech Stack:** ES Modules、IndexedDB、localStorage、现有 `node:test`、Vite、Capacitor Android。

---

## Task 1：建立回归基线并写失败测试

**Files:**

- Create: `tests/review-persistence.test.mjs`
- Create: `tests/db-review-idempotency.test.mjs`
- Create: `tests/flashcard-review-performance.test.mjs`
- Create: `tests/context-review-performance.test.mjs`
- Create: `tests/review-source-consistency.test.mjs`

- [ ] 先运行 `node --test tests/*.test.mjs` 记录基线。
- [ ] 先写并运行失败测试：慢写入时界面先切换、双击评分只生成一个操作、session 保存合并、attemptId 重放幂等、两种模式共用 `learnWords`、回忆 20 个/语境 10 个、专项复习 SRS 不变。
- [ ] 每个测试必须因缺少目标行为失败，而不是因测试装配错误失败。

## Task 2：新增后台复习持久化协调器

**Files:**

- Create: `src/review-persistence.mjs`
- Modify: `src/review-session.mjs`

公开接口：

```js
createReviewPersistence({ db, storage, now, onStatus, retryDelays })
enqueueRating({ operationId, attemptId, wordId, expectedRevision, srsData, event })
enqueueSession({ key, snapshot })
flush({ timeoutMs })
replay()
getPendingWordIds()
getStatus()
```

- [ ] 评分写入先进入 localStorage journal，成功后才允许乐观切换；journal 只保存 ID、评分、revision、SRS 增量和事件元数据。
- [ ] 评分按顺序串行执行，失败按 250ms、1s、3s 重试；最终失败保留操作并提供重试状态。
- [ ] session 快照单飞写入，后来的快照覆盖尚未执行的旧快照。
- [ ] 保存前写轻量应急快照，IndexedDB 成功后按 sequence 清理；恢复时取最新 sequence。
- [ ] journal 或 localStorage 不可用时回退到同步保存，禁止静默丢评分。
- [ ] 页面隐藏、路由离开和应用启动分别触发 flush/replay；所有后台 Promise 都显式捕获。

## Task 3：让 IndexedDB 评分写入幂等

**Files:**

- Modify: `src/db.js`
- Test: `tests/db-review-idempotency.test.mjs`

- [ ] 数据库版本从 20 升至 21，仅为 `reviewEvents.attemptId` 增加非唯一索引，不重写旧数据。
- [ ] `DB.settleSessionReview()` 接收 `expectedRevision`、`attemptId`、`correlationId`。
- [ ] 同一事务先检查 attemptId；已存在则返回当前词，不增加 revision、不新增事件。
- [ ] revision 校验必须发生在同一事务内；冲突时不覆盖其他复习。
- [ ] 成功时保持 learnWords 与 reviewEvents 原子写入。
- [ ] 保留 `recordLearnWordReview()`、`recordLearnWordPractice()`、阅读评分和专项复习的既有语义。

## Task 4：重构回忆闪卡路径

**Files:**

- Modify: `src/views/flashcard.js`
- Test: `tests/flashcard-review-performance.test.mjs`

- [ ] 评分时先锁定重复点击、更新内存 `sessionQueue`、建立 attemptId、写 journal，然后立即渲染学习状态。
- [ ] SRS 与 reviewEvents 在后台串行写入；成功、失败、待重试状态显示在当前复习页面。
- [ ] 移除 `advanceToNextWord()` 的预保存，`renderCard()` 不再重复保存 session。
- [ ] session 每次切卡只 enqueue 一次；批量读取当前 session 单词并使用内存 Map，避免每张卡重复读库。
- [ ] 展示阶段不再执行重复的 `findLearnWordById()` 与 `revalidate()`；最终写入仍由 DB 的 expectedRevision 原子校验负责。
- [ ] 缺少释义时先渲染卡片，词典补全后台执行，并用 wordId/card token 防止旧结果污染新卡。
- [ ] practice 模式继续使用 `recordLearnWordPractice()`，不改变专项复习。

## Task 5：重构语境复习路径

**Files:**

- Modify: `src/views/context-review.js`
- Modify: `src/components/context-review.mjs`
- Test: `tests/context-review-performance.test.mjs`

- [ ] 评分结果先在内存显示，后台交给统一持久化协调器。
- [ ] `showCurrent()` 和 `next()` 不再在渲染前等待 session 保存，也不重复保存。
- [ ] 语境准备、例句/文章检索、AI 生成和翻译行为保持不变。
- [ ] 数据库提交继续使用 expectedRevision + attemptId；冲突时提示并重新读取当前词。

## Task 6：统一候选词源和数量说明

**Files:**

- Modify: `src/review-queue-coordinator.mjs`
- Modify: `src/review-queue.js`
- Modify: `src/views/review-mode.js`
- Test: `tests/review-source-consistency.test.mjs`

- [ ] 新增 `ReviewQueue.getDueSummary({ targetTrack })`，返回候选数、recovery 数、到期数、新词数及 recall/context 上限。
- [ ] 两种正式模式继续从 `learnWords → ReviewQueue` 取词；回忆最多 20 个，语境最多 10 个。
- [ ] 语境无句子的词只从语境结果排除，不修改正式词库。
- [ ] 页面区分候选数量、预计数量和语境准备后的实际可用数量。
- [ ] recovery 优先、archived 排除和专项复习隔离保持不变。

## Task 7：生命周期、诊断与完整验证

**Files:**

- Modify: `src/app.js`
- Add/update: `tests/*review*.test.mjs`

- [ ] 接入启动 replay、后台/路由离开 flush 和未完成操作诊断。
- [ ] 诊断只记录状态、耗时、数量和关联 ID，不记录 API Key、正文、文章全文、对话或完整输入。
- [ ] 按 TDD 顺序运行新增测试，再运行 `node --test tests/*.test.mjs`。
- [ ] 执行 `npm run build:private-qa` 与 `npm run build:apk`。
- [ ] 浏览器、手机和平板验证：评分立即反馈、下一词不等待、慢写入可恢复、重启不重复评分、两种模式数量说明正确。
- [ ] 只在全部测试和构建通过后提交当前分支；不合并、不推送、不修改 main。

## Acceptance Criteria

- 慢 IndexedDB 写入时评分和切卡仍立即产生可见界面反馈。
- 同一评分无论双击、重试还是重启 replay，都只产生一个 reviewEvent 和一次 revision 增长。
- session 快照最终一致，失败可恢复，不丢失队列进度。
- 回忆和语境共用同一正式词库，但数量限制和语境过滤透明可解释。
- 专项复习、阅读评分、真题评分和既有 SRS 行为不回归。
- 全量测试、私有 QA 构建和 Android APK 构建通过。

---

## Execution record (2026-08-27)

- Implemented the background rating journal, serialized retryable persistence,
  v21 `attemptId` idempotency/CAS, active-card session checkpoints, optimistic
  recall/context review transitions, and shared review-source summaries.
- Targeted regression suite: 28 passed, 0 failed.
- Full regression suite: 1288 tests, 1271 passed, 17 skipped, 0 failed.
- Private QA pack validation and APK build passed with version `2.0.0` / version
  code `45`.
- APK: `E:\\play\\claude\\EnglishReader-private-qa-v2.0.0-45-debug.apk`
- SHA-256: `B25496E396CF378A539CE36564E3021A3582FD3554F831A9F01E56E1408D9064`
- Automated browser contracts passed. Manual in-app browser smoke testing was
  not completed because the local browser runtime could not be initialized in
  this environment; no application data was changed by that attempt.
