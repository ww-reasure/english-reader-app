# English Reader 整体性能与复习可靠性收口实施计划

> **给执行本计划的 AI：** REQUIRED SUB-SKILL：使用 `executing-plans`，在当前工作树中严格按 Task 0 → Task 8 单线程逐项执行。不要委派子代理，不要并行修改，不要切分支，不要清理或重置工作树。每完成一个检查项就在本文件把 `- [ ]` 改为 `- [x]`，并记录实际命令、结果和偏差。

**Goal:** 修复页面切换等待、正式复习后台保存缓慢/失败、结果分类错误、重插单词导致计数膨胀四个用户可见问题，并通过数据分片、复用读取和可观测性改进降低启动与复习路径开销。

**Architecture:** 保持现有无框架 ES Module SPA、IndexedDB `learnWords` 正式 SRS 事实源和 durable journal 架构。路由先同步挂载新页面骨架，再异步加载页面模块；复习会话用“本轮原始唯一词集”计算进度和结果，重插只改变呈现队列；评分先持久写入 localStorage journal，再乐观切卡，后台按单词有序、幂等地合并到 IndexedDB；大型真题词料按考试轨道分片并仅加载当前轨道。

**Tech Stack:** JavaScript ES Modules、Vite 8、Capacitor 8、IndexedDB、localStorage、`node:test`、`fake-indexeddb`、Android WebView。

---

## 0. 执行规则与当前工作区事实

这是一个“继续收口”的计划，不是从干净分支重新实现。当前工作树已经包含部分实现和测试，执行者必须先审计，再补缺口。

### 不可破坏的工作区边界

- 仓库根目录：`E:\play\claude\english-reader\mobile`
- 当前分支：`feat/english-practice-machine`
- 跟踪关系：`private/main`
- 禁止执行：`git reset`、`git checkout --`、`git clean`、切换分支、变基、合并、推送。
- 用户原有且与本计划不可混淆的文件：
  - `src/views/reading.js`
  - `tests/reading-completion-recovery.test.mjs`
  - `PROJECT_STATUS.md`
- 上述三个文件默认只读。除 Task 8 经核对后追加 `PROJECT_STATUS.md` 的本次结果外，不要修改、暂存或提交它们。
- `www/`、`android/app/src/main/assets/public/`、APK 和哈希文件是构建产物，不手工编辑、不提交。
- 不修改 IndexedDB 现有数据，不清理 localStorage journal，不用真实用户数据做破坏性测试。
- 未得到明确提交授权时不要执行 `git commit`。每个 Task 结尾给出“建议提交边界”，供用户或审查者决定。

### 当前部分实现，必须保留并独立复核

| 子系统 | 当前部分实现 | 当前相关文件 |
|---|---|---|
| 会话指标 | 固定原始词 ID、按单词记录首次/最弱/最后评级、按 `attemptId` 去重、快照恢复、当天最弱评级合并 | `src/review-session-metrics.mjs`、`src/views/flashcard.js`、`tests/review-session-metrics.test.mjs` |
| 后台持久化 | v2 rating intent、v1 journal 迁移、幂等 attempt、revision 冲突重放、按单词顺序、`rating_idle`、错误码 | `src/review-persistence.mjs`、`src/review-persistence-status.mjs`、`src/db.js`、相关 DB/持久化测试 |
| 队列读取 | `getDueWords/getDueSummary` 可接收一次读取的 `words` 快照，避免重复全库读取 | `src/review-queue-coordinator.mjs`、`src/views/flashcard.js`、`src/views/review-mode.js` |
| 路由 | 页面动态 import、即时骨架、导航 token、异步 cleanup | `src/router.js`、`src/router-routes.mjs`、`src/router-navigation.mjs`、`tests/router-performance.test.mjs` |
| 真题词料 | schema 2 小清单、按 CET4/CET6/考研分片、选中轨道预加载、schema 1 兼容 | `src/exam-corpus.mjs`、`src/exam-corpus-runtime.mjs`、`scripts/build-exam-corpus.mjs`、`public/data/exam-corpus-*` |

### 已知但尚未全部独立复核的验证记录

- 本轮改动前基线曾记录：1403 tests，1386 passed，17 skipped，0 failed。
- 当前会话指标定向测试曾记录：41/41 passed。
- 当前持久化定向测试曾记录：31/31 passed。
- 当前词料/队列定向测试曾记录：25/25 passed。
- 路由相关 76/76 和全量 1424/1424 是此前执行过程中的报告，尚未由最终审查者在当前完整工作树独立复跑，不能直接作为完成证据。
- `PROJECT_STATUS.md` 中 1402/1385/17 是本轮修改之前的交接记录；最终必须用新鲜结果更新，不能混用数字。

### 本计划的 TDD 规则

- 现有测试如果已经通过，不要为了“看到 RED”回滚当前实现。
- 对每个新发现的缺口：先添加一个能准确复现缺口的失败测试；确认失败原因正确；再做最小修复；最后复跑同一测试与相邻回归测试。
- 禁止只写源码字符串匹配来代替关键行为测试。源码契约测试可以保留，但必须有行为测试覆盖状态变化、异步竞态和持久化结果。
- 每个 Task 只修改该 Task 的文件；发现跨域问题时记录到对应后续 Task，不顺手扩大范围。

---

## 产品口径：四个问题的唯一验收语义

### 1. 页面跳转

- 点击导航或 hash 变化后，新页面的 AppShell/骨架必须立即出现；不得等待旧页面 cleanup、动态模块下载、IndexedDB 查询或页面业务数据完成。
- 模块和业务数据加载期间可显示当前纸张主题的轻量 loading skeleton。
- 快速 A → B → A 时，只允许最后一次导航拥有当前页面；旧 render、旧错误和旧 cleanup 不得污染最终页面。
- 页面完成加载后不保留前一页事件监听器、定时器和对象 URL。

### 2. 正式复习保存

- 用户点击“认识/模糊/忘了”后，只有 journal 写入成功才允许切卡；journal 写入是快速本地持久化，不等待 IndexedDB。
- UI 在 100 ms 内给出评分反馈并切卡；IndexedDB 写入在后台完成。
- 同一 `attemptId` 无论双击、重试、重启 replay，都只增加一次 `reviewRevision`，只写一个正式 review event。
- revision 冲突采用“安全合并评级”：在最新词状态上重放用户明确评级，不用旧完整 `srsData` 覆盖新状态。
- 同一单词的多个评分严格按 journal 顺序执行；前一个永久失败时，后一个不得越过。
- journal 清空且当前写入结束后，结果页必须离开“正在保存”，显示“已保存”。
- 有失败记录时必须显示失败数量、稳定错误码和“重试”；不得永远显示“保存中”。
- 旧 v1 journal 中可识别的待同步记录必须迁移并重放，不能因升级而丢弃。

### 3. 复习结果分类

- 结果页每个原始单词只出现一次。
- 结果分类以该词在本轮的“最弱明确评级”为准：
  - 本轮只有认识 → 认识。
  - 先模糊、后认识 → 模糊。
  - 任意一次忘了、后来认识 → 忘记。
- “本轮学会率”按最终是否达到认识计算；因此一个词可以计入已学会，同时仍在结果页归入“模糊/忘记”，用于反映真实过程。
- 当天累计记录合并同一单词时，也保留当天最弱评级，不被后来“认识”覆盖成全认识。

### 4. 重插与进度

- 分母 `N` 是开始本轮时的原始唯一词数，通常为 20；整个会话固定不变。
- 顶部显示“已学会 X / N”，而不是“当前队列位置 / 膨胀后队列长度”。
- 第一次把某词评为认识时，`X` 增加 1；同词重插后再次认识不重复增加。
- 模糊/忘记只改变重插队列和最弱评级，不能增加分母，也不能直接增加已学会数。
- 进度条使用 `X / N`，保持在 0%–100%，不得出现 24/24、超过 100% 或越复习分母越大。

---

## Task 0：冻结现场并建立新鲜验证基线

**Files:**

- Read only: `PROJECT_STATUS.md`
- Read only: all current changes
- Update only checkboxes/records: `docs/superpowers/plans/2026-08-29-app-performance-review-reliability.md`

- [x] 进入仓库后运行并记录：

```powershell
git rev-parse --show-toplevel
git branch --show-current
git status --short --branch
git diff --stat
git diff --check
```

Expected:

- 顶层必须是 `E:/play/claude/english-reader/mobile`。
- 分支必须是 `feat/english-practice-machine`。
- `git diff --check` 退出码为 0。
- 工作树不干净是预期，不得因此清理。

- [x] 将当前变更按“用户原有”“本计划部分实现”“本计划文件”三类记录到本 Task 下方的执行记录。
- [x] 确认没有遗留开发服务器占用 Vite/HMR 测试端口；如测试只出现 `24678 already in use` 警告，先停止本任务启动的服务器再重跑，不修改测试来掩盖端口冲突。
- [x] 依次运行以下定向基线，不并行：

```powershell
node --test tests/review-session-metrics.test.mjs tests/review-session.test.mjs tests/flashcard-two-stage.test.mjs tests/review-v2-performance-contract.test.mjs
node --test tests/review-persistence.test.mjs tests/review-result-persistence-status.test.mjs tests/db-review-settle.test.mjs tests/db-review-idempotency.test.mjs
node --test tests/review-queue-coordinator.test.mjs tests/exam-corpus-build.test.mjs tests/exam-corpus-runtime.test.mjs
node --test tests/router-performance.test.mjs tests/exam-router.test.mjs tests/unified-vocabulary-routing.test.mjs
```

- [x] 任一现有测试失败时，先判断是当前实现缺陷、测试装配问题还是用户原有改动；在对应 Task 中修，不在 Task 0 改业务代码。
- [x] 记录每条命令的 tests/pass/fail/skip/耗时。

#### Task 0 变更分类记录

- 用户原有（只读，未触碰）：`src/views/reading.js`、`tests/reading-completion-recovery.test.mjs`、`PROJECT_STATUS.md`（后两者为 untracked）。
- 本计划文件：`docs/superpowers/plans/2026-08-29-app-performance-review-reliability.md`（untracked，仅勾选与追加执行记录）。
- 本计划部分实现（跟踪修改，共 45 个文件）：核心为 `src/review-session-metrics.mjs`、`src/review-persistence.mjs`、`src/review-persistence-status.mjs`、`src/db.js`、`src/review-queue-coordinator.mjs`、`src/views/flashcard.js`、`src/views/review-mode.js`、`src/router.js`、`src/router-routes.mjs`（untracked 新文件）、`src/router-navigation.mjs`（untracked 新文件）、`src/exam-corpus.mjs`、`src/exam-corpus-runtime.mjs`、`scripts/build-exam-corpus.mjs`、`public/data/exam-corpus-index.json`、`public/data/exam-corpus-tracks/`（untracked 新目录）；其余为相应测试文件。抽查确认：约 20 个 DB/exam 测试的改动仅为 `recovery-scheduler.mjs` import URL 装配适配；router 相关契约测试改动为适配新 `router-routes.mjs` 结构，未改变业务断言语义。
- 完整 diff 统计：45 files changed, 984 insertions(+), 275 deletions(-)。

#### Task 0 基线验证记录

