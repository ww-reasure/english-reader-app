# Main Feature Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `feat/english-practice-machine` 当前私有工作树中选择性复刻 main 的四组缺失能力，并在聊天引用安全、文件导入健壮性、阅读/真题交互兼容、专项复习完成语义上优于 main；不合并 main，不覆盖当前私有真题与 V2 复习实现。

**Architecture:** 把 main 只当作行为参考，不直接 cherry-pick。新增能力尽量落在可独立测试的纯逻辑模块中，页面只做编排。聊天引用通过受限 `pageContext` 进入上下文；文章导入先解析、校验、去重再写库；阅读正文与导读共用句子/点词基础设施但保留真题选择器；专项复习用可注入存储的版本化完成记录管理时间范围，不触碰正式 SRS。

**Tech Stack:** 原生 ES Modules、Vite 8、Capacitor 8、IndexedDB、Node `node:test`、CSS、Android WebView。

---

## 0. 现场结论与保护边界

### 已在当前支线等价存在，不复刻

- Agent 联网研究：`src/components/deepseek-responses.mjs`、`src/components/web-research.mjs` 与 main 对应实现一致。
- PDF 导出：`src/components/article-pdf.mjs` 与 main 一致，阅读页已有“导出 PDF”。
- V2 复习核心：`src/review-session.mjs`、`src/recovery-scheduler.mjs`、`src/context-review-scheduler.mjs` 与 main 对应实现一致。
- 当前私有真题系统：main 没有 `src/exam/`，只能保护，不能从 main 覆盖。

### 当前支线缺失或落后于 main

| 工作包 | 缺口 | 目标改进 |
|---|---|---|
| A | AI 回复没有复制按钮；不能选中 AI 回复后引用追问 | 统一复制模块；选区追问复用首页输入框；引用作为不可信上下文并限长 |
| B | 文章只能粘贴；不能导入 txt/md/html | 文件大小/类型前置校验；清洗、英文词数校验、内容指纹去重、竞态保护 |
| C | 导读原句不能点词；句子切分较弱；没有句子配色 | 共用稳健句子边界和点词能力；配色默认关闭且仅当前页面有效；真题点词不回退 |
| D | 今日/近 7 天完成后会重复进入同一批词；结果页仍可无条件“再来一轮” | 完成锁、增量新词、显式再练；只有真实完成才写标记；专项练习仍不改 SRS |

### 实施前置条件

- [ ] 在 `E:\play\claude\english-reader\mobile` 确认分支仍为 `feat/english-practice-machine`。
- [ ] 保留当前脏工作树，不执行 clean/reset/checkout；先完成并验证当前真题启动修复，再建立本地回滚提交。
- [ ] 记录基线：

```powershell
git status --short
node --test tests/context-builder-selected-excerpt.test.mjs tests/ai-analysis-detail-interactions.test.mjs tests/review-practice.test.mjs tests/review-practice-view-contract.test.mjs tests/sentence-selection.test.mjs tests/sentence-guide.test.mjs tests/reading-sentence-guide-contract.test.mjs tests/reading-toolbar-contract.test.mjs tests/exam-word-lookup-toggle.test.mjs tests/tablet-adaptation.test.mjs
```

期望：现有 36 项用例全部通过。若当前真题修复尚未稳定，先处理该任务，不把两批改动混在一个提交中。

---

## 1. 工作包 A：AI 回复复制与引用追问

**Files:**

- Create: `src/components/message-actions.mjs`
- Create: `src/components/chat-selection-actions.mjs`
- Modify: `src/views/chat.js`
- Modify: `src/components/ai-analysis.js`
- Modify: `src/components/context-builder.js`
- Modify: `css/style.css`
- Create: `tests/chat-copy-followup.test.mjs`
- Modify: `tests/context-builder-selected-excerpt.test.mjs`
- Modify: `tests/ai-analysis-detail-interactions.test.mjs`

### Task A1：先锁定复制与选区边界

