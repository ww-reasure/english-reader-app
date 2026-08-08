# Exam Tutor Context Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, offline `ExamTutorContextBuilder` that turns one submitted exam response and its source content into a future ChatService-ready context without calling an AI service or modifying the Result UI.

**Architecture:** A new pure ESM `ExamTutorContextBuilder` in `src/exam/` will accept only supplied attempt, response, question, and unit/passage data. Its `build()` method will produce a serializable `pageContext`-shaped object plus the stable conversation key `exam:<attemptId>:question:<questionKey>`. Its correct-answer value will prefer `correctOptionKeyAtSubmit` over the supplied question's current answer. It never reads current content by identity, persists a conversation, invokes ChatService, or changes UI, so historical attempts remain isolated by their submitted snapshot fields.

**Tech Stack:** Native ES modules, Node test runner, existing exam canonical content, ChatService's `ask({ sessionKey, session, userMessage, kind, pageContext })` contract.

---

### Task 1: Specify the pure context contract with failing tests

**Files:**
- Create: `tests/exam-tutor-context.test.mjs`
- Create: `src/exam/exam-tutor-context.mjs`

- [x] **Step 1: Write the failing completeness test**

```js
import { ExamTutorContextBuilder } from '../src/exam/exam-tutor-context.mjs';

test('builds complete serializable tutor context from one submitted response', () => {
  const context = new ExamTutorContextBuilder().build({ attempt, response, question, unit });
  assert.equal(context.conversationKey, 'exam:attempt-1:question:kaoyan_en1_2026_q22');
  assert.equal(context.pageContext.exam.answer.correctOptionKey, 'D');
  assert.equal(context.pageContext.exam.question.evidence, 'Evidence sentence.');
  assert.deepEqual(context.pageContext.exam.question.optionAnalysis, [{ key: 'B', text: '与原文相反' }]);
  assert.deepEqual(context.pageContext.exam.passage.paragraphs, [{ key: 'P1', text: 'Passage paragraph.' }]);
});
```

- [x] **Step 2: Run the new test to verify it fails**

Run: `node --test tests/exam-tutor-context.test.mjs`

Expected: FAIL because `src/exam/exam-tutor-context.mjs` does not exist yet.

- [x] **Step 3: Implement the minimal builder**

```js
export class ExamTutorContextBuilder {
  build({ attempt, response, question, unit }) {
    return {
      conversationKey: `exam:${attempt.attemptId}:question:${question.questionKey}`,
      kind: 'exam',
      pageContext: {
        exam: { attempt: { /* snapshot fields */ }, answer: { /* learner answer and correctOptionKeyAtSubmit */ }, question: { /* analysis fields without mutable current answer */ }, passage: { paragraphs: [] } }
      }
    };
  }
}
```

- [x] **Step 4: Run the new test to verify it passes**

Run: `node --test tests/exam-tutor-context.test.mjs`

Expected: PASS.

### Task 2: Lock historical isolation and compatibility boundaries

**Files:**
- Modify: `tests/exam-tutor-context.test.mjs`
- Modify: `src/exam/exam-tutor-context.mjs`

- [x] **Step 1: Write the failing historical-isolation and no-side-effect tests**

```js
test('separates historical attempts and retains each submitted answer snapshot', () => {
  const builder = new ExamTutorContextBuilder();
  const oldContext = builder.build({ attempt: oldAttempt, response: oldResponse, question: revisedQuestion, unit });
  const newContext = builder.build({ attempt: newAttempt, response: newResponse, question: revisedQuestion, unit });
  assert.equal(oldContext.conversationKey, 'exam:attempt-old:question:kaoyan_en1_2026_q22');
  assert.equal(oldContext.pageContext.exam.answer.correctOptionKey, 'D');
  assert.equal(newContext.pageContext.exam.answer.correctOptionKey, 'A');
});

test('does not include mutable conversation or API dependencies', async () => {
  const source = await readFile(new URL('../src/exam/exam-tutor-context.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /ChatService|ConversationStore|fetch\(|chatCompletion|\.ask\(/);
});
```

- [x] **Step 2: Run the new test to verify it fails**

Run: `node --test tests/exam-tutor-context.test.mjs`

Expected: FAIL until the output preserves response snapshots and excludes mutable implementation references.

- [x] **Step 3: Keep the builder snapshot-only and serializable**

```js
const responseSnapshot = {
  answer: response.answer ?? null,
  uncertain: Boolean(response.uncertain),
  correct: response.correct ?? null,
  correctOptionKeyAtSubmit: response.correctOptionKeyAtSubmit ?? null,
  questionHashAtSubmit: response.questionHashAtSubmit ?? null
};
```

Copy only the specified fields into a newly allocated plain object/array structure; do not expose mutable caller references and do not read repositories, stores, localStorage, or APIs.

- [x] **Step 4: Run the new test to verify it passes**

Run: `node --test tests/exam-tutor-context.test.mjs`

Expected: PASS.

### Task 3: Verify the phase boundary

**Files:**
- Modify: `task_plan.md`
- Modify: `progress.md`

- [x] **Step 1: Run the focused test file**

Run: `node --test tests/exam-tutor-context.test.mjs`

Expected: all context contract tests PASS.

- [x] **Step 2: Run the full regression suite**

Run: `node --test tests/*.test.mjs`

Expected: all tests PASS (at least the prior 655 plus new tests), with zero failures.

- [x] **Step 3: Run the Vite build**

Run: `npx vite build`

Expected: exit code 0.

- [x] **Step 4: Record completion without expanding scope**

Update `task_plan.md` and `progress.md` to mark Phase 3A's offline context boundary complete, explicitly noting that no API request, ChatService/ConversationStore session creation, Result UI change, or AI Tutor interaction was added.