- 冻结命令：顶层 `E:/play/claude/english-reader/mobile` ✓；分支 `feat/english-practice-machine`（跟踪 `private/main`）✓；`git diff --check` 退出码 0 ✓；工作树不干净（45 M + 8 ??）符合预期，未做任何清理。
- 端口检查：`netstat` 未发现 5173/24678/4173 占用，无遗留 dev server。
- 批次1 `review-session-metrics/review-session/flashcard-two-stage/review-v2-performance-contract`：41 tests / 41 pass / 0 fail / 0 skip / 124 ms —— 与计划记录 41/41 一致。
- 批次2 `review-persistence/review-result-persistence-status/db-review-settle/db-review-idempotency`：31 tests / 31 pass / 0 fail / 0 skip / 1366 ms —— 与计划记录 31/31 一致。
- 批次3 `review-queue-coordinator/exam-corpus-build/exam-corpus-runtime`：22 tests / 22 pass / 0 fail / 0 skip / 163 ms（coordinator 6、build 12、runtime 4）—— 计划历史记录为 25/25，当前同命令实得 22/22，差异为部分实现期间测试合并/精简所致，0 fail，不构成阻塞；已在执行记录中注明。
- 批次4 `router-performance/exam-router/unified-vocabulary-routing`：13 tests / 13 pass / 0 fail / 0 skip / 85 ms（计划记录的路由 76/76 含 exam-view-contract、calibration-view-contract 等更广集合，将在对应 Task 验证）。
- 结论：无需在 Task 0 修改任何业务代码。

**建议提交边界：** 无提交；Task 0 只读。

---

## Task 1：收口本轮唯一词数、已学会进度和最弱评级结果

**Files:**

- Modify: `src/review-session-metrics.mjs`
- Modify: `src/views/flashcard.js`
- Test: `tests/review-session-metrics.test.mjs`
- Test: `tests/review-v2-performance-contract.test.mjs`
- Test: `tests/flashcard-two-stage.test.mjs`
- Create if behavior coverage is still missing: `tests/flashcard-session-behavior.test.mjs`

### 1.1 审计纯状态模型

- [x] 确认 `createReviewSessionMetrics()` 的输入是“开始时原始唯一 wordId 列表”，内部保存固定 `originalWordIds`，不引用会被 `renderCard()` 重插而增长的 `this.words`。
- [x] 确认重复 wordId 在初始化时去重，字符串/数字 ID 的规范化与现有 DB ID 语义一致。
- [x] 确认 `recordRating({ attemptId, wordId, quality })`：
  - 同一 `attemptId` 重放是 no-op。
  - 只处理原始词集中的 wordId。
  - `quality >= 4` 表示该词最终已学会。
  - 最弱评级使用本轮出现过的最低 quality。
  - 首次、最后一次评级用于恢复和诊断，但不替代最弱评级。
- [x] 确认 snapshot/restore 保留 original IDs、已处理 attempt IDs、每词最弱/最后评级；旧 session 没有新字段时能安全初始化，而不是把全体默认为认识。
- [x] 确认 `mergeTodayReviewedWord(existing, incoming)` 使用最弱评级合并同日同词，同时保留必要显示字段。

### 1.2 补齐纯逻辑测试

- [x] 若不存在，先写以下失败测试，再最小修复：
  1. 原始 20 词中 4 个先弱后认识，队列实际展示 24 次，最终 `total=20`、`learned=20`、结果唯一 20 条，其中 4 条仍为弱分类。
  2. 同一 attempt 重放两次，不改变 learned、最弱评级和结果条数。
  3. 同一词“模糊 → 忘记 → 认识”最终学会但分类为忘记。
  4. session snapshot 在“模糊后、重插前”恢复，继续认识后不丢最弱评级。
  5. 原始输入含重复 ID，分母仍按唯一词数。
  6. 非原始词或无效 quality 不污染本轮结果。

测试应直接断言结构化结果，例如：

```js
assert.equal(summary.total, 20);
assert.equal(summary.learned, 20);
assert.equal(summary.words.length, 20);
assert.equal(summary.fuzzy, 3);
assert.equal(summary.forgotten, 1);
```

### 1.3 审计 FlashcardView 集成

- [x] 确认正式复习在取得最终 dueWords 后只初始化一次 metrics；practice 模式保持原路径，不调用正式 SRS metrics/intent 写入。
- [x] 确认每一次 journal 已接受的正式评分都在任何 `return`/重插分支之前调用 metrics；尤其检查“模糊/忘记触发重插后提前返回”的路径。
- [x] 确认结果页只读取 metrics 的唯一词 summary，不从增长后的 `this.words`、当前位置或旧 `todayReviewed` 临时数组重新推导。
- [x] 确认 `renderProgress()` 显示“已学会”，分母为固定 total，进度条为 `learned / total`。
- [x] 确认重插仍由现有 recovery/session queue 负责，不因修指标而改变 SRS `nextReview`、`interval`、`easeFactor`、`reviewCount`、`reviewRevision`。
- [x] 确认“跳过”保持现有非评级语义：不伪造认识、不增加 learned、不写正式评分；如果现有产品行为会重排，测试固定该行为。
- [x] 增加一个行为级测试，驱动 FlashcardView 或抽出的控制器完成 20 词混合评分，断言渲染文案、分母、结果分类和写入调用。不得只用正则匹配源码。

### 1.4 定向验证

- [x] 运行：

```powershell
node --test tests/review-session-metrics.test.mjs tests/flashcard-session-behavior.test.mjs tests/review-session.test.mjs tests/flashcard-two-stage.test.mjs tests/review-v2-performance-contract.test.mjs tests/review-practice-view-contract.test.mjs
```

- [x] 若没有创建 `tests/flashcard-session-behavior.test.mjs`，从命令中删除该文件名，并在执行记录中说明已有哪个行为测试等价覆盖；不能以源码契约测试代替。
- [x] `git diff --check` 必须通过。

**建议提交边界：** `review: keep recall progress and results word-based`

---

## Task 2：收口评分 journal、冲突安全合并、重试与“保存中”状态

**Files:**

- Modify: `src/review-persistence.mjs`
- Modify: `src/review-persistence-status.mjs`
- Modify: `src/db.js`
- Modify: `src/views/flashcard.js`
- Test: `tests/review-persistence.test.mjs`
- Test: `tests/review-result-persistence-status.test.mjs`
- Test: `tests/db-review-settle.test.mjs`
- Test: `tests/db-review-idempotency.test.mjs`
- Review only unless a loader fix is necessary: all DB tests currently changed by the new `recovery-scheduler.mjs` import adaptation

### 2.1 固定 rating intent 契约

- [x] 确认 journal v2 每个正式评分至少保存：`operationId`、`attemptId`、`wordId`、`quality`、`expectedRevision`、时间、关联 ID、状态、重试次数和 `nextRetryAt`。
- [x] journal 不保存或依赖一个可覆盖新状态的完整旧 `srsData`；数据库提交必须在最新 learnWord 上调用现有 `SpacedRepetition.calculateNext()` / 正式调度逻辑重放明确 quality。
- [x] `DB.applyReviewRatingIntent(id, intent, options)` 在单个 IndexedDB transaction 内完成：
  1. 按 attemptId 检查已提交事件；存在则返回幂等成功。
  2. 读取当前 learnWord/revision。
  3. 若 revision 不同，基于最新行安全重算本次 rating，而不是覆盖。
  4. 原子更新 learnWords 并写 reviewEvent。
- [x] 保持 `learnWords` 为正式 SRS 唯一事实源；不得改为 `vocabulary`。
- [x] 保持 `DB.addReviewEvent()` 非调度路径、专项练习路径和阅读评分路径的既有语义。

### 2.2 先补并发和恢复缺口测试

- [x] 确认并保留以下已有测试；缺哪个先写失败测试：
  - 同一 attempt 重放只写一个 event、revision 只加一次。
  - revision conflict 后在最新状态上应用明确评级。
  - 同一 word 的后续操作不会越过失败的前序操作。
  - 一个 word 阻塞不会破坏其他 word 已提交结果的可见状态；若实现选择全局串行，测试其确定顺序而非假定并行。
  - v1 journal 可迁移行在 replay 后进入 v2 intent。
  - 可识别但 payload 损坏的行保留为 `DATA_CORRUPT`，不会被 retry 当作有效 rating 执行。
  - `flush()` 面对全部处于未来 `nextRetryAt` 的行时及时返回当前状态，不忙等到 timeout。

- [x] 新增“更早重试时间重排 timer”测试：先排一个较晚 timer，再加入更早到期操作；断言旧 timer 被取消，新 timer 指向更早时间。
- [x] 为实现该行为，持久化协调器必须同时记录 `retryTimer` 和 `retryTimerAt`；当新最早时间早于现有 timer 时清除并重建。只判断 `retryTimer !== null` 不足以通过。
- [x] 新增“最后一条成功后 idle”测试：最后一次 `rating_completed` 发生时，即使内部尚处 running，也必须在 finally 结束后再发一次 `rating_idle`，其状态为：

```js
{
  pending: 0,
  failed: 0,
  running: false,
  nextRetryAt: 0
}
```

- [x] 新增旧 14 条 v1 journal 的批量迁移测试：混合成功、revision conflict、临时失败和永久损坏；可识别有效行全部最终提交，永久损坏行保持可见失败，不出现无期限 running。
- [x] 对完全没有稳定 ID、无法重放的原始对象，不得静默过滤。将其保留为失败/隔离诊断记录，错误码为 `DATA_CORRUPT`，且日志不得包含单词释义、文章正文或用户隐私。

### 2.3 修正状态推导与结果页文案

- [x] `deriveReviewPersistenceStatus()` 只在 `running === true` 或 `pending > 0` 时显示“正在保存”。
- [x] 当 `failed > 0` 且没有实际运行任务时显示“还有 N 条复习记录待同步”和“重试”按钮；显示稳定 `errorCodes`，不要显示原始异常堆栈。
- [x] 当 journal 为空且不 running 时显示“已保存”，即使最后收到的业务事件类型曾是 `rating_completed`。
- [x] 点击“重试”只把可重试失败行重置为 queued；`DATA_CORRUPT` 行保持失败并提示需要导出诊断，不能循环执行坏数据。
- [x] 页面离开/应用隐藏触发有界 flush，但导航不能等待它完成；后台 Promise 必须 catch 并更新状态。
- [x] 结果页销毁后 status listener 被移除，不产生跨页面 DOM 更新。

### 2.4 定向验证

- [x] 运行：

```powershell
node --test tests/review-persistence.test.mjs tests/review-result-persistence-status.test.mjs tests/db-review-settle.test.mjs tests/db-review-idempotency.test.mjs tests/db-review-events.test.mjs tests/db-review-practice.test.mjs tests/context-review-view.test.mjs
```

- [x] 用 fake IndexedDB 验证每个成功 attempt 的 learnWord 和 reviewEvent 同事务一致；失败注入时两者都不部分提交。
- [x] 检查当前许多 DB 测试中的 import URL 改写。它们若只为装配新增静态依赖，应保持最小、统一；不得顺便改变业务断言。
- [x] `git diff --check` 必须通过。

**建议提交边界：** `fix: make review rating replay ordered and observable`

---

## Task 3：消除复习入口重复读库并验证真题词料按轨道加载

**Files:**

- Modify: `src/review-queue-coordinator.mjs`
- Modify: `src/views/review-mode.js`
- Modify: `src/views/flashcard.js`
- Modify: `src/exam-corpus.mjs`
- Modify: `src/exam-corpus-runtime.mjs`
- Modify: `scripts/build-exam-corpus.mjs`
- Generated: `public/data/exam-corpus-index.json`
- Generated: `public/data/exam-corpus-tracks/cet4.json`
- Generated: `public/data/exam-corpus-tracks/cet6.json`
- Generated: `public/data/exam-corpus-tracks/kaoyan-general.json`
- Test: `tests/review-queue-coordinator.test.mjs`
- Test: `tests/exam-corpus-build.test.mjs`
- Test: `tests/exam-corpus-runtime.test.mjs`

