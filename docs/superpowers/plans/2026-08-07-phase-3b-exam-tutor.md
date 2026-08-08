# Phase 3B Exam Tutor Minimal Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicitly user-triggered, multi-turn Exam Tutor conversation to submitted question explanations without changing grading, canonical content, or the existing Result / Explanation layout.

**Architecture:** `ExamTutorService` will compose the Phase 3A `ExamTutorContextBuilder`, a per-service `ConversationStore`, and the existing `ChatService`. A small exam-only message builder will serialize the submitted `pageContext` into read-only model context and state the tutoring constraints; no reading AI singleton or new store is introduced. `ExamPracticeView` adds one button to the submitted question head and renders a removable modal sheet whose history is loaded from the stable `exam:<attemptId>:question:<questionKey>` session key.

**Tech Stack:** Native ES modules, existing ChatService / ConversationStore, `renderLearningMarkdown`, current exam Practice Shell, Node test runner, Vite.

---

### Task 1: Define service boundary and tests first

**Files:**
- Create: `tests/exam-tutor-service.test.mjs`
- Create: `src/exam/exam-tutor-service.mjs`

- [x] Write tests for builder context forwarding, submit snapshot precedence, same-session recovery, attempt isolation, follow-up reuse, and API failure without persistence.
- [x] Run `node --test tests/exam-tutor-service.test.mjs`; verify RED because the service module is missing.
- [x] Implement `ExamTutorMessageBuilder` and `ExamTutorService` with injected `chatService`, `conversationStore`, and `ExamTutorContextBuilder`.
- [x] Pass `tools: []`, `kind: 'exam'`, the builder-produced `pageContext`, and the exact stable key to `ChatService.ask`; append user/assistant messages only after success.
- [x] Run the focused tests and verify GREEN.

### Task 2: Add the submitted-question entry and modal conversation

**Files:**
- Modify: `src/views/exam-practice.js`
- Modify: `css/style.css`
- Modify: `tests/exam-view-contract.test.mjs`

- [x] Add a submitted-only `✨ AI分析我为什么会错` / correct-answer variant button inside the existing explanation head.
- [x] Open a removable modal sheet on click, load the stable session history, auto-send the first tutoring prompt only on explicit click, and render assistant replies through `renderLearningMarkdown`.
- [x] Add input, follow-up send, loading state, retry state, close behavior, and cleanup without creating a route or changing the existing explanation sections.
- [x] Verify source contracts cover no pre-submit invocation, builder/service usage, result-page-safe error handling, and no reading singleton import.

### Task 3: Full regression and build gate

**Files:**
- Modify: `task_plan.md`
- Modify: `progress.md`

- [x] Run `node --test tests/exam-tutor-service.test.mjs tests/exam-view-contract.test.mjs`.
- [x] Run `node --test tests/*.test.mjs` and confirm zero failures.
- [x] Run `npx vite build` and confirm exit 0.
- [x] Record that no model API is called by tests, canonical/grading/state logic is unchanged, and Phase 3B stops before text selection, Translation Tutor, or Skill Profile.