- [ ] 新建失败测试，覆盖：
  - 仅 AI 回复/AI 分析内容出现复制按钮，用户消息不出现。
  - 优先使用 `navigator.clipboard.writeText`；Android WebView 拒绝时回退临时 textarea；无论成功失败都清理节点。
  - 复制的是可见纯文本，不复制按钮文字和隐藏标签，最多 12,000 字符。
  - 引用选区压缩连续空白并限制为 600 字符；空选区无操作。
  - 选区必须位于当前 AI 回复的 `[data-chat-selectable="true"]` 内，不能跨消息、跨页面或选到用户输入。
  - 滚动、Escape、路由离开和重新渲染都会销毁浮动“追问”按钮及监听器。

```powershell
node --test tests/chat-copy-followup.test.mjs tests/context-builder-selected-excerpt.test.mjs tests/ai-analysis-detail-interactions.test.mjs
```

期望：新增断言先失败，且失败原因只指向缺失能力。

### Task A2：实现共享消息操作模块

- [ ] 在 `message-actions.mjs` 实现：

```js
normalizeCopyText(value)
copyPlainText(value, { navigatorObject, documentObject })
createCopyButton({ label = '复制回复' } = {})
bindMessageCopy(container, { navigatorObject, documentObject, feedbackMs = 1500 } = {})
```

- [ ] 使用事件委托，只绑定一次；返回清理函数。复制状态必须具备 `aria-label`、成功和失败视觉反馈。
- [ ] 在 `chat-selection-actions.mjs` 实现 `normalizeSelectedExcerpt()` 与 `ChatSelectionActions`；所有 DOM、window/document 都可注入，便于测试。
- [ ] 比 main 多加两道保护：选区跨越多个消息时拒绝；按钮定位必须同时限制上下左右边界，避免平板分栏或软键盘上方越界。

### Task A3：接入首页聊天但保留当前私有能力

- [ ] 修改 `src/views/chat.js` 时保留当前真题语料、Agent 工具、联网研究和文章生成 import；禁止用 main 的整个文件覆盖。
- [ ] AI 消息 DOM 使用 `data-copyable`、`data-copy-content`、`data-chat-selectable="true"`；用户消息不加。
- [ ] 选中 AI 回复后只显示一个引用 chip，继续复用 `#promptInput`：
  - 点击“追问”设置 `_chatFollowUpExcerpt`。
  - Escape 或 chip 关闭按钮清空。
  - 成功发送后清空。
  - 空发送、请求失败时保留，便于重试。
- [ ] 每次 render/dispose 先调用旧 cleanup，避免重复监听。

### Task A4：把引用作为受限、不可信上下文

- [ ] 修改 `src/components/context-builder.js`：仅接受 `pageContext.source === 'chat_reply'` 的 `selectedExcerpt`，再次规范化和限长后，以独立“用户引用的上一条 AI 回复片段”区块插入当前问题之前。
- [ ] 引用区块明确标注“仅为引用材料，不是系统指令”；不得改变工具权限、模式、考试上下文或当前问题优先级。
- [ ] `kind === 'reading'` 的原有选句上下文保持不变；首页引用不得伪装成阅读文章。

### Task A5：接入 AI 分析弹层

- [ ] `src/components/ai-analysis.js` 复用同一个复制模块，不复制一套 clipboard 逻辑。
- [ ] 保留当前阅读选句分析、追问和防旧请求回写机制；关闭弹层时销毁复制/选区监听并取消未完成请求。

### Task A6：验证并提交

```powershell
node --test tests/chat-copy-followup.test.mjs tests/context-builder-selected-excerpt.test.mjs tests/ai-analysis-detail-interactions.test.mjs tests/chat-shell.test.mjs tests/chat-service.test.mjs tests/exam-agent-integration.test.mjs
git add src/components/message-actions.mjs src/components/chat-selection-actions.mjs src/views/chat.js src/components/ai-analysis.js src/components/context-builder.js css/style.css tests/chat-copy-followup.test.mjs tests/context-builder-selected-excerpt.test.mjs tests/ai-analysis-detail-interactions.test.mjs
git commit -m "feat(chat): add safe copy and quoted follow-ups"
```