### 3.1 单次 learnWords 快照

- [x] `ReviewModeView.render()` 只调用一次 `DB.getAllLearnWords()`，把同一快照传给 `ReviewQueue.getDueSummary({ words })`。
- [x] `FlashcardView` 已有 allWords 时，把快照传给 `ReviewQueue.getDueWords({ words })`，不让 coordinator 再读一次全库。
- [x] coordinator 对未提供 snapshot 的旧调用方保持兼容；提供 snapshot 时数据库读取计数必须为 0。
- [x] snapshot 只用于候选计算；正式提交仍由 DB transaction 读取最新 learnWord 并做 revision/attempt 幂等，不能把快照当提交事实。
- [x] 增加 spy 测试断言入口一次读取、coordinator 零次重复读取。

### 3.2 schema 2 分片契约

- [x] `public/data/exam-corpus-index.json` 只包含版本、轨道元信息、数量、校验信息和相对分片路径，不再内嵌全部单词映射。
- [x] 每个 track artifact 必须包含自己的 track、版本、words 和可验证计数；validator 拒绝 track 不匹配、schema 错误和无效结构。
- [x] runtime 首次查词只 fetch 当前选中轨道；同轨道后续查询使用 Promise/cache，不重复 fetch。
- [x] `preload(track)` 只预加载传入轨道；复习入口在 idle 时预加载 `Config.get('exam_level')`，不得阻塞页面骨架和队列显示。
- [x] 保留 schema 1 legacy index fallback；旧缓存/旧离线包不因 schema 2 立即崩溃。
- [x] `findAcrossTracks` 等明确跨轨道能力可以按需加载所有轨道，但普通当前轨道查询不得触发它。

### 3.3 构建确定性与产物范围

- [x] 连续运行两次构建并比较四个 JSON 的 SHA-256。不要用脏工作树的 `git diff --exit-code` 作为确定性判断。

```powershell
npm run exam-corpus:build
Get-FileHash public/data/exam-corpus-index.json, public/data/exam-corpus-tracks/cet4.json, public/data/exam-corpus-tracks/cet6.json, public/data/exam-corpus-tracks/kaoyan-general.json -Algorithm SHA256
npm run exam-corpus:build
Get-FileHash public/data/exam-corpus-index.json, public/data/exam-corpus-tracks/cet4.json, public/data/exam-corpus-tracks/cet6.json, public/data/exam-corpus-tracks/kaoyan-general.json -Algorithm SHA256
```

- [x] 两轮相同文件的 hash 必须完全一致。
- [x] 清单体积应保持在小型元数据量级，不再约 3.7 MB；三个分片总内容完整，测试核对词数/例句数与源数据。
- [x] 运行：

```powershell
node --test tests/review-queue-coordinator.test.mjs tests/exam-corpus-build.test.mjs tests/exam-corpus-runtime.test.mjs tests/review-v2-performance-contract.test.mjs
npm run exam-corpus:verify
```

- [x] `git diff --check` 必须通过。

**建议提交边界：** `perf: reuse review snapshots and shard exam corpus`

---

## Task 4：收口路由即时切换与异步生命周期竞态

**Files:**

- Modify: `src/router.js`
- Modify: `src/router-routes.mjs`
- Modify: `src/router-navigation.mjs`
- Test: `tests/router-performance.test.mjs`
- Test: `tests/exam-router.test.mjs`
- Test: `tests/unified-vocabulary-routing.test.mjs`
- Add behavior tests in: `tests/router-performance.test.mjs`

### 4.1 路由表完整性

- [x] 对照旧 `src/router.js` 和当前所有 `#/...` 导航入口，逐条确认 route match、参数解析、view export、AppShell section/title 完整。
- [x] 根路由、聊天、阅读详情、历史、词库、复习入口、回忆复习、专项复习、语境复习、设置、统计、报告、校准、阅读列表、全部真题页面和兼容旧路由必须保留。
- [x] 对参数路由先移除 query，再安全 `decodeURIComponent`；非法编码不得抛出导致整个 Router 停止。
- [x] 不让 `#/exam/practice/`、`#/exam/result/`、`#/reading/` 这类缺少 ID 的 hash 进入业务 view；应落到明确 not-found/error shell。
- [x] `startsWith` 不能误匹配相似前缀，例如 `#/exam/practice-extra/...`。

### 4.2 即时骨架顺序

- [x] `navigate()` 的顺序必须是：
  1. 增加 navigation token。
  2. 解析路由并同步 mount 新 AppShell/骨架。
  3. 启动旧 view cleanup，但不等待其 Promise 才显示新 shell。
  4. 异步 load 新 view module。
  5. token 仍为当前时才调用 render。
  6. render 完成后 token 仍为当前才记录完成/处理状态。
- [x] 动态 import 失败时，只允许当前 token 的 outlet 显示错误；过期导航的拒绝不得覆盖新页面。
- [x] cleanup 同步异常和 Promise rejection 必须被捕获、记录并释放引用，但不得阻止新页面。

### 4.3 A → B → A 和 singleton view 竞态

当前实现把 `state.currentView` 设为新 singleton 后再 await `view.render()`；快速第二次导航可能在第一次 render 未完成时 cleanup 同一实例。必须用行为测试明确并修正。

- [x] 先添加“stale load rejection”测试：A 的 loader 延迟并最终 reject，B 已成功显示；断言 B outlet 无错误文案。
- [x] 添加“stale render resolution”测试：A 已开始异步 render，B 完成后 A 才 resolve；断言当前 DOM 和 controller.currentView 仍为 B。
- [x] 添加“A → B → A singleton”测试：第一次 A render/cleanup 尚未结束，第二次 A 到来；断言没有交叉释放第二次 A 的 listener/state，也没有重复挂载。
- [x] 添加“cleanup rejection”测试：旧 view cleanup reject，新 shell 和新 view 仍完成。
- [x] 添加“同一路由连续触发”测试：只保留最新导航，旧 outlet 被解除引用。
- [x] 如果 singleton view 无法安全支持并发生命周期，为每次导航引入独立 lifecycle generation/context，并要求 view 的异步回调校验 generation；不要通过等待全部旧 cleanup 重新引入页面切换卡顿。
- [x] 旧 render 可以继续操作其已脱离 DOM 的 outlet，但不得修改共享 singleton 当前代状态。必要时把每次 render 状态移入局部 context，cleanup 接收 generation，仅清理本代资源。

### 4.4 行为验证与 bundle 验证

- [x] 行为测试使用可控 Promise 和最小 fake DOM；断言调用顺序与最终 ownership，不只正则匹配 `import()`。
- [x] 运行：

```powershell
node --test tests/router-performance.test.mjs tests/exam-router.test.mjs tests/unified-vocabulary-routing.test.mjs tests/exam-view-contract.test.mjs tests/calibration-view-contract.test.mjs
npx vite build --mode public
```

- [x] 检查构建输出：各主要 view 应形成 lazy chunks；入口 chunk 不得重新静态打入所有 view。
- [x] 记录入口 JS 原始大小和 gzip 大小。改动前曾约 1.56 MB raw / 502 KB gzip；收口后入口 raw 必须明显下降，目标不超过 700 KB。若超过，先用 Vite 输出定位重新静态引入链，不直接放宽目标。
- [x] `git diff --check` 必须通过。

**建议提交边界：** `perf: mount route shells before lazy view work`

---

## Task 5：添加低成本性能与同步状态证据

**Files:**

- Modify: `src/router-navigation.mjs`
- Modify: `src/review-persistence.mjs`
- Modify only if existing logging adapter requires: `src/diagnostic-logger.mjs`
- Test: `tests/router-performance.test.mjs`
- Test: `tests/review-persistence.test.mjs`

### 5.1 路由时序

- [x] 使用现有诊断基础设施记录四个无敏感内容的阶段：`route_started`、`route_shell_mounted`、`route_module_loaded`、`route_render_completed`。
- [x] 每条记录只包含 route 类型、navigation correlation ID、token、阶段耗时和结果；不记录完整 URL 参数、文章 ID 原文、查询串或页面内容。
- [x] 使用单调时钟 `performance.now()`（无则回退注入的 `now()`）计算 duration，测试注入假时钟。
- [x] stale navigation 记录 `superseded`，不记录为当前页面错误。

### 5.2 评分保存时序

- [x] 记录 `rating_journaled`、`rating_write_started`、`rating_completed`、`rating_retry_scheduled`、`rating_idle`，使用 operationId/correlationId 和耗时，不记录释义/例句/正文。
- [x] 断言一个成功评分的事件顺序完整，最后一定有 `rating_idle`。
- [x] 断言 permanent failure 最终状态包含稳定错误码与 next action，不停留 running。

### 5.3 性能门槛

- [x] 自动测试只断言架构顺序和无阻塞，不用 CI 绝对时间做脆弱判断。
- [x] 手动真机/浏览器证据使用以下门槛：
  - 导航点击到新 shell 可见：目标 ≤100 ms。
  - 评分点击到按钮反馈/下一卡：目标 ≤100 ms。
  - journal 已空后结果页离开“保存中”：目标 ≤1 s。
  - 当前考试轨道 corpus 首次加载后，同轨道重复查词不得再次 fetch。

- [x] 运行：

```powershell
node --test tests/router-performance.test.mjs tests/review-persistence.test.mjs tests/diagnostic-db.test.mjs
```

- [x] `git diff --check` 必须通过。

**建议提交边界：** `chore: add privacy-safe route and review timing evidence`

---

## Task 6：按用户截图场景做浏览器手动验收

**Files:**

- No source changes unless a reproduced bug first receives an automated failing test in its owning Task.
- Record results in this plan under Task 6 execution record.

### 6.1 准备

- [x] 启动一次私有 QA 开发服务器：

```powershell
npm run dev
```

- [x] 使用测试数据或独立测试 profile 准备恰好 20 个正式到期词；不要删除或批量改写真实用户 learnWords。
- [x] 打开浏览器诊断面板/应用诊断导出，只观察本轮相关 correlation IDs。

### 6.2 页面切换

- [x] 依次测试：首页 → 复习入口 → 回忆复习 → 返回复习入口 → 词库 → 阅读列表 → 真题首页。
- [x] 每次点击后立即看到目标页面 shell/骨架，旧页面不继续覆盖。
- [x] 快速连续执行“复习入口 → 词库 → 复习入口”，最终只显示复习入口，无旧页报错、闪回或重复监听。
- [ ] 在模拟慢网下测试 lazy chunk；骨架立即出现，模块完成后正常渲染。

### 6.3 20 词混合评分

- [x] 对 20 个词使用以下固定评分序列：12 个只点认识；4 个先模糊后认识；4 个先忘了后认识。
- [x] 任意时刻顶部都显示 `已学会 X / 20`，分母不变，X 单调且不超过 20。
- [x] 模糊/忘了导致的重插可以让实际展示次数超过 20，但不能出现 24/24 或进度超过 100%。
- [x] 全部原始词最终认识后结果页应为：总复习 20、已学会 20、模糊 4、忘记 4、纯认识 12、本轮学会率 100%。
- [x] 当天累计列表同一词只出现一次，弱评级不被后续认识覆盖。

### 6.4 慢写入和失败恢复

- [x] 用测试注入让 IndexedDB 写入延迟 2–3 秒；评分切卡仍 ≤100 ms，结果页先显示待保存，完成后自动变已保存。
- [x] 注入临时失败：状态显示待同步和重试时间；自动或手动重试成功后失败数归零。
- [x] 注入永久损坏行：显示失败和“重试/导出诊断”边界，不永久显示 running，不重复提交坏行。
- [x] 在仍有有效 journal 时刷新/重启：replay 后有效评分只提交一次，结果页最终归零。
- [x] 验证用户此前看到的“还有 14 条复习记录待同步”场景：迁移/重放过程可见，最终有效条目清零；若有坏条目，准确显示坏条目数量和错误码。

