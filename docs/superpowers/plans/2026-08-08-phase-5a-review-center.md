# Phase 5A Review Center Implementation Plan

> **For agentic workers:** execute test-first, one behavior at a time.

**Goal:** Add objective-question review scheduling and a Review Center without changing canonical exam content or response semantics.

**Architecture:** A pure scheduler owns all state transitions. The practice service applies its transition outputs atomically with submitted attempts and response snapshots. A new review view queries due states and groups objective items by their original unit.

**Scope guard:** No CET-4, Skill Profile, bookmark browser, batch imports, or SRS optimization.

## Tasks

1. Add failing scheduler tests for add, due-correct, reactivation, unanswered, manual re-add, and translation scheduling; implement `src/exam/review-scheduler.mjs`.
2. Add failing migration/repository tests; upgrade IndexedDB to v17 with additive due-query indexes and legacy state normalization.
3. Add failing practice-service tests for origin metadata and atomic objective state transitions; implement transaction-backed submit updates.
4. Add failing view/route tests; add `#/exam/review`, Home due count, grouped objective cards, translation cards, and Result/Explanation state feedback.
5. Run targeted tests, full test suite, Vite build, then conduct the specified real 2026 smoke flow.