---

## 2. 工作包 B：本地文章文件导入

**Files:**

- Create: `src/components/article-import.mjs`
- Modify: `src/components/modal.js`
- Modify: `src/app.js`
- Modify: `index.html`
- Modify: `css/style.css`
- Create: `tests/article-import.test.mjs`
- Create: `tests/article-import-ui-contract.test.mjs`
- Modify: `tests/article-catalog-db.test.mjs`

### Task B1：先定义输入与拒绝规则

- [ ] 新建失败测试，覆盖 txt/md/markdown/html/htm；BOM、零宽字符、HTML script/style、Markdown 标记、HTML 实体、混合换行。
- [ ] 新增优于 main 的边界：
  - 读取前拒绝大于 2 MiB 的文件。
  - 扩展名和 MIME 任一明确不支持时拒绝；空 MIME 允许按扩展名判断。
  - 正文至少 3 个英文词、最多 50,000 个英文词。
  - 同内容仅空白、大小写或无害标点间距变化时判重复；同标题不同正文允许导入。
  - 文件 A 解析未完成时再选文件 B，A 的迟到结果不得覆盖 B。

### Task B2：实现纯解析模块

- [ ] 在 `article-import.mjs` 实现并导出：

```js
normalizeImportedContent(value, { format = 'text' } = {})
countEnglishWords(value)
validateImportedContent(value, { minWords = 3, maxWords = 50000 } = {})
contentFingerprint(value)
titleFromFileName(fileName)
parseImportedDocument(file, { maxBytes = 2 * 1024 * 1024 } = {})
prepareImportedArticle(input)
```

- [ ] HTML 只转纯文本，不把导入内容注入 `innerHTML`；删除 script/style/noscript/template，保留段落换行并解码安全实体。
- [ ] Markdown 去掉标题、列表、链接和强调语法，保留可读文本；代码块只保留可见文本，不执行任何内容。
- [ ] 指纹不作为用户可见内容；文章对象可增加 `sourceType:'imported'`、`source:'local'`、`fileName`、`wordCount`、`contentFingerprint`，IndexedDB 对象存储无需升级版本。

### Task B3：接入导入弹窗

- [ ] `index.html` 在现有粘贴表单中增加 `#importFile` 和 `#importStatus[aria-live="polite"]`，不删除手工粘贴入口。
- [ ] `src/components/modal.js`：
  - 文件选择后显示解析中/成功/失败状态。
  - 自动填标题和正文，但用户之后仍可编辑。
  - 保存时以文本框最终内容重新规范化、校验和计算指纹。
  - 通过 `DB.getAllArticles()` 比较指纹；重复时不写库并给出明确提示。
  - 保存按钮在解析/写库期间 disabled，使用 request id 防旧文件结果覆盖。
  - 关闭弹窗时重置 file input、状态、pending promise 和 request id。
- [ ] `src/app.js` 只增加必要绑定；避免重复 `change` 监听。

### Task B4：验证并提交

```powershell
node --test tests/article-import.test.mjs tests/article-import-ui-contract.test.mjs tests/article-catalog-db.test.mjs tests/reading-list-shell-preservation.test.mjs
git add src/components/article-import.mjs src/components/modal.js src/app.js index.html css/style.css tests/article-import.test.mjs tests/article-import-ui-contract.test.mjs tests/article-catalog-db.test.mjs
git commit -m "feat(articles): import validated local documents"
```

---

## 3. 工作包 C：阅读导读、句子配色与点词增强

**Files:**

- Modify: `src/components/sentence-selection.mjs`
- Create: `src/components/reading-word-context.mjs`
- Modify: `src/components/reading-word-lookup.js`
- Modify: `src/components/word-point.js`
- Modify: `src/components/sentence-long-press.mjs`
- Modify: `src/views/reading.js`
- Modify: `src/components/tooltip.js`
- Modify: `css/style.css`
- Modify: `tests/sentence-selection.test.mjs`
- Create: `tests/reading-word-lookup.test.mjs`
- Modify: `tests/reading-sentence-guide-contract.test.mjs`
- Modify: `tests/reading-toolbar-contract.test.mjs`
- Modify: `tests/sentence-long-press.test.mjs`
- Modify: `tests/exam-word-lookup-toggle.test.mjs`
- Modify: `tests/exam-ui-controls.test.mjs`
- Modify: `tests/tablet-adaptation.test.mjs`