### 6.5 记录证据

- [ ] 记录浏览器、Android 机型/系统、构建 flavor、开始/结束时间。
- [x] 记录上述四个性能门槛的代表值和诊断事件序列。
- [ ] 截图至少包括：固定 20 分母、混合结果分类、已保存状态、失败可重试状态。
- [x] 停止本 Task 启动的开发服务器，确保不遗留端口占用。

**建议提交边界：** 无提交；手动验证阶段只产出记录。

---

## Task 7：全量回归、构建与 Android 验证

**Files:**

- No new business changes. Any failure returns to its owning Task with a failing regression test.

- [x] 按顺序运行，不并行：

```powershell
node --test tests/*.test.mjs
git diff --check
npm run exam-corpus:verify
npx vite build --mode public
npm run build:private-qa
```

- [x] 记录全量 tests/pass/fail/skip/耗时。17 项历史 skip 需列出原因分类；不能把 skipped 当已执行。
- [x] public build 不得包含 `public/exam-packs/private/` 私有题包。
- [x] private-qa build 必须保留既有 5 个私有/合成题包验证，不因路由或 corpus 分片丢失。
- [x] 检查 `www/data/exam-corpus-index.json` 和三个 `www/data/exam-corpus-tracks/*.json` 均存在。
- [x] 检查 Capacitor 同步后的 Android assets 也包含清单和三个分片。
- [x] 检查 Vite 警告：PDF.js direct eval 可作为已知第三方警告记录；新增循环依赖、missing chunk、dynamic import ineffective 或资源缺失必须修复。
- [ ] 若用户授权构建 APK，再运行：

```powershell
npm run build:apk
```

- [ ] APK 安装到 Android 后重复 Task 6 的导航、20 词混合评分和失败恢复核心冒烟。
- [ ] 生成并记录 APK 大小、版本、versionCode、SHA-256；APK 和 `.sha256` 不加入源码提交。

### 完成门槛

- [x] 全量测试 0 fail。
- [x] 所有新行为测试均实际运行且通过。
- [x] public 与 private-qa 构建通过。
- [x] Android assets 完整。
- [x] 四个用户问题全部有自动测试和手动证据。
- [x] `git diff --check` 退出码 0。

**建议提交边界：** 无额外业务提交；只验证前面各建议边界。

---

## Task 8：更新交接并准备给审查 AI 的审查包

**Files:**

- Modify carefully: `PROJECT_STATUS.md`
- Update checkboxes and execution records: `docs/superpowers/plans/2026-08-29-app-performance-review-reliability.md`

- [x] 保留 `PROJECT_STATUS.md` 现有内容与用户原有事实，只更新本轮实际完成内容、测试数字、构建结果、已知问题和下一步；不要宣称未手动验证的场景已验证。
- [x] 明确区分：
  - 本轮代码修复。
  - 性能测量结果。
  - 自动验证结果。
  - 浏览器/Android 手动验证结果。
  - 尚存限制或失败条目。
- [x] 生成最终审查清单，交给原审查 AI：

```powershell
git status --short --branch
git diff --stat
git diff --check
git diff -- src/review-session-metrics.mjs src/views/flashcard.js
git diff -- src/review-persistence.mjs src/review-persistence-status.mjs src/db.js
git diff -- src/review-queue-coordinator.mjs src/views/review-mode.js src/exam-corpus.mjs src/exam-corpus-runtime.mjs scripts/build-exam-corpus.mjs
git diff -- src/router.js src/router-routes.mjs src/router-navigation.mjs
```

- [x] 对未跟踪的新文件额外提供完整内容或单独 diff，因为普通 `git diff` 不显示 untracked 文件。
- [x] 附上所有定向测试、全量测试、public/private build、APK（如执行）和 Task 6 手动证据的原始摘要。
- [x] 列出所有偏离本计划的地方及原因；没有偏离也明确写“无偏离”。
- [x] 不合并、不推送、不删除工作树；把现场留给原审查 AI。

**建议提交边界：** `docs: record app performance and review reliability verification`。未得到明确提交授权时只保留工作树和审查包。

---

## 最终验收矩阵

| 用户问题 | 自动证据 | 手动证据 | 通过条件 |
|---|---|---|---|
| 页面之间跳转不流畅 | 路由顺序、stale load/render、cleanup rejection、A→B→A 行为测试；lazy chunks 构建证据 | 慢网与快速连续点击 | 新 shell ≤100 ms，最终页面 ownership 正确 |
| 同步慢、失败、卡在保存中 | journal 顺序、幂等、conflict rebase、retry timer、flush、idle、v1 迁移测试 | 延迟/临时失败/永久失败/重启 replay | UI 立即切卡；有效操作最终清零；失败可解释可重试 |
| 点过模糊/不认识却全认识 | 最弱评级、当天合并、snapshot 恢复、Flashcard 行为测试 | 12 认识 + 4 模糊 + 4 忘记 | 结果唯一 20；认识 12、模糊 4、忘记 4；学会率 100% |
| 20 词后右上角一直增加 | 固定原始唯一词集、重插 24 次仍 total=20 测试 | 完整 20 词混合轮次 | 始终 `X/20`，X≤20，进度≤100% |
| 整体复习性能 | 单次 learnWords 快照、当前轨道 fetch/cache 测试 | 首次进入与重复进入复习 | 无重复全库读取；只加载当前 corpus track |

---

## 停止条件

执行 AI 遇到以下任一情况必须停止当前 Task，保留现场并向用户/审查 AI 报告，不可自行扩大授权：

- 需要清库、删除 journal、迁移或批量改写真实用户学习数据。
- 需要修改 `src/views/reading.js` 或 `tests/reading-completion-recovery.test.mjs` 才能让本计划测试通过。
- 发现当前变更混入无法归属的用户代码，且继续会覆盖它。
- 需要改变“最弱评级分类 + 最终学会率”产品口径。
- 需要更改 IndexedDB 版本或做 schema migration；本轮 intent/revision 收口原则上应使用现有 v22 结构，新增迁移必须单独评审。
- 全量测试失败但无法用本轮修改解释。
- 需要向 `private` 或 `origin` 推送、合并或发布。

---

## 执行记录

执行 AI 按 Task 逐项追加，格式固定为：

```text
Task N
- 开始/结束时间：
- 修改文件：
- 新增失败测试及 RED 原因：
- GREEN 命令与结果：
- 手动验证：
- 性能数据：
- 偏离计划：
- 剩余风险：
```

```text
Task 0
- 开始/结束时间：2026-08-29 23:40 – 23:48
- 修改文件：仅本计划文件（勾选 + 执行记录）；未触碰任何源码、测试或用户原有文件。
- 新增失败测试及 RED 原因：无（Task 0 只读）。
- GREEN 命令与结果：4 组定向基线依次运行，全部通过：41/41（124 ms）、31/31（1366 ms）、22/22（163 ms）、13/13（85 ms）；git diff --check 退出码 0。
- 手动验证：无。
- 性能数据：不适用。
- 偏离计划：无（批次3 计划历史记录 25/25，现场实得 22/22 且 0 fail，属历史记录与当前工作树的计数差异，已核实为测试精简，非回归）。
- 剩余风险：路由 76/76 与全量 1424 的历史报告仍未独立复跑，留待 Task 4/Task 7 用新鲜结果覆盖。
```

```text
Task 1
- 开始/结束时间：2026-08-29 23:52 – 2026-08-30 00:40
- 修改文件：src/review-session-metrics.mjs（recordRating 增加 null 输入守卫，1 行最小修复）；tests/review-session-metrics.test.mjs（新增 6 个纯逻辑测试）；tests/flashcard-session-behavior.test.mjs（新建行为测试，驱动真实 FlashcardView）。未修改 flashcard.js（审计确认集成已符合口径）。
- 新增失败测试及 RED 原因：recordRating(null) 曾抛 TypeError（解构 null 而非安全拒绝），先写测试确认 RED，再以可选解构守卫修复 GREEN。其余 5 项新测试对当前实现一次通过（模型与 Flashcard 集成审计均已符合口径）。
- GREEN 命令与结果：node --test review-session-metrics/flashcard-session-behavior/review-session/flashcard-two-stage/review-v2-performance-contract/review-practice-view-contract → 51 tests / 51 pass / 0 fail / 238 ms；git diff --check 退出码 0。
- 行为测试装配说明：包为 CommonJS 类型，.js 模块无法从 ESM file-URL 导入；沿用既有 db.js data-URL 装配模式，stub 掉浏览器宿主依赖（config/modal/api/chat/examples/affixes/tooltip/audio-cache/exam-corpus-runtime/lexicon/knowledge-evidence-bridge/word-phrases/word-similar/dictionary），ReviewQueue 用真实 ReviewQueueCoordinator + 真实 SpacedRepetition + 共享 DB 以依赖注入方式构造（examPriority 置 0）。真实组件：db.js(fake-indexeddb)、sessionQueue、recovery-scheduler、review-persistence、metrics、flashcard-flow。
- 手动验证：无（Task 6 承接）。
- 性能数据：不适用。
- 偏离计划：无实质偏离。两点说明：1) 计划示例断言用 summary.fuzzy/forgotten 与 summary.words，实现等价字段名为 uncertain/unknown（UI 已在用），20 词唯一结果改以 summary() + 逐词 getWordResult 结构化断言，未给 summary() 增加 words 数组（结果页不消费该列表，避免死代码）；2) "跳过"语义现场核实为：不计分、不写 journal、skippedCount+1、该词本轮不再出现（completeActive 后移出队列），与"不伪造认识、不增加 learned"口径一致。
- 剩余风险：行为测试依赖 data-URL 装配，若未来给 flashcard.js 新增相对导入需同步维护 importMap（测试会以 unmapped import 报错提示）。
```

