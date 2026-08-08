# Phase 4A Translation Practice Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add offline 2026 English I Part C translation practice with free-text snapshots, optional source analysis, and independent review states without changing objective exam behavior.

**Architecture:** Extend the existing exam-md parser/canonical model with `translation` units and `translation_segment` questions. Keep responses in the existing flexible `examResponses` store using optional `value.text`; branch submission before objective grading. Add an additive review-state store only if no existing user-state store can safely hold the three translation states. Reuse the existing Practice Shell and Result/Explanation views through a dedicated translation renderer.

**Tech Stack:** Framework-free ES modules, IndexedDB, Node test runner, Vite.

---

### Task 1: Schema and parser

- [x] Add translation types, source/reference/analysis headings, canonical validation, docs, hash coverage, and synthetic tests.
- [x] Run the focused parser/schema/hash tests in red-green cycles.

### Task 2: Response and submission data path

- [x] Add optional `response.value` text shape.
- [x] Submit translation responses as immutable snapshots with null correctness and no objective answer snapshot.
- [x] Add service tests for autosave/resume, blank submission, and objective non-regression.

### Task 3: Translation review state

- [x] Add additive persistence for `needs_review`, `mostly_mastered`, `mastered`, separate from objective wrong states.
- [x] Add persistence tests and migration coverage.

### Task 4: Part C source and renderer

- [x] Normalize only source-verifiable MinerU content into `part-c.md` and `part-c.qa.md`.
- [x] Implement translation renderer and register it.

### Task 5: Practice and Result UI

- [x] Add single-segment textarea navigation, autosave/resume, blank-submit warning, immutable submitted explanation, review controls, and copy/lookup-only selection.
- [x] Add view contract and interaction tests.

### Task 6: Verification

- [x] Run focused tests, full tests, Vite build, and browser smoke test using 2026 Part C.