### Task C1：先建立“正文更强、真题不退化”的契约

- [ ] 扩充句子切分测试：`Mr.`、`Dr.`、`e.g.`、小数、缩写首字母、问号/感叹号、引号和右括号后的句末、跨高亮文本节点、段尾无标点。
- [ ] 新建导读点词测试：导读原句点击单词只触发一次 tooltip；不触发句子切换或关闭弹层；dispose 后监听彻底移除。
- [ ] 增加真题回归：`.exam-practice-paragraph`、`.exam-question-stem`、选项文本仍能点词；“点词翻译”开关关闭后正文和导读都不查词。
- [ ] 增加平板回归：句子配色和导读不改变真题 60/40 分栏、拖拽线和右侧纵向滚动。

### Task C2：统一句子边界和点击位置

- [ ] 在 `sentence-selection.mjs` 让 `splitSentences()` 与 `findSentenceOffsets()` 共用同一套边界规则，并返回源字符串 offset；不靠二次搜索猜位置。
- [ ] 保留当前 `sentence-long-press.mjs` 的原生选择保护与抑制逻辑；只替换句子边界调用，不能用 main 文件整段覆盖。
- [ ] 保留 `src/components/word-point.js` 作为当前公共入口；如引入 `.mjs` 实现，则 `word-point.js` 只做兼容重导出，避免现有真题 import 断裂。
- [ ] 新建 `reading-word-context.mjs`，从点击坐标解析当前 `.reading-sentence` 或块级正文的完整句子；选择器集合必须包含现有阅读和真题容器。

### Task C3：扩展共享点词绑定

- [ ] `bindReadingStyleWordLookup({ root, enabled, surface='reading', getSentence })` 支持 `surface:'guide'`。
- [ ] guide 表面使用事件隔离，正文保持现有行为；两者都使用同一词形提取、句子上下文、tooltip 与收藏逻辑。
- [ ] 忽略按钮、链接、输入框、已打开 tooltip 和不可见文本；一次点击最多发一个查询。

### Task C4：改造逐句导读和句子配色

- [ ] `ReadingView._splitGuideSentences()` 改用统一 `splitSentences()`；每条包含 paragraph index、source offset 和原句，确保缓存/导航稳定。
- [ ] `_renderGuideSource()` 把英文词渲染为可聚焦 token，但保持连续可复制文本；键盘 Enter/Space 可查词。
- [ ] 导读弹层打开时绑定 guide lookup，切句先清理旧绑定，关闭/路由离开时取消请求并清理。
- [ ] 增加“句子配色”按钮：默认关闭、只在当前阅读页面内有效、离开文章恢复关闭；使用 3～4 个低对比度循环色和 `aria-pressed`。
- [ ] 配色通过包装句子 span 实现，但必须保留源文本、阅读进度、长按选句、收藏词高亮和复制结果；关闭时恢复无包装的等价文本。

### Task C5：验证并提交

```powershell
node --test tests/sentence-selection.test.mjs tests/sentence-long-press.test.mjs tests/reading-word-lookup.test.mjs tests/reading-sentence-guide-contract.test.mjs tests/reading-toolbar-contract.test.mjs tests/reading-word-marking-contract.test.mjs tests/reading-contextual-sense-contract.test.mjs tests/exam-word-lookup-toggle.test.mjs tests/exam-ui-controls.test.mjs tests/tablet-adaptation.test.mjs
git add src/components/sentence-selection.mjs src/components/reading-word-context.mjs src/components/reading-word-lookup.js src/components/word-point.js src/components/sentence-long-press.mjs src/views/reading.js src/components/tooltip.js css/style.css tests/sentence-selection.test.mjs tests/sentence-long-press.test.mjs tests/reading-word-lookup.test.mjs tests/reading-sentence-guide-contract.test.mjs tests/reading-toolbar-contract.test.mjs tests/exam-word-lookup-toggle.test.mjs tests/exam-ui-controls.test.mjs tests/tablet-adaptation.test.mjs
git commit -m "feat(reading): strengthen guide and word interactions"
```