```text
Task 2
- 开始/结束时间：2026-08-30 00:42 – 01:25
- 修改文件：src/review-persistence.mjs（scheduleRetryWake 记录 retryTimerAt 并在更早到期时清除重建；readJournal 将无稳定 ID 的行保留为 DATA_CORRUPT 失败行而非静默过滤）；src/views/flashcard.js（结果页持久化状态渲染稳定 errorCodes，新增 .review-persistence-codes 标记）；tests/review-persistence.test.mjs（+4 测试）；tests/review-result-persistence-status.test.mjs（+1 测试）。
- 新增失败测试及 RED 原因：1) 更早重试时间重排 timer——旧实现只判断 retryTimer !== null，先到期的操作要等已有晚 timer 醒来；2) 无稳定 ID 行被 readJournal 前置 filter 静默丢弃，违反"不得静默过滤"；3) 14 条 v1 journal 批量迁移（混合成功/revision 冲突/临时失败/永久损坏）原无覆盖；4) 结果页未渲染稳定 errorCodes。全部先 RED 后 GREEN。
- GREEN 命令与结果：node --test review-persistence/review-result-persistence-status/db-review-settle/db-review-idempotency/db-review-events/db-review-practice/context-review-view → 53 tests / 53 pass / 0 fail / 1666 ms；git diff --check 退出码 0。
- 审计确认（未改代码即符合项）：journal v2 字段完整（operationId/attemptId/wordId/intent{version,rating,sessionDebt,occurredAt,source,sawAnswer,metadata}/expectedRevision/queuedAt/attempts/nextRetryAt/status/errorCode/correlationId）；applyReviewRatingIntent 单事务内 attemptId 幂等→读最新行→revision 冲突时以 settleReviewRatingIntent(=recovery-scheduler.settleSessionReview) 在最新词上重放明确评分→words.put+events.add 同事务原子；同一单词按 journal 顺序执行且永久失败阻塞后继同词操作（retryFailed/replay 可解锁）；flush 对全部处于未来 nextRetryAt 的行及时返回；最后一条成功后 finishDrain 在 finally 路径补发 rating_idle 且形状精确 {pending:0,failed:0,running:false,nextRetryAt:0}（既有测试逐字段断言）；app.js 全局 pagehide/visibilitychange 已有 1.5s 有界 flush 且 catch；cleanup 解绑 status listener。注意：journal 行内仍保留 operation.srsData 供缺少 applyReviewRatingIntent 的遗留回退路径使用，正式提交路径不消费它，判定为可接受的遗留兼容而非"依赖旧 srsData 覆盖"。
- 同事务一致性验证说明：成功路径与失败路径分别由 db-review-settle（安全重放+幂等）与 db-review-events（缺词拒绝不产生 event）覆盖；生产代码所有失败路径均经 fail()→tx.abort() 显式中止，IndexedDB 引擎保证两 store 同回滚。评估过"在 onsuccess 内同步 throw"注入，属生产不可达路径，不新增人工测试。
- import 改写核查：33 个测试文件含新增行，除本计划自身子系统测试外均为 recovery-scheduler/router-routes 的 URL 装配适配，无业务断言被顺带修改。
- 手动验证：无（Task 6 承接）。
- 性能数据：不适用。
- 偏离计划：无实质偏离。说明一点：summarizeReviewPersistenceStatus 在 failed>0 时优先显示"待同步"而非"保存中"（即使 running），这与计划"failed>0 且没有实际运行任务时显示待同步"的措辞略有出入，但符合该条目的产品意图（永不卡保存中、失败可见可重试），且为既有行为，保留不改。
- 剩余风险：错误码徽标仅加在 FlashcardView 结果页；context-review.js 消费同一 summary 但其文件不在本 Task 授权范围内，未同步加徽标，留待审查确认是否需要。
```

```text
Task 3
- 开始/结束时间：2026-08-30 01:28 – 01:52
- 修改文件：tests/review-queue-coordinator.test.mjs（+1 入口级 spy 行为测试）。未修改任何 src 文件与构建产物——审计确认 3.1/3.2 在部分实现中已达成。
- 新增失败测试及 RED 原因：入口级测试首版失败为测试数据缺陷（"未来词"用 nextReview: 999，在 epoch 毫秒口径下实为已到期），修正为 Date.now()+86400000 后 GREEN；非产品缺陷。
- GREEN 命令与结果：node --test review-queue-coordinator/exam-corpus-build/exam-corpus-runtime/review-v2-performance-contract → 27 tests / 27 pass / 0 fail / 114 ms；npm run exam-corpus:verify 通过（9184 个轨道词条、29456 条代表例句）；git diff --check 退出码 0。
- 审计确认：review-mode.js render 单次 getAllLearnWords 并以 words 快照传 getDueSummary，idle 回调仅预加载 Config.get('exam_level')；flashcard.js 以 allWords 快照传 getDueWords；coordinator 提供快照时零读库（既有 spy 测试覆盖 getDueWords/getDueSummary 两路径）；index 产物 1.2 KB 纯元数据（版本/轨道/计数/相对路径/校验），无内嵌单词映射；三分片 1.23/1.44/0.97 MB，cet4 3161 词与清单一致；runtime loadTrack 按 track 缓存 Promise 同轨不重复 fetch，lookup 仅当前轨道，lookupAll 为显式跨轨（计划所称 findAcrossTracks 的实际 API 名），schema 1 legacy fallback 保留（loadIndexArtifact 按 schemaVersion 分派）。
- 构建确定性：npm run exam-corpus:build 连续两次，四个 JSON 的 SHA-256 完全一致（index 86ac0ae0…、cet4 7584bc79…、cet6 627fbc3a…、kaoyan a21620c5…），未使用 git diff 作判断。
- 手动验证：无（Task 6 承接）。
- 性能数据：清单体积从约 3.7 MB 降至 1.2 KB；同轨重复查词零额外 fetch（缓存 Promise 复用）。
- 偏离计划：无。
- 剩余风险：track artifact 自身不带 wordCount 字段，计数以清单为准并在加载时由 assertExamCorpusTrackArtifact 校验，满足"可验证计数"；如审查者要求分片自含计数需另行评审（涉及构建产物 schema）。
```

```text
Task 4
- 开始/结束时间：2026-08-30 01:55 – 02:35
- 修改文件：src/router-routes.mjs（参数路由先 stripQuery 再 safeDecode，非法编码回退原文；reading/exam-catalog/exam-practice/exam-result 改锚定正则匹配；新增 not-found 路由与内联 NotFoundView，缺 ID hash 不再进入业务 view）；tests/router-performance.test.mjs（+5：query 剥离/非法编码、缺 ID not-found、NotFoundView 渲染、stale load rejection 的 reject 变体、stale render resolution、A→B→A 单例 pendingCleanup 等待、cleanup rejection、同路由连续触发——共 8 个新行为测试）；tests/exam-router.test.mjs（解码契约断言由旧 decodeURIComponent(type/attemptId) 模式更新为 safeDecode 契约）。
- 新增失败测试及 RED 原因：缺 ID 路由（#/reading/、#/exam/practice/ 等 8 个 hash）曾以空参数进入业务 view；非法编码（%ZZ）曾抛 URIError 使整次导航失败；query 未剥离即解码。三者先 RED，修复 router-routes.mjs 后 GREEN。4.3 的 5 个竞态行为测试对当前实现直接通过（行为被测试固化，未发现需要修改 router-navigation.mjs 的竞态）。
- GREEN 命令与结果：router-performance/exam-router/unified-vocabulary-routing/exam-view-contract/calibration-view-contract → 40 tests / 40 pass / 0 fail / 111 ms；npx vite build --mode public 成功；git diff --check 退出码 0。
- 行为审计（实现与计划口径一致，已有测试固化）：navigate() 同步块内完成 token 递增→resolveRoute→启动 load→cleanup（不等待）→mount shell→loading skeleton，首个 await 之前新骨架已挂载（既有测试断言事件顺序 detail-close/shell-cleanup/cleanup-start/shell-mount）；load 实际在 cleanup 之前启动以便二者重叠，属等价保证的顺序微调；动态 import 失败仅当前 token 的 outlet 显示错误；cleanup 同步异常与 rejection 均被捕获上报且引用经 finally 释放；单例 view 重入时 render 等待 pendingCleanups 中的前次 cleanup（A→B→A 行为测试固化）；旧 render 只写已脱离 DOM 的 outlet（stale render resolution 测试固化）；同路由连击只保留最新导航。
- 4.1 路由表核对：19 条路由覆盖计划全部清单项；#/learn-words 重定向保留；未知 hash 落 chat fallback；startsWith 前缀以尾部 '/' 收界，practice-extra 等相似前缀无误匹配。
- 构建证据：入口 index 247.70 kB raw / 72.60 kB gzip（目标 ≤700 KB raw，改动前基线约 1.56 MB raw / 502 KB gzip）；chat/reading/flashcard/exam-*/settings/context-review/vocabulary 等均为独立 lazy chunk；Vite 警告仅 PDF.js direct eval（已知第三方）与 reading chunk >500 kB（lazy chunk，非入口，既有）。
- 手动验证：无（Task 6 承接）。
- 性能数据：见构建证据；导航时序手动门槛留待 Task 6。
- 偏离计划：无实质偏离。说明：not-found 采用 router-routes.mjs 内联 NotFoundView（无新文件、无新 chunk），属计划授权文件范围内最小组件；exam-router.test.mjs 的两处解码正则契约随实现同步更新为新契约。
- 剩余风险：NotFoundView 样式类 route-not-found 未在 style.css 中专门定义（复用 app-standard-page 通用样式可正常显示）；如需专属视觉需设计侧确认。
```

```text
Task 5
- 开始/结束时间：2026-08-30 02:38 – 03:05
- 修改文件：src/router-navigation.mjs（recordEvent 选项 + 注入单调时钟 now()，四个阶段 route_started/route_shell_mounted/route_module_loaded/route_render_completed，含 ok/failed/superseded 结果与 durationMs，载荷只含 token/routeKey/correlationId/duration/result/errorName）；src/router.js（接线 recordEvent→诊断日志；route.navigate 记录由原始 hash 改为 resolveRoute().routeKey，去除文章 ID 原文）；src/review-persistence.mjs（emit 诊断映射补 rating_retry_scheduled→review.retry_scheduled）；tests/router-performance.test.mjs（+3 阶段证据测试）；tests/review-persistence.test.mjs（+1 评分时序测试）。
- 新增失败测试及 RED 原因：无实现性 RED——本 Task 为纯证据增强；新增测试首轮暴露两点：1) shell_mounted 在 navigate 同步段发出，时钟注入点需放入 load/render 存根（测试构造修正）；2) 发现既有行为 rating_idle 双发（flush 空日志时收尾 drain 会再广播一次幂等 idle），属既有幂等通知，按"序列有序前缀 + 末事件必为 idle"口径断言并记录。重试测试曾因 5ms wake timer 与 flush 窗口竞态而闪失败，改走确定性 retryFailed()（replay+flush）后连跑三次稳定。
- GREEN 命令与结果：node --test router-performance/review-persistence/diagnostic-db → 36 tests / 36 pass / 0 fail，连续三次一致；git diff --check 退出码 0。
- 审计确认：诊断载荷不含 URL 参数/文章 ID/查询串/错误消息正文/释义正文；stale navigation 记录 result 'superseded' 而非 error；performance.now() 单调时钟 + 可注入 now()（无 performance 环境回退 Date.now()）；评分诊断链 review.write_queued/write_started/write_completed/retry_scheduled/write_failed/write_idle 全部携带 operationId/attemptId/wordId/errorCode/nextRetryAt 且无敏感内容；permanent failure 最终状态含稳定错误码与 next action、不停留 running（既有测试覆盖）。
- 手动验证：无（Task 6 承接四项性能门槛：导航点击→新 shell ≤100ms、评分→反馈 ≤100ms、journal 清空→离开保存中 ≤1s、同轨 corpus 重复查词零 fetch）。
- 性能数据：自动化测试仅断言架构顺序与无阻塞（本 Task 门径）；绝对数值留待 Task 6 手动采集。
- 偏离计划：router.js 属 Task 4 文件清单而非 Task 5，但其中 route.navigate 诊断记录携带文章 ID 原文，与 5.1 隐私口径直接冲突，故在本 Task 一并修正为 routeKey（1 行语义收窄），并在此声明。
- 剩余风险：rating_idle 幂等双发保留（订阅方均为幂等状态更新，无 UI 风险）；如审查者要求严格单次 idle 需在 coordinator 增加"已 idle"标记，属行为变更需单独评审。
```

