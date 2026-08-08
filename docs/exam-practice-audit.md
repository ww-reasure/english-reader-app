# 真题训练 Phase 0 仓库审计

审计日期：2026-08-07
仓库：`english-reader/mobile`，版本 `1.9.3`
分支：`feat/english-practice-machine`

## 结论

### 可复用

- `src/api.js` 的 `chatCompletion(messages, { tools, signal })` 可作为后续 AI Tutor 的统一 OpenAI-compatible 入口。
- `src/components/chat-service.js` 已实现带 `AbortController` 的多轮会话、tool fallback 和分轮工具执行，后续可直接承载 `exam_question / translation_attempt` 追问。
- `src/components/conversation-store.js` 已实现版本化 localStorage 会话、摘要压缩和按会话键持久化；扩展新会话类型时沿用其迁移机制。
- `src/components/sentence-selection.mjs` 的句子边界与文本节点选区是纯函数，可在后续真题阅读中复用。
- `src/components/rich-text.js` 的 `renderLearningMarkdown` 可复用为安全 Markdown 渲染。
- 现有 `exam-corpus:*` / `exam-focus:*` 的“固定来源版本 + manifest + SHA-256 + validator + 可复现 build”模式可复用到 Exam Pack 生产链。
- `fake-indexeddb` 已用于测试，新的 DB migration 测试沿用该模式。

### 不复用或暂不抽取

- `src/components/ai-analysis.js` 暂不重构，也不抽取 `TutorThreadController`。Phase 0 只记录结论；最小抽取留到 AI Tutor 对应功能阶段。
- 现有 `exam-corpus:*` 是单词频率/例句语料，不是可判分题库；其内容模型不能直接用于 Exam Practice。
- `exam-focus:*` 是公开词表方向层，只作为词典/质量标签来源，不进入题库判分域。
- 现有 `articles`、`knowledgeEvidence`、`readingStats` 不承载真题题库或题目作答；新考试域必须独立建 store。
- 不修改 `#/chat` 首页，不重排首页产品定位。

## Phase 0 边界

- 只新增确定必需的 exam core stores；不新增 Exam Skill Profile 或 AI 专用持久化结构。
- 所有 exam 用户数据查询必须显式携带 `examId`；涉及题库时显式携带 `bankId/packageId`。`currentExamId` 只能作为 UI preference。
- Exam Pack 升级只替换内容域，依靠稳定的 `paperKey/unitKey/questionKey` 保证未来 attempts、错题状态、收藏和历史记录继续关联。
- `bankId` 是全局唯一语义作用域，不允许跨考试或跨无关题库复用；`packageId` 只作为来源/版本 provenance。
- 提交时必须保存 `correctOptionKeyAtSubmit`、`questionHashAtSubmit`，attempt 保存 `packageVersionAtStart`、`paperHashAtStart`，保证题库修订后旧判分仍一致。
- 真实 2026 英语一 / CET-4 题库源留在本地私有目录并 gitignore；仓库内测试只使用 synthetic fixture。