---

## 4. 工作包 D：专项复习完成状态与增量词集

**Files:**

- Modify: `src/review-practice.mjs`
- Modify: `src/views/vocabulary.js`
- Modify: `src/views/flashcard.js`
- Modify: `css/style.css`
- Modify: `tests/review-practice.test.mjs`
- Modify: `tests/review-practice-view-contract.test.mjs`
- Create: `tests/flashcard-practice-completion.test.mjs`
- Modify: `tests/db-review-practice.test.mjs`
- Modify: `tests/srs-status-integration.test.mjs`

### Task D1：先定义完成语义

- [ ] 新增失败测试：
  - `today_added` 仅当天有效；次日本地零点自动开放。
  - `recent_added` 完成记录 7 天内有效；滚动窗口出现新词时只练新词。
  - `manual` 永不锁定。
  - 中途退出、空队列、路由 scope 不匹配、损坏 session 均不得标记完成。
  - 全部词真实完成后才写标记、清 session，并让迟到的学习资料请求无法重绘结果页。
  - “再来一轮”是显式动作：清除该 scope 的当前完成限制后重新生成会话；不能在结果页自动继续旧 session。
  - 所有练习评分仍只写 `reviewEvents`，`nextReview/interval/state/easeFactor/reviewCount/reviewRevision/recoveryStage` 全部不变。

### Task D2：实现可测试的版本化完成记录

- [ ] 在 `review-practice.mjs` 增加：

```js
markPracticeScopeDone(scope, { wordIds, now = Date.now(), storage = globalThis.localStorage } = {})
readPracticeScopeDone(scope, { now = Date.now(), storage = globalThis.localStorage } = {})
clearPracticeScopeDone(scope, { storage = globalThis.localStorage } = {})
getPracticeScopeStatus({ scope, currentWordIds, now = Date.now(), storage = globalThis.localStorage })
```

- [ ] 比 main 更稳：所有存储显式可注入；localStorage 不可用时返回未锁定状态，不抛异常；记录含 `version:2`、scope、去重 wordIds、completedAt。
- [ ] 支持 main 的 v1 日期键迁移，但迁移失败保留旧键，损坏键忽略；不迁移 sessionStorage 的练习快照。

### Task D3：词汇页三态入口

- [ ] 今日新增/最近 7 天显示：
  - 未练：`n 词`，启动全部当前词。
  - 已练但新增：`新增 n 词`，只启动 `newIds`。
  - 已完成：禁用主启动，显示“已完成”；另提供明确“再练一轮”。
- [ ] `skipped` 继续显示“未进入学习词库”数量；不能把 skipped 算进完成词数。
- [ ] 管理模式、自选模式、菜单按钮和计数刷新保持现有互斥与可见性。

### Task D4：闪卡完成结算

- [ ] 进入 practice 时校验 route scope 与 session scope；按 id 重新读取最新 `learnWords`，缺失项跳过但记录原因。
- [ ] 结果页前递增 `cardSession` 并取消/失效所有学习资料请求，防止旧请求覆盖结果页。
- [ ] 仅当会话中所有有效 wordId 都完成评分后调用 `markPracticeScopeDone()`；随后 `clearPracticeSession()` 并清空内存 scope。
- [ ] 专项结果页返回 `#/vocab`；不显示会误用旧 session 的普通“再来一轮”。显式再练由词汇页创建新 session。
- [ ] `recordLearnWordPractice` 路径保持不变，禁止调用 `recordLearnWordReview` 或 recovery 结算器。

### Task D5：验证并提交