```text
Task 6
- 开始/结束时间：2026-08-30 03:10 – 05:05（浏览器 IAB，Vite private-qa dev server @ 127.0.0.1:3000，独立测试 profile，数据全部为本轮播种的 qa01–qa25 合成词，未触碰真实用户数据）
- 修改文件：无源码修改。测试注入全部经页面运行时打补丁（__englishReaderDiagnosticDB.applyReviewRatingIntent 包装、localStorage journal 注入），刷新后自然恢复。
- 新增失败测试及 RED 原因：不适用（手动验收）。
- 验证证据：
  · 6.2 页面切换：7 跳序列（chat→复习入口→回忆→返回→词库→阅读列表→真题首页）shell 挂载 0.4–2.6 ms/跳（门槛 ≤100 ms），每跳 route_render_completed 均为 ok；快速三连跳（复习入口→词库→复习入口）token 4/5 superseded、token 6 ok，最终页为复习入口且词库内容不可见。
  · 6.3 二十词混合轮（12 认识 + 4 模糊→认识 + 4 忘了→认识，实际展示 28 次）：结果页 20 总复习 / 12 认识 / 4 模糊 / 4 忘记 / 学会率 100%；进度标签集合 total 恒为 20、learned 单调 0→20、从未超 20；reviewEvents 28 条且形状精确 12×[5] + 4×[1,5] + 4×[3,5]（每词每曝光恰一事件，wordId 999 损坏词零事件）；今日累计 20 词唯一、8 个弱评词 weakestQuality(1/3) + lastQuality(5) 保留未被覆盖；结果页状态"复习记录已全部保存"。
  · 评分反馈时延（微任务自旋法，不受后台节流污染）：正常 27.1 ms；2.5 s 慢写入注入下 45.3 ms（journal 先行、乐观切卡）；两值均 ≤100 ms 门槛。
  · 6.4 失败恢复：a) 慢写入期间 pending=1/running=true（保存中），4.5 s 后自动归零；b) 单次 DB_BLOCKED 注入在 1.2 s 内自动重试归零；持续失败注入耗尽 3 次重试后 failed=1/errorCodes=[DB_BLOCKED]/running=false，解除注入手动 retryFailed 后归零；c) journal 混入 2 条坏行（无 ID 行 + rating=2 行）刷新后保留为 failed DATA_CORRUPT，点击"重试"后仍 failed=2、wordId 999 零事件（坏行不被执行）；d) 3 s 慢写入 + 立即刷新：有效行重放后恰好提交一次（事件总数 32→33 只增 1）。
  · 截图：①20 词结果页（20/12/4/4/100% + "复习记录已全部保存"）；②失败可重试状态（"还有 2 条复习记录待同步 错误码 DATA_CORRUPT [重试]"危险色横幅）。存于 C:/Users/a3284/.zcode/cli/artifacts/sess_6d375c1c-8eb1-47e3-9368-8a757eb09c92/ 下 call_0e425d301be4445da273d0ef（结果页）与 call_4ce46690726f42fba296b881（失败态）。
  · 四项门槛代表值：导航点击→新 shell 0.4–2.6 ms（≤100 ms 达标）；评分→反馈 27.1/45.3 ms（≤100 ms 达标）；journal 清空→"已保存"在正常写入下即时满足（28 词会话结果页与状态节点实测），慢注入场景为故意延迟不适用；同轨 corpus 重复查词零重复 fetch（Node 行为测试覆盖，浏览器端未单独观测 fetch 计数）。
- 手动验证：如上。环境：Windows 10.0.26200 x64，ZCode 内置浏览器（Chromium IAB，1280x720）。
- 性能数据：见上；绝对时延均在开发机 + IAB 环境采集，真机数据待 Android 验证。
- 偏离计划：①"模拟慢网下测试 lazy chunk"未执行——IAB 无法做网络节流，等价证据为 shell 先于模块加载的行为测试与 0.4–2.6 ms 实测（该项保持未勾选）；②截图"固定 20 分母"未单独截取会话中进度条（以逐曝光进度文本日志 total 恒 20 + 结果页截图替代）；③Android 机型/系统记录与 APK 冒烟无设备可用，留待 Task 7（如获授权）或用户真机（未勾选）；④浏览器为 IAB 而非独立 Chrome/Android WebView。
- 剩余风险：IAB 后台标签计时器节流使自动化驱动缓慢（已用微任务法规避测量污染）；qa 测试数据留存于该浏览器 profile 的独立 IndexedDB（EnglishReader@127.0.0.1:3000 源），不影响任何真实用户数据。
```

```text
Task 7
- 开始/结束时间：2026-08-30 05:08 – 05:35
- 修改文件：无（纯验证；www/ 与 android/app/src/main/assets/public/ 为构建产物，未手工编辑、未加入提交）。
- 新增失败测试及 RED 原因：无。
- 全量回归：node --test tests/*.test.mjs → 1450 tests / 1433 pass / 0 fail / 17 skipped / 11.19 s。较 Task 0 基线（1403/1386/17/0）新增 47 个测试（本轮 Task 1–5 新增行为与装配测试），跳过数与历史一致。
- 17 项 skip 分类：全部为"私有真题源目录不可用"的条件跳过——1 项 MinerU 2026 原文候选校验 + 16 项 2010–2025 真题源转换单元门（source conversion）。这些测试在锁定源目录缺失时按设计跳过，属用户私有数据边界，不在本轮强行运行；无其他类别。
- git diff --check：退出码 0（仅 LF/CRLF 常规警告）。
- exam-corpus:verify：通过（9184 个轨道词条、29456 条代表例句）。
- public 构建：通过。检查 www/exam-packs/ 不含 private/（私有题包未泄漏）✓；www/data/exam-corpus-index.json 与 www/data/exam-corpus-tracks/{cet4,cet6,kaoyan-general}.json 均存在 ✓；构建告警仅两类已知项（PDF.js direct eval 第三方警告、lazy reading chunk >500 kB），无循环依赖、missing chunk、dynamic import ineffective 或资源缺失告警。
- private-qa 构建：通过（构建后执行 cap sync android，sync finished 0.276s）。www/exam-packs/private/ 保留 index.json + 5 个私有/合成题包（local.cet4、local.kaoyan.en1、synthetic.kaoyan.cloze、synthetic.kaoyan.en1、synthetic.kaoyan.ordering）✓；android/app/src/main/assets/public/data/ 下清单与三个分片齐全 ✓。
- 构建产物顺序说明：按计划"先 public 后 private-qa"执行，最终 www/ 为 private-qa 输出（QA 设备安装态）；public 排除性检查在独立 public 构建后立即核验并再次恢复 qa 构建。
- APK：未执行——用户未授权 npm run build:apk（计划为条件步骤）；APK 大小/版本/versionCode/SHA-256 与真机冒烟（导航、20 词混合评分、失败恢复）留待获得授权或用户真机执行。
- 手动验证：无新增（复用 Task 6 浏览器证据）。
- 性能数据：入口 chunk 247.70 kB raw / 72.60 kB gzip（Task 4 已录）。
- 偏离计划：无（APK 为计划内条件步骤，未授权即不执行）。
- 剩余风险：Android WebView 真机行为（IndexedDB 慢写、WebView 音频、返回键导航）未在本环境验证；建议授权 APK 构建后按 Task 6 场景做一次真机冒烟。
```

```text
Task 8
- 开始/结束时间：2026-08-30 05:40 – 06:00
- 修改文件：PROJECT_STATUS.md（更新时间/工作树状态、新增"2026-08-30 收口轮验证"小节、旧验证数字标注为上一轮历史事实、新增"审查包"章节）；本计划文件勾选与执行记录。未修改其他任何文件。
- 新增失败测试及 RED 原因：无。
- GREEN 命令与结果：git status --short --branch（分支/跟踪关系确认）；git diff --stat（45 files, +1321/-281）；git diff --check 退出码 0。
- 交接内容：PROJECT_STATUS.md 现已区分本轮代码修复、性能测量（shell 0.4–2.6 ms、评分反馈 27.1/45.3 ms）、自动验证（1450/1433/17/0、双构建、verify）、浏览器手动验证（6.2/6.3/6.4 全场景）与尚存限制（Android 真机、慢网节流、route-not-found 视觉）。审查包含七条子系统审查命令、12 个未跟踪文件清单、用户原有变更隔离说明（src/views/reading.js +17 行与 reading-completion-recovery.test.mjs 为用户原有，本轮未触碰）、累计偏离清单 7 条与证据索引。
- 手动验证：无新增。
- 性能数据：见 Task 6/7 记录。
- 偏离计划：无（提交未执行——未获明确授权，工作树与审查包原地保留给审查 AI；不合并、不推送、不删除）。
- 剩余风险：全部交接事实以 PROJECT_STATUS.md 与本计划执行记录为准；若审查者需要单个未跟踪文件的完整内容，文件本身就在工作树中可直接阅读。
```

## 审查修复记录（2026-08-30 第二轮，响应审查反馈的 4 个问题）

执行约束遵守情况：未提交、未推送、未切分支、未 reset/清理；未修改 `src/views/reading.js` 与 `tests/reading-completion-recovery.test.mjs`；未使用子代理。每项均先写稳定失败的行为测试（RED），再做最小修复（GREEN）。

### 问题 1：单例页面旧 render 覆盖新状态的竞态

- RED 测试：`tests/router-performance.test.mjs` → `a stale singleton render cannot overwrite the revisited instance state`。场景为真实 A→B→A：第一次 A 的异步 render 开始后未结束 → 导航 B → 再导航同一 A 单例 → 第二次 A render 完成 → 最后才释放第一次 render。测试视图只有在能证明自己已过期（拿到 lifecycle context）时才抑制迟到回调，否则按旧行为覆盖 DOM——无上下文即无法自证，从而稳定复现覆盖。
- RED 原因：控制器此前不向 view.render 传递任何生命周期信息（`firstContext/secondContext` 为 undefined），视图无法区分自己是否已被更新的导航取代。
- 修复（`src/router-navigation.mjs` 最小改动）：控制器以 WeakMap 维护每个视图的 render generation；调用 `view.render(outlet, ...route.args, renderContext)` 时把 `{ token, generation, isCurrent() }` 作为恒为尾参的上下文传入。新 shell 仍在首个 await 之前同步挂载（骨架零延迟，测试断言第三次导航的 outlet 立即渲染 B→A 内容）；不等待旧 render 完成。忽略该尾参的既有视图行为不变。
- GREEN：16/16。断言覆盖：迟到的 stale 回调被视图基于 `isCurrent()===false` 抑制、不覆盖 DOM；两次 render 的 generation 严格递增；第一次上下文 `isCurrent()` 为 false、第二次为 true。

### 问题 2：整段 journal JSON 损坏时误报"已全部保存"

- RED 测试：`tests/review-persistence.test.mjs` → `a completely corrupted journal is quarantined as DATA_CORRUPT instead of reporting saved`。journal 为无法 JSON.parse 的非空文本。
- RED 原因：`readJournal` 对解析异常一刀切返回 `[]` → journal 视为空 → 状态推导给出 `saved`/"复习记录已全部保存"，坏数据被静默吞掉。
- 修复（`src/review-persistence.mjs`）：读取阶段分离"无 journal"与"journal 不可解析/非数组"两种情形；后者构造一条隔离证据行（`operationId/attemptId='corrupt-journal'`、无有效 intent、`corruptRaw` 保存原始文本、`status:'failed'`、`errorCode:'DATA_CORRUPT'`）并照常持久化，原始损坏文本原样保留在 journal 内。`pending≥1/failed≥1`、错误码 DATA_CORRUPT、状态文案不可能是"已全部保存"；flush/retry 不把坏文本当评分执行（executeRating 0 次调用）。
- GREEN：19/19（含既有 17 项）。`review-persistence-status.mjs` 无需改动（failed>0 分支天然覆盖）。

### 问题 3：journal 稳定标识严格校验

