# Learning Algorithms and Difficulty Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace invalid review inferences with explicit evidence, introduce a backward-compatible relearning scheduler and review history, and make generated-reading levels measurable rather than prompt-only.

**Architecture:** Keep existing `learnWords` records and add scheduler-v2 fields only when a word is rated. Store immutable review events in IndexedDB. Extract text metrics and level profiles into a pure module so the article tool can validate/retry before it saves a card. Replace the vocabulary-size estimate with a reading profile based on explicit evidence.

**Tech Stack:** ES modules, IndexedDB, Node built-in test runner, Vite, Capacitor Android.

---

### Task 1: Review-event persistence and scheduler-v2 core

**Files:**
- Create: `src/learning-scheduler.mjs`
- Create: `tests/learning-scheduler.test.mjs`
- Modify: `src/db.js`
- Modify: `src/views/flashcard.js`

- [ ] Write failing unit tests for a forgotten word entering a 10-minute relearning state, a known new word entering a one-day learning state, due-before-new ordering, and a maximum of ten new cards per session.
- [ ] Run `node --test tests/learning-scheduler.test.mjs` and confirm the scheduler import is missing.
- [ ] Implement pure `scheduleReview(word, rating, now)` and `selectReviewQueue(words, options)` with legacy-field compatibility.
- [ ] Add IndexedDB v7 `reviewEvents` with `wordId`, `reviewedAt`, `rating`, `source`, `sawAnswer`, previous/next interval, state and scheduler version; write the word update and event in one transaction.
- [ ] Route flashcard scores through the atomic DB method and persist `source: 'flashcard'`.
- [ ] Re-run the focused tests and then all Node tests.

### Task 2: Reading-review evidence integrity

**Files:**
- Create: `tests/reading-review-scheduling.test.mjs`
- Modify: `src/views/reading.js`

- [ ] Write a failing regression test that rejects an automatic quality-5 branch for untouched review words and requires explicit word interaction before a schedule update.
- [ ] Run `node --test tests/reading-review-scheduling.test.mjs` and confirm the current auto-recognition implementation fails.
- [ ] Update reading completion so untouched words are logged only as contextual exposure; clicked/rated words use their explicit rating and `source: 'reading'`.
- [ ] Re-run focused and full tests.

### Task 3: Difficulty profile and validated article generation

**Files:**
- Create: `src/difficulty-profile.mjs`
- Create: `tests/difficulty-profile.test.mjs`
- Modify: `src/components/article-generation-tool.js`
- Modify: `src/api.js`
- Modify: `src/views/chat.js`

- [ ] Write failing tests for profile-based word-count normalization, token/sentence/target-word metrics, one corrective retry when a result misses the profile, and no save for a still-invalid article.
- [ ] Run `node --test tests/difficulty-profile.test.mjs` and confirm the profile module is missing.
- [ ] Implement profiles for CET-4, CET-6 and graduate tracks with support/standard/stretch variants; map the legacy easy/hard selection to support/stretch.
- [ ] Validate generated article text before saving, include a measured `difficultyReport`, and retry once with the deviation report.
- [ ] Replace random keyword selection with due/fuzzy/lapse-prioritized words and verify target-word appearance.
- [ ] Re-run focused and full tests.

### Task 4: Reading-profile assessment

**Files:**
- Create: `src/reading-profile.mjs`
- Create: `tests/reading-profile.test.mjs`
- Modify: `src/views/assessment.js`

- [ ] Write failing tests that calculate a reading profile from comprehension accuracy, pace, explicit lookup rate and confidence without yielding a vocabulary-size estimate.
- [ ] Run `node --test tests/reading-profile.test.mjs` and confirm the module is missing.
- [ ] Replace the weighted click heuristic and “预估词汇量” presentation with a transparent reading profile and a recommended practice track.
- [ ] Keep legacy stored assessment values readable but never present them as a measured vocabulary total.
- [ ] Re-run focused and full tests.

### Task 5: Integration verification and migration safety

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `VERSIONING.md` only if a release is requested.

- [ ] Verify fresh-v6 migration, legacy-word compatibility, review-event writes, reading completion, generation retry and assessment rendering in the browser.
- [ ] Run `node --test tests/*.test.mjs`, `npm run build`, and `npm run build:apk`.
- [ ] Inspect the Android debug APK version before any release; do not publish or bump the version without an explicit release request.