```powershell
node --test tests/review-practice.test.mjs tests/review-practice-view-contract.test.mjs tests/flashcard-practice-completion.test.mjs tests/db-review-practice.test.mjs tests/srs-status-integration.test.mjs tests/review-session.test.mjs tests/recovery-scheduler.test.mjs
git add src/review-practice.mjs src/views/vocabulary.js src/views/flashcard.js css/style.css tests/review-practice.test.mjs tests/review-practice-view-contract.test.mjs tests/flashcard-practice-completion.test.mjs tests/db-review-practice.test.mjs tests/srs-status-integration.test.mjs
git commit -m "fix(review): complete scoped practice incrementally"
```

---

## 5. 集成、审查与私有 APK 闸门

### Task E1：跨功能审查

- [ ] 检查四个提交只修改列出的文件；任何 main 的发布版本、README、公共题包或无关样式不得带入。
- [ ] 审查监听器、AbortController、timeout 和临时 DOM 节点是否在 route dispose/弹层关闭时清理。
- [ ] 审查所有用户导入文本、AI 回复、引用文本都作为数据处理，不以 `innerHTML` 直接注入，不提升为指令。
- [ ] 审查专项练习事件不更改正式 SRS，阅读增强不改变真题点词和双栏布局。

### Task E2：全量自动验证

```powershell
node --test tests/*.test.mjs
npm run build:private-qa
```

期望：全量测试零失败；私有题包五份均进入 `www/exam-packs/private/`；Vite 与 Capacitor 同步成功。

### Task E3：浏览器冒烟

- [ ] 手机宽度：复制 AI 回复；选中回复追问；Escape 清引用；软键盘不遮挡 chip。
- [ ] 导入 txt/md/html；重复文件被拒绝；2 MiB 超限文件在读取前被拒绝；粘贴入口仍可用。
- [ ] 阅读正文：长按选句、点词、配色开关、导读点词、PDF 导出、返回均正常。
- [ ] 真题：手机上下抽屉、平板双栏拖拽、题干/文章点词、解析换题均正常。
- [ ] 专项复习：今日新增完成后锁定；再添加词只练新增；手动选词可重复；正式待复习日期无变化。

### Task E4：最终构建（得到用户明确“打包”指令后执行）

- [ ] 保持语义版本策略，不复制 main 的 `1.9.4/versionCode 41`；在当前 `2.0.0` 基础上只递增 Android `versionCode`。
- [ ] 构建并输出私有 QA APK：

```powershell
npm run build:apk
Get-FileHash -Algorithm SHA256 E:\play\claude\EnglishReader-private-qa-*.apk
```

- [ ] 把 APK 复制到 `E:\play\claude\`，交付文件名、SHA-256、测试结果和四组功能清单。

---

## 6. Luna 子代理执行建议

四个工作包代码互相有少量交叉（`css/style.css`，聊天与阅读都碰 `ai-analysis.js`），不应让多个代理同时直接编辑同一工作树。推荐顺序：

1. Luna worker A：工作包 A；主代理审查并提交。
2. Luna worker B：工作包 B；主代理审查并提交。
3. Luna worker C：工作包 C；这是风险最高的一组，主代理重点检查真题兼容。
4. Luna worker D：工作包 D；主代理重点检查 SRS 不变量。
5. Luna review worker：使用独立只读任务审查安全、竞态、监听清理和测试缺口。
6. 主代理：复核审查结论，完成全量测试、浏览器冒烟和最终打包。

每个 worker 只接收对应工作包、当前分支保护边界和测试命令；不得 merge main、不得改版本、不得打包、不得处理其他工作包。

## 7. 完成定义

- 四组能力达到或超过 main 的用户体验。
- 当前私有真题、Agent 联网研究、PDF 导出、V2 Recovery 调度无回归。
- 专项练习任何路径都不改变正式 SRS。
- 本地文件与 AI/用户引用均有明确大小、来源和生命周期边界。
- 全量测试、私有构建、手机和平板冒烟全部通过。
- 所有改动留在 `feat/english-practice-machine` 本地工作树，不合并、不推送 main。