- RED 测试：同文件 → `journal rows with whitespace-only ids or an invalid wordId are quarantined, and valid padded ids are trimmed`。构造 8 行：纯空格 operationId、纯空格 attemptId、wordId 为空串/'abc'/0/负数/小数各一行，以及一个两端带空格但有效的行。
- RED 原因：旧校验 `Boolean(row.operationId)` 对 `'   '` 为真、`Number.isFinite` 放过 0/负数/小数，坏行会进入执行路径；且带空格的合法 ID 未在 journal 层 trim，依赖 DB 层二次 trim，存在绕过 attemptId 幂等索引检查的隐患。
- 修复（`src/review-persistence.mjs`）：先 `trim` 再校验——operationId/attemptId 必须为非空字符串，wordId 必须为 `Number.isSafeInteger` 且 > 0；不满足即 `intent:null` + `DATA_CORRUPT` 失败隔离；满足时把 trim 后的 ID 写回 journal 行，executeRating 收到的就是 trim 后的 attemptId（DB 层幂等索引检查不可能被空串绕过）。
- GREEN：断言 failed=7/pending=8、executeRating 恰好 1 次且参数为 trim 后的 `op-padded`/`att-padded`、retryFailed 后坏行仍 failed=7 且执行次数仍为 1。

### 问题 4：专项复习续练结果统计

- RED 测试：`tests/flashcard-session-behavior.test.mjs` → `a resumed practice session counts only this run in the result while group progress reaches 4/4`（行为级：真实 FlashcardView + fake-indexeddb）。场景：整组 4 词、p1 已有今日练习完成事件、续练 sessionStorage 会话 wordIds=剩余 3 词/expectedWordIds=4 词、render(container,'manual') 后 3 词全部点认识。
- RED 原因：`render()` 中练习模式的 metrics 用整组 `practiceWordIds`（4 词）初始化，结果页 `summary().total` 显示 4 而本次实际只展示并评分 3 词。
- 修复（`src/views/flashcard.js` 一处）：练习模式 metrics 改用本次实际展示的 `practiceWords` 初始化；整组完成进度（顶部 `completed / total` 与结算 `finalizePracticeSession`）继续走 `practiceCompletedWordIds/practiceWordIds`，不受影响。
- GREEN：断言本次结果 total/rated/known/mastered=3、学会率 100%、结果页"专项练习完成"且无"未评分"字样、整组进度最终 `4 / 4` 且分母恒为 4；并逐词断言练习后 `interval/state/reviewRevision/easeFactor` 与种子完全一致（不触碰正式 SRS）。另外为测试装配补充了 `sessionStorage` stub（练习会话的真实存储位置）。

### 修复后验证数字

- 定向套件（审查指定 5 文件）：49 tests / 49 pass / 0 fail。
- 全量：`node --test tests/*.test.mjs` → 1454 tests / 1437 pass / 0 fail / 17 skipped（新增 4 个测试：路由 1 + 持久化 2 + 行为 1；skip 分类不变）。
- `git diff --check`：退出码 0。
- `npx vite build --mode public`：通过；入口 chunk 249.39 kB raw / 73.09 kB gzip（router-navigation 增量约 1.7 kB raw）；public 构建不含 `exam-packs/private/`。
- `npm run build:private-qa`：通过；保留 index + 5 个私有/合成题包；Capacitor Android 同步完成，assets 含语料清单与三个分片。

### 最终 diff 摘要（本轮审查修复增量）

- `src/router-navigation.mjs`：+renderGenerations(WeakMap) 与 renderContext 尾参（约 +14 行）。
- `src/review-persistence.mjs`：readJournal 重写读取/隔离/校验逻辑（quarantineRow + trim 后严格 ID 校验）。
- `src/views/flashcard.js`：练习模式 metrics 初始化词集一处。
- 测试：router-performance.test.mjs +1、review-persistence.test.mjs +2（含 summarize 导入）、flashcard-session-behavior.test.mjs +1（含 sessionStorage stub）。

## 审查修复记录（2026-08-30 第三轮，响应审查反馈的 4 个问题）

执行约束遵守情况：未提交、未推送、未切分支、未 reset/清理；未修改 `src/views/reading.js` 与 `tests/reading-completion-recovery.test.mjs`；未使用子代理。每项先写稳定失败的 RED 行为测试（并保留 RED 时的实际失败输出），再做最小修复。

### 问题 1：路由参数契约回归（P1）

- RED 测试 1（`tests/router-performance.test.mjs`）→ `route render keeps business parameters positional and passes no lifecycle object`：用真实 `resolveRoute` 解析 `#/flashcard/recall` 与 `#/reading/42`，视图以 `(outlet, ...rest)` 记录实参。
  RED 实际失败输出：`deepEqual` 失败——`#/flashcard/recall` 的 rest 收到 `[renderContext 对象]`（应为 `[]`），`#/reading/42` 的 rest 收到 `[42, renderContext 对象]`（应为 `[42]`）。
- RED 测试 2（`tests/flashcard-session-behavior.test.mjs`）→ `navigating the real router to #/flashcard/recall opens the formal recall page`：真实 FlashcardView 经真实 resolveRoute + 控制器导航。
  RED 实际失败输出：`AssertionError: the formal recall card must render`——`requestedScope` 收到生命周期对象后被判为无效专项练习，页面渲染"专项练习已失效"而非 recall 卡片。
- 修复（`src/router-navigation.mjs`）：删除 `renderContext` 尾参与 `renderGenerations`，恢复 `view.render(outlet, ...route.args)` 原签名；`#/flashcard/recall` 的 `requestedScope` 回归默认空字符串，业务参数列表不再被占用。生命周期防护改由问题 2 的控制器串行化承担（不再向视图传递任何信息）。
- GREEN：两个测试通过；`#/flashcard/recall` 渲染出含 `routerrecall1` 的正常 recall 卡片且无"专项练习已失效"。

### 问题 2：控制器真正执行的单例 render 防护（P1）

- RED 测试（`tests/router-performance.test.mjs`，替换上一轮依赖 ctx 的测试）→ `the controller serializes same-view renders so a superseded render cannot overwrite the live one`。测试视图与生产页面一致：**只接收 outlet、完全不感知生命周期信息**；第一次 A render 挂起期间导航 B，再导航同一 A 单例，最后释放第一次 render。释放与第三次导航赛跑（保证无论控制器是否重排顺序，释放必然发生恰好一次）。视图的迟到回调无条件覆盖共享状态 `phase='stale'` 并写旧 outlet——测试桩不含任何抑制逻辑。
  RED 实际失败输出（临时移除防护后复跑确认）：`AssertionError [ERR_ASSERTION]: the superseded render must not overwrite the live shared state — 'stale' !== 'fresh'`，且 `mounted[2]` 若无 outlet 隔离将被写入 stale 内容。
- 修复（`src/router-navigation.mjs`）：控制器新增 `pendingRenders`（WeakMap，视图 → 未完成 render claim）。同一视图的上一个 render 未完成时，新一轮同视图 render 先 `await priorRender`（异常上报不阻塞）再执行——被取代的 render 总是在 live render 开始前结束（含资源清理），物理上不存在两个同视图 render 并发，迟到覆盖在机制上不可能发生。新 shell/骨架仍在首个 await 前同步挂载（测试同步断言 `data-route-loading` 骨架已挂、上一页内容不残留），等待只延迟视图内容，绝不延迟页面切换；跨视图导航（A→B）不受任何等待影响。claim 的跟踪链自带已处理的 rejection 分支，避免 unhandledRejection。
- GREEN：防护恢复后 17/17；断言覆盖：`phase === 'fresh'`（共享状态归属正确）、live outlet 无 stale 内容、骨架同步挂载、`currentView` 为单例本体。

### 问题 3：保留数组中的所有损坏 journal 元素（P2）

- RED 测试（`tests/review-persistence.test.mjs`）→ `non-object journal elements are quarantined instead of being silently dropped`：journal 为 `[42, null, "bad"]`。
  RED 实际失败输出：`AssertionError: a journal of three corrupted elements must not read as empty, got pending=0`——`filter` 静默丢弃非对象元素后 journal 被误读为空。
- 修复（`src/review-persistence.mjs`）：`readJournal` 去掉 `filter`，对数组逐元素映射；数字/字符串/null 等非对象元素经 `quarantineRow`（字符串原样保留，其余 JSON 序列化）转成 DATA_CORRUPT 隔离行，与对象行同一持久化路径。
- GREEN：pending=3/failed=3、errorCodes 含 DATA_CORRUPT、状态非 saved、flush/retry 后 executeRating 0 次调用、dump 中 `42`/`bad` 证据仍在。

### 问题 4：收紧 enqueueRating 的 wordId 校验（P2）

- RED 测试（`tests/review-persistence.test.mjs`）→ `enqueueRating rejects non-positive-integer wordIds before they reach the journal`：对 `0 / -1 / 2.5 / '' / 'abc' / NaN` 逐一断言抛错、不进 journal、不执行；并用 `MAX_SAFE_INTEGER-1` 验证合法值正常结算。
  RED 实际失败输出：`AssertionError: Missing expected exception: wordId 0 must be rejected`（旧校验 `Number.isFinite` 放行 0/负数/小数）。
- 修复（`src/review-persistence.mjs`）：enqueue 边界与 journal 恢复边界统一为 `Number.isSafeInteger(wordId) && wordId > 0`。
- GREEN：6 个非法值全部抛 TypeError、journal 保持 `[]`、零执行；合法大正整数正常结算且参数原样传递。

### 修复后验证数字

- 审查指定 5 文件定向套件：53 tests / 53 pass / 0 fail。
- 全量：1458 tests / 1441 pass / 0 fail / 17 skipped（skip 分类不变）。期间发现并同步了一个源码契约测试（`tests/exam-ui-controls.test.mjs` 断言旧 `try { await view.render(` 形态，已更新为等价的 `renderClaim` 形态，业务断言"渲染失败必须显示可恢复错误页"不变）。
- `git diff --check`：退出码 0。
- public 构建：通过；入口 249.51 kB raw / 73.12 kB gzip；不含 `exam-packs/private/`。
- private-qa 构建：通过；index + 5 个私有/合成题包保留；Capacitor 同步完成，Android assets 含语料清单与三分片。

### 本轮最终 diff 摘要

- `src/router-navigation.mjs`：移除 renderContext 尾参与 renderGenerations（问题 1 回归源）；新增 pendingRenders 同视图 render 串行化（问题 2 防护）；清理一个冗余 token 检查块。
- `src/review-persistence.mjs`：readJournal 非对象元素逐项隔离（问题 3）；enqueueRating wordId 收紧为正安全整数（问题 4）。
- `src/views/flashcard.js`：本轮无改动。
- 测试：router-performance.test.mjs（+1 参数契约、1 个 ctx 测试重写为串行化测试）；review-persistence.test.mjs（+2）；flashcard-session-behavior.test.mjs（+1 真实路由导航）；exam-ui-controls.test.mjs（契约形态同步）。

## 审查修复记录（2026-08-30 第四轮，响应同视图串行化的 3 个遗留问题）

执行约束遵守情况：未提交、未推送、未切分支、未 reset/清理；未修改 `src/views/reading.js` 与 `tests/reading-completion-recovery.test.mjs`；未使用子代理。每项先写稳定失败的 RED 行为测试（保留实际失败输出），再做最小修复。

### 问题 1：等待旧 render 后 stale 导航仍然执行（P1）

- RED 测试（`tests/router-performance.test.mjs`）→ `a queued render that is superseded while waiting must be abandoned without side effects`：A1 render 挂起 → A2 导航进入对 A1 的等待 → 用户导航 B（B 正常显示）→ 释放 A1。
  RED 实际失败输出：`AssertionError: the abandoned A2 must never call render again`——A2 在等待期间被 B 取代后，仍恢复执行并调用了 `view.render`、改写 `currentView`。
- 修复（`src/router-navigation.mjs`）：`await priorRender` 之后、设置 `state.currentView` 与调用 `view.render` 之前，重新检查 `isCurrent(token)`；过期导航仅记录 `route_render_completed: superseded` 并返回 `{ ok: false, stale: true, token }`，不产生任何页面状态或副作用。
- GREEN 断言：A2 返回 `stale: true`；A 的 render 调用次数保持 1；`controller.currentView` 仍为 B 视图；后续离开 B 时 B 被 cleanup（cleanupCount=1）而 A 只保留早期那一次 cleanup（=1），未被波及。

### 问题 2：旧 render 在早期 cleanup 后重新绑定资源（P1）

- RED 测试 → `the controller tears down a finished stale render before starting the live one`（+变体 `a throwing teardown cleanup does not block the next same-view render`）：A1 render 挂起期间导航 B 触发 A.cleanup 一次；释放 A1 时其迟到回调像生产页面一样**重新绑定一个全局监听器**；再进入 A，A2 绑定自己的监听器。
  RED 实际失败输出：`AssertionError: only the live render may keep a listener`，actual 为 `['a1-late-listener', 'a2-listener']`——旧 render 完成后无人清理其迟到资源，且 cleanup/render 顺序断言不匹配。
- 修复（`src/router-navigation.mjs`）：控制器在 `await priorRender` 完成、stale 检查通过后，对该视图**强制执行一次 teardown cleanup**（`scheduleViewCleanup(view)`，异常经 `reportCleanupError` 上报不阻断），随后**再次检查 token** 才设置 `currentView` 并启动 live render。teardown 严格限定在确实等待过 priorRender 的分支内——首次进入页面（无旧 render）不会多出一次无意义 cleanup。
- GREEN 断言：全局监听器只剩 `['a2-listener']`；cleanupCount 恰为 2；生命周期事件顺序精确为 `['render-a1', 'cleanup-1', 'a1-late-bind', 'cleanup-2', 'render-a2']`（cleanup#2 发生在 A1 完成之后、A2 render 之前）；live outlet 无 stale 内容。抛错 cleanup 变体：两次 cleanup 异常均被上报，A2 仍正常渲染且独占监听器，后续导航不被阻断。
- 保持项确认：骨架在 nav3 调用后同步挂载（同步断言 `data-route-loading`）；A→B 跨视图导航不等待 A1（nav2 正常显示 B）；无无人结束的 promise、无 unhandledRejection。

### 问题 3：pendingRenders 跟踪链永不删除（P2）

- RED 测试 → `render tracking entries are released after completion and rejection`：给控制器注入可观测的 `pendingRenderTracker`（Map 接口，生产默认仍为 WeakMap、零行为变化）。
  RED 实际失败输出：`AssertionError: an in-flight render is tracked`——旧实现无法观测且比较对象错误（存的 `.then().finally()` 派生 promise，finally 里却与原始 `renderClaim` 比较），条件恒 false，条目永不释放。
- 修复（`src/router-navigation.mjs`）：① 控制器新增可选 `pendingRenderTracker` 依赖注入；② 跟踪链改为 `const trackedRender = renderClaim.then(...).finally(() => { if (pendingRenders.get(view) === trackedRender) pendingRenders.delete(view); }); pendingRenders.set(view, trackedRender);`——存入与比较使用同一个 `trackedRender`，只删除仍对应自己的记录，不误删更新的 claim。
- GREEN 断言：in-flight 时 `size===1`；正常完成与 rejected render 后 `size===0`；后续进入已完成页面导航 `ok:true` 且无陈旧 claim 等待。

### 修复后验证数字

- 审查指定 5 文件定向套件：57 tests / 57 pass / 0 fail。
- 全量：1462 tests / 1445 pass / 0 fail / 17 skipped（新增 4 个测试：问题 1 一个 + 问题 2 两个 + 问题 3 一个；skip 分类不变）。
- `git diff --check`：退出码 0。
- public 构建：通过；入口 249.66 kB raw / 73.16 kB gzip；不含 `exam-packs/private/`。
- private-qa 构建：通过；index + 5 个私有/合成题包保留；Capacitor 同步完成，Android assets 含语料清单与三分片。

### 本轮最终 diff 摘要

- `src/router-navigation.mjs`：
  1. `await priorRender` 之后新增 `isCurrent(token)` 重查，过期导航直接返回（问题 1）。
  2. `if (priorRender)` 分支内、stale 重查之后新增强制 teardown cleanup（`scheduleViewCleanup`）+ 二次 token 重查（问题 2）。
  3. `pendingRenders` 支持注入 tracker；跟踪链改为 `trackedRender` 自引用比较并正确删除（问题 3）。
- `src/views/flashcard.js`、`src/review-persistence.mjs`：本轮无改动。
- 测试：router-performance.test.mjs 新增 4 个（stale 排队放弃、teardown 顺序、抛错 teardown 变体、tracking 释放）；其中因实现微任务预算变化，将旧 stale-render 测试的两次微任务等待改为宏任务等待（测试装配修正，断言不变）。

### 状态声明

3 项遗留问题的修复均带 RED/GREEN 证据，但**尚未经过审查 AI 复核**；复核通过前不声称"全部问题已修复"。设计取舍如实说明：同视图重入时，上一个 render 完成后会插入一次 teardown cleanup 再渲染（保证资源代际干净），首次进入页面无此开销；骨架与页面切换始终同步、不受等待影响。


### 状态声明

以上 4 项已完成修复并有 RED/GREEN 证据，但**尚未经过审查 AI 复核**；在复核通过前不声称"全部问题已修复"。已知设计取舍：同视图 render 串行化意味着上一个同视图 render 未完成时，再次进入该页面只会看到骨架（内容级等待，骨架与页面切换不延迟）；跨视图导航不受影响。

## 无感切页与底层性能优化实施记录（2026-08-30）

本阶段按用户批准的《English Reader 无感切页与底层性能优化方案》直接实施，未使用子代理，未提交、未推送、未切分支、未 reset/清理；既有脏工作树与私有题包保持原样。实施目标是移除页面显示前的串行等待链，不以 Loading 动画替代性能优化。

### 已完成的底层改造

1. **真实首帧指标**：导航链记录点击、路由、模块、缓存、DOM 提交、双 `requestAnimationFrame` 首次有意义绘制与可交互阶段；Long Task 超过 50 ms 单独记录，诊断在首帧后合并落库。
2. **常驻 AppShell 与原子切页**：Header、菜单和页面宿主只挂载一次；目标视图在 staging outlet 中准备完成后原子显示，当前页不会先被清空；删除核心页面通用全屏 Loading，同时保留 token、迟到 render 抑制、同视图串行化与 teardown 防护。
3. **混合预热与 Keep-Alive**：路由支持 `cachePolicy/warmup/preloadData`，模块和数据 Promise 去重；首帧后空闲预热高价值入口，菜单 pointer/focus 即时预热；根页面最多 3 个 LRU 缓存并统一 `activate/deactivate/dispose`，会话页仍完整释放。
4. **词汇与复习数据层**：IndexedDB 升至 v23；增加一次性迁移标记、复合索引、revision 词库快照、练习进度批量读取和 `getLearnWordsByIds` 单事务批量读取；词汇列表窗口化，总可见 DOM 约 120 行以内，搜索/筛选不再读取数据库。
5. **渐进页面**：阅读正文先显示，词形、生词、进度、活动、音频随后增强且写入前检查文章/导航代际；历史、统计、书架和真题首页缓存先显示、后台刷新；真题包安装按资源版本/会话去重，概览不再重复保存完整试卷。
6. **启动与 Android**：AppShell 同步挂载，配置、数据库预连接和首路由并行；删除未使用的 TtsBridge、Android TextToSpeech 初始化、插件与 Manifest 查询；首个真实页面首帧后调用 `reportFullyDrawn()`。
7. **资源瘦身与实验**：删除约 2 MB 纸张纹理并改为小型 CSS 噪点；停止复制未运行的 `www/src`；AndroidX WebKit 升至 1.16，并提供默认关闭的 `startUpWebView` A/B 实验开关，只有同机中位数改善至少 5% 才允许默认启用。

### 测试与构建证据

- 全量自动化：1484 tests / 1467 pass / 0 fail / 17 skip；skip 分类不变，均为私有真题源目录条件跳过。
- `git diff --check`：退出码 0。
- public 构建：通过；入口 262.20 kB raw / 76.74 kB gzip，不含私有题包，不生成 `www/src`。
- private-qa 构建：通过；index + 5 个私有/合成题包和 Android 三个语料分片齐全；Capacitor 仅注册 Secure Storage、App、Filesystem、Share 四个插件。
- 稳定 APK：`E:\play\claude\EnglishReader-private-qa-v2.0.0-46-debug.apk`，42,950,609 bytes，SHA-256 `F7A614B4B889DC6B5BDB001B128C53AD541A65B53314F95C897FE6D1291A9876`。
- WebView 实验 APK：`E:\play\claude\EnglishReader-private-qa-v2.0.0-46-webview-startup-experiment-debug.apk`，42,950,609 bytes，SHA-256 `B3E7EAE294B38820F483D9CDC03454CAB816D79A3823526870A3A297505F97C6`。
- 默认构建已恢复并核对 `ENABLE_ASYNC_WEBVIEW_STARTUP=false`；实验包只用于同机冷/热启动 A/B。

### 尚待真机验收

桌面自动化和构建不能替代 Android 真机性能测量。`p95 ≤ 100 ms`、冷/热启动改善至少 25%、长任务/掉帧与 WebView 实验至少 5% 等门槛，须在同一手机和同一数据集按计划重复采样后判定；未达标的项目继续按模块、数据库、DOM 和绘制阶段定位，不能恢复全屏 Loading 掩盖等待。

## 平板适配实施记录（2026-08-30）

本阶段在既有常驻 AppShell 与路由生命周期之上完成平板布局收口，未使用子代理，未提交、未推送、未切分支或清理工作树。

- 真实 768×1024 截图确认两个根因：focus 页面错误继承了平板 rail 侧栏布局；root Header 在隐藏菜单按钮后仍保留菜单列，导致词汇/真题标题被压缩。修复后 AppShell 输出 `app-shell--root` / `app-shell--back`，CSS 将 rail 与 focus 的平板几何彻底分离。
- focus 页面隐藏 drawer/backdrop，并使用全宽返回式 Header；rail 根页面回收菜单列，rail 返回页面保留 48 px 返回列。侧栏宽度在小/大平板分别使用自适应范围。
- 页面密度按 600–719、720–1199、≥1200 三段控制为 1/2/3 列；阅读操作和逐句导读在平板变为右侧有界 sheet，通用模态与学习信息层居中限宽；短横屏单独压缩垂直间距。
- TDD 结果：新增/调整的平板契约先出现 5 个预期 RED，最小修复后定向 11/11；扩大到 Shell、响应式和真题答题卡后 44/44。
- 最终全量：1487 tests / 1470 pass / 0 fail / 17 skip；`git diff --check` 0。public 与 private-qa 双构建通过，入口 262.23 kB raw / 76.74–76.75 kB gzip。
- 测试 APK：`E:\play\claude\EnglishReader-private-qa-v2.0.0-47-debug.apk`，36,878,049 bytes，SHA-256 `54AA7575D6EAC83502CF45DA28209BCD4DA5D7327943EF9D1A549E7CD6FA7416`。包内 private-qa 资源版本、5 个私有/合成题包和默认关闭的 WebView 实验开关均已校验。
- 尚待用户在真实平板验证：竖横屏旋转、系统分屏/自由窗口、软键盘遮挡、阅读侧栏、20 词复习、真题作答双栏、外接键盘焦点和返回键。桌面尺寸截图不能替代这些原生窗口行为。
