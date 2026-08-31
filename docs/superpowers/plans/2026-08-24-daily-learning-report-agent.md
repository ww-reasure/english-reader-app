# Daily Learning Report Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, deterministic daily-learning ledger and report that lets the home Agent explain vocabulary imports, reading, reviews, and exam work by date, while treating repeated PDF words as one bounded external-review signal per local day.

**Architecture:** Existing stores remain the source of truth for reading, SRS, and exam results. Two additive IndexedDB stores fill telemetry gaps and cache 30-day reports; pure local modules own day boundaries, external-review credit, time slices, aggregation, and Markdown. The home Agent receives bounded read-only tools and a report-card artifact, while AI only writes analysis over immutable local facts.

**Tech Stack:** Vanilla ES modules, Vite 8, Capacitor Android 8, IndexedDB/fake-indexeddb, existing OpenAI-compatible `ChatService`, Node built-in test runner, CSS.

---

## Execution constraints

- Start from the current tip of `feat/english-practice-machine`, which contains the approved design and this plan.
- Do not switch or modify the user's active worktree.
- Create branch `feat/daily-learning-report-agent` in a new worktree under `.worktrees/daily-learning-report-agent`.
- Do not merge, push, tag, or modify `main`.
- Preserve all private exam packs under `public/exam-packs/private/` without rewriting them.
- Execute tasks in order. Each task must have focused green tests and its own commit before the next task begins.
- If a test exposes unrelated existing behavior, document it and stop instead of broadening scope.
- Use `apply_patch` for source edits. Do not reset, clean, or discard user changes.

## Approved design

Read before implementation:

- `docs/superpowers/specs/2026-08-24-daily-learning-report-agent-design.md`

The design is authoritative for product semantics. This plan is authoritative for execution order and file ownership.

## File structure

| File | Responsibility |
| --- | --- |
| `src/learning-day.mjs` | Local day keys, local-day bounds, retention checks, and DST-safe interval splitting. |
| `src/learning-activity.mjs` | Activity types, bounded event normalization, dedupe keys, and report completeness constants. |
| `src/external-review-scheduler.mjs` | Pure 25%-credit external-review calculation with Recovery protection. |
| `src/word-import-service.mjs` | Import normalization, pre-analysis, batch execution, progress, and resumable result summaries. |
| `src/study-session-timer.mjs` | Foreground/idle-aware active slices split by context and local day. |
| `src/daily-learning-report.mjs` | Pure daily aggregation, trends, stable ordering, completeness, and Markdown formatting. |
| `src/daily-learning-report-service.mjs` | Load facts, fingerprint, persist/prune reports, call optional AI analysis, and expose bounded Agent payloads. |
| `src/components/daily-report-card.mjs` | Accessible collapsed/expanded report artifact renderer. |
| `src/db.js` | DB v18 stores, activity/report repository methods, and atomic word-import signal transaction. |
| `src/views/chat.js` | Import 2.0 UI, “今日日报” quick action, Agent tool artifacts, card persistence/restoration. |
| `src/components/reading-word-lookup.js`, `src/components/tooltip.js`, `src/views/reading.js` | Successful lookup and reading-save telemetry. |
| `src/views/flashcard.js`, `src/views/context-review.js` | Review session timing and one summary event per completed/partial session. |
| `src/views/exam-practice.js` | Per-unit active slices while preserving attempt-level duration and autosave. |
| `src/components/learning-agent.js`, `src/components/context-builder.js` | Bounded read-only daily-report tools and non-fabrication instructions. |
| `src/components/conversation-store.js`, `src/components/message-actions.mjs` | Report references in chat and full-Markdown copy payload. |
| `css/style.css` | Import preview and responsive daily-report card states. |
| `tests/*.test.mjs` | Pure logic, fake IndexedDB, view contracts, Agent tools, and regression coverage. |

---

### Task 0: Create the isolated execution worktree and establish the baseline

**Files:**
- Read: `AGENTS.md`
- Read: `docs/superpowers/specs/2026-08-24-daily-learning-report-agent-design.md`
- Read: `docs/superpowers/plans/2026-08-24-daily-learning-report-agent.md`

- [ ] **Step 1: Verify the source worktree and branch are clean**

Run from `E:\play\claude\english-reader\mobile`:

```powershell
git rev-parse --show-toplevel
git branch --show-current
git status --short
git log -1 --oneline
```

Expected: root is `E:/play/claude/english-reader/mobile`, branch is `feat/english-practice-machine`, and `git status --short` is empty.

- [ ] **Step 2: Create a dedicated branch and worktree**

```powershell
git worktree add ".worktrees/daily-learning-report-agent" -b feat/daily-learning-report-agent feat/english-practice-machine
```

Expected: Git reports a new worktree checked out on `feat/daily-learning-report-agent`.

- [ ] **Step 3: Load dependencies and verify the new worktree**

Run from `E:\play\claude\english-reader\mobile\.worktrees\daily-learning-report-agent`:

```powershell
npm install
git branch --show-current
git status --short
```

Expected: branch is `feat/daily-learning-report-agent`; status is empty. If dependencies are already linked or installed, `npm install` may report up-to-date.

- [ ] **Step 4: Run the complete baseline suite**

```powershell
node --test tests/*.test.mjs
```

Expected: zero failures. Record the total/pass/skip counts in the task handoff.

---

### Task 1: Add local-day and active-interval primitives

**Files:**
- Create: `src/learning-day.mjs`
- Create: `tests/learning-day.test.mjs`

- [ ] **Step 1: Write failing local-day tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  localDayKey,
  localDayBounds,
  splitIntervalByLocalDay,
  isDayRetained
} from '../src/learning-day.mjs';

test('localDayKey uses local calendar fields instead of UTC', () => {
  const value = new Date(2026, 7, 24, 23, 30).getTime();
  assert.equal(localDayKey(value), '2026-08-24');
});

test('localDayBounds round-trips one valid local date', () => {
  const bounds = localDayBounds('2026-08-24');
  assert.equal(localDayKey(bounds.start), '2026-08-24');
  assert.equal(localDayKey(bounds.end - 1), '2026-08-24');
  assert.equal(localDayKey(bounds.end), '2026-08-25');
});

test('splitIntervalByLocalDay assigns time on both sides of midnight', () => {
  const startedAt = new Date(2026, 7, 24, 23, 59, 50).getTime();
  const endedAt = new Date(2026, 7, 25, 0, 0, 20).getTime();
  assert.deepEqual(splitIntervalByLocalDay({ startedAt, endedAt }), [
    { dayKey: '2026-08-24', startedAt, endedAt: new Date(2026, 7, 25, 0, 0, 0).getTime(), durationMs: 10_000 },
    { dayKey: '2026-08-25', startedAt: new Date(2026, 7, 25, 0, 0, 0).getTime(), endedAt, durationMs: 20_000 }
  ]);
});

test('retention includes today and the previous 29 local dates', () => {
  const now = new Date(2026, 7, 24, 12).getTime();
  assert.equal(isDayRetained('2026-07-26', { now, days: 30 }), true);
  assert.equal(isDayRetained('2026-07-25', { now, days: 30 }), false);
});
```

- [ ] **Step 2: Run the test and verify RED**

```powershell
node --test tests/learning-day.test.mjs
```

Expected: FAIL because `src/learning-day.mjs` does not exist.

- [ ] **Step 3: Implement the complete local-day API**

```js
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function localDayKey(timestamp = Date.now()) {
  const date = new Date(Number(timestamp));
  if (!Number.isFinite(date.getTime())) throw new TypeError('需要有效时间');
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function localDayBounds(dayKey) {
  const match = DAY_KEY.exec(String(dayKey || ''));
  if (!match) throw new TypeError('日期必须为 YYYY-MM-DD');
  const [, year, month, day] = match.map(Number);
  const startDate = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (startDate.getFullYear() !== year || startDate.getMonth() !== month - 1 || startDate.getDate() !== day) {
    throw new TypeError('日期不存在');
  }
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 1);
  return { start: startDate.getTime(), end: endDate.getTime() };
}

export function splitIntervalByLocalDay({ startedAt, endedAt }) {
  let cursor = Number(startedAt);
  const finish = Number(endedAt);
  if (!Number.isFinite(cursor) || !Number.isFinite(finish) || finish <= cursor) return [];
  const slices = [];
  while (cursor < finish) {
    const dayKey = localDayKey(cursor);
    const boundary = Math.min(finish, localDayBounds(dayKey).end);
    slices.push({ dayKey, startedAt: cursor, endedAt: boundary, durationMs: boundary - cursor });
    cursor = boundary;
  }
  return slices;
}

export function isDayRetained(dayKey, { now = Date.now(), days = 30 } = {}) {
  const count = Math.max(1, Math.trunc(Number(days) || 30));
  const today = new Date(localDayBounds(localDayKey(now)).start);
  today.setDate(today.getDate() - (count - 1));
  const candidate = localDayBounds(dayKey).start;
  return candidate >= today.getTime() && candidate < localDayBounds(localDayKey(now)).end;
}
```

- [ ] **Step 4: Run focused tests**

```powershell
node --test tests/learning-day.test.mjs
```

Expected: 4 tests pass, 0 fail.

- [ ] **Step 5: Commit**

```powershell
git add src/learning-day.mjs tests/learning-day.test.mjs
git commit -m "feat(analytics): add local learning day primitives"
```

---

### Task 2: Add activity contracts and DB v18 repositories

**Files:**
- Create: `src/learning-activity.mjs`
- Modify: `src/db.js:64-336`
- Modify: `src/db.js` after existing reading/review repository methods
- Create: `tests/learning-activity.test.mjs`
- Create: `tests/learning-activity-db.test.mjs`
- Modify: `tests/exam-db-migration.test.mjs`

- [ ] **Step 1: Write failing event-contract tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ActivityType,
  Completeness,
  importWordDedupeKey,
  normalizeLearningActivity
} from '../src/learning-activity.mjs';

test('normalizes bounded learning activity records', () => {
  const event = normalizeLearningActivity({
    id: 'event-1',
    type: ActivityType.READING_WORD_LOOKUP,
    occurredAt: new Date(2026, 7, 24, 9).getTime(),
    sessionId: 'reading:7',
    payload: { lemma: 'Constraint', title: 'x'.repeat(400) }
  });
  assert.equal(event.dayKey, '2026-08-24');
  assert.equal(event.payload.lemma, 'constraint');
  assert.equal(event.payload.title.length, 240);
  assert.equal(Completeness.PARTIAL, 'partial');
});

test('builds one stable per-day import key', () => {
  assert.equal(importWordDedupeKey('2026-08-24', 'Constraint'), 'import-word:2026-08-24:constraint');
});
```

- [ ] **Step 2: Write failing fake-IndexedDB migration and CRUD tests**

Use the same cache-busting import pattern as `tests/db-review-events.test.mjs` and assert:

```js
test('v18 adds telemetry stores without changing existing learnWords', async () => {
  const db = await loadFreshDb('LearningActivityMigration');
  const opened = await db.open();
  assert.equal(opened.objectStoreNames.contains('learningActivityEvents'), true);
  assert.equal(opened.objectStoreNames.contains('dailyLearningReports'), true);
  assert.equal(opened.transaction('learnWords').objectStore('learnWords').indexNames.contains('word'), true);
});

test('activity dedupeKey is unique while ordinary events may omit it', async () => {
  const db = await loadFreshDb('LearningActivityDedupe');
  await db.saveLearningActivity({ id: 'a', type: 'word_import_daily', occurredAt: 1, dayKey: '2026-08-24', dedupeKey: 'import-word:2026-08-24:word' });
  await assert.rejects(() => db.saveLearningActivity({ id: 'b', type: 'word_import_daily', occurredAt: 2, dayKey: '2026-08-24', dedupeKey: 'import-word:2026-08-24:word' }));
  await db.saveLearningActivity({ id: 'c', type: 'reading_word_lookup', occurredAt: 3, dayKey: '2026-08-24' });
  await db.saveLearningActivity({ id: 'd', type: 'reading_word_lookup', occurredAt: 4, dayKey: '2026-08-24' });
});
```

- [ ] **Step 3: Run tests and verify RED**

```powershell
node --test tests/learning-activity.test.mjs tests/learning-activity-db.test.mjs tests/exam-db-migration.test.mjs
```

Expected: FAIL because the module, DB version, and stores do not exist.

- [ ] **Step 4: Implement activity constants and normalization**

Create `src/learning-activity.mjs` with these exact exports:

```js
import { localDayKey } from './learning-day.mjs';

export const ActivityType = Object.freeze({
  WORD_IMPORT_BATCH: 'word_import_batch',
  WORD_IMPORT_DAILY: 'word_import_daily',
  READING_WORD_LOOKUP: 'reading_word_lookup',
  READING_WORD_SAVED: 'reading_word_saved',
  REVIEW_SESSION_SUMMARY: 'review_session_summary',
  EXAM_ACTIVE_SLICE: 'exam_active_slice',
  AI_LEARNING_INTERACTION: 'ai_learning_interaction'
});
export const Completeness = Object.freeze({ COMPLETE: 'complete', PARTIAL: 'partial', UNAVAILABLE: 'unavailable' });
const TYPES = new Set(Object.values(ActivityType));
const clip = (value, limit) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
export const normalizeLemma = value => clip(value, 100).toLocaleLowerCase('en-US');
export const importWordDedupeKey = (dayKey, lemma) => `import-word:${dayKey}:${normalizeLemma(lemma)}`;

export function normalizeLearningActivity(value, now = Date.now()) {
  if (!value?.id || !TYPES.has(value.type)) throw new TypeError('学习活动类型或 id 无效');
  const occurredAt = Number.isFinite(Number(value.occurredAt)) ? Number(value.occurredAt) : Number(now);
  const payload = { ...(value.payload || {}) };
  if ('lemma' in payload) payload.lemma = normalizeLemma(payload.lemma);
  if ('title' in payload) payload.title = clip(payload.title, 240);
  return {
    id: clip(value.id, 180),
    type: value.type,
    occurredAt,
    dayKey: value.dayKey || localDayKey(occurredAt),
    timezoneOffset: Number.isFinite(Number(value.timezoneOffset)) ? Number(value.timezoneOffset) : new Date(occurredAt).getTimezoneOffset(),
    sessionId: clip(value.sessionId, 180),
    ...(value.dedupeKey ? { dedupeKey: clip(value.dedupeKey, 240) } : {}),
    payload
  };
}
```

- [ ] **Step 5: Upgrade DB to v18 and create both stores**

Change `DB_VERSION` to `18`. In `onupgradeneeded`, add:

```js
if (!db.objectStoreNames.contains('learningActivityEvents')) {
  const store = db.createObjectStore('learningActivityEvents', { keyPath: 'id' });
  store.createIndex('occurredAt', 'occurredAt');
  store.createIndex('dayKey', 'dayKey');
  store.createIndex('type', 'type');
  store.createIndex('sessionId', 'sessionId');
  store.createIndex('dedupeKey', 'dedupeKey', { unique: true });
}
if (!db.objectStoreNames.contains('dailyLearningReports')) {
  const store = db.createObjectStore('dailyLearningReports', { keyPath: 'dateKey' });
  store.createIndex('updatedAt', 'updatedAt');
  store.createIndex('expiresAt', 'expiresAt');
}
```

Do not open cursors over existing user stores and do not rewrite old records.

- [ ] **Step 6: Add the bounded repository API**

Add these exact methods to `DB`:

- `saveLearningActivity(record)`: normalize with `normalizeLearningActivity`, then `put` one event and return the stored plain object.
- `getLearningActivityByDedupeKey(dedupeKey)`: read the unique `dedupeKey` index and return the event or `null`.
- `listLearningActivities({ from, to, types = [] } = {})`: read the `occurredAt` range, keep only recognized requested types when `types` is non-empty, sort ascending by `occurredAt` and then `id`, and return a plain array.
- `saveDailyLearningReport(report)`: validate `dateKey`, clone the report payload, `put` by `dateKey`, and return the stored plain object.
- `getDailyLearningReport(dateKey)`: return the stored report or `null`.
- `listDailyLearningReports({ limit = 30 } = {})`: read through `updatedAt`, sort newest first, and return at most 30 plain records.
- `deleteExpiredLearningTelemetry({ reportBefore, activityBefore })`: delete only reports older than `reportBefore` and activity events older than `activityBefore`; return `{ reportsDeleted, activitiesDeleted }`.

Use `IDBKeyRange.bound(from, to, false, true)` when available. Clamp `limit` to 30 and return plain arrays. `deleteExpiredLearningTelemetry` must never include any other object store in its transaction.

- [ ] **Step 7: Run focused tests**

```powershell
node --test tests/learning-activity.test.mjs tests/learning-activity-db.test.mjs tests/exam-db-migration.test.mjs
```

Expected: all focused tests pass, 0 fail.

- [ ] **Step 8: Commit**

```powershell
git add src/learning-activity.mjs src/db.js tests/learning-activity.test.mjs tests/learning-activity-db.test.mjs tests/exam-db-migration.test.mjs
git commit -m "feat(analytics): add learning activity storage"
```

---

### Task 3: Implement bounded external-review credit and the atomic import signal

**Files:**
- Create: `src/external-review-scheduler.mjs`
- Modify: `src/db.js` after `recordLearnWordPractice`
- Create: `tests/external-review-scheduler.test.mjs`
- Create: `tests/db-external-import-review.test.mjs`

- [ ] **Step 1: Write failing scheduler tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { externalReviewCreditDays, scheduleExternalReview } from '../src/external-review-scheduler.mjs';

test('credit is 25 percent rounded and bounded to one through seven days', () => {
  assert.equal(externalReviewCreditDays(2), 1);
  assert.equal(externalReviewCreditDays(7), 2);
  assert.equal(externalReviewCreditDays(30), 7);
});

test('normal overdue word receives a bounded candidate without changing memory fields', () => {
  const now = 1_800_000_000_000;
  const word = { interval: 30, nextReview: now - 1000, easeFactor: 2.4, reviewCount: 9, lastQuality: 5, recoveryStage: 0, reviewRevision: 4 };
  const result = scheduleExternalReview(word, now);
  assert.equal(result.scheduleChanged, true);
  assert.equal(result.patch.nextReview, now + 7 * 86400000);
  assert.equal(result.patch.externalReviewCount, 1);
  assert.equal(result.patch.reviewRevision, 5);
  assert.equal('interval' in result.patch, false);
});

test('future schedule, recovery, and stubborn words are not pushed out', () => {
  const now = 1_800_000_000_000;
  assert.equal(scheduleExternalReview({ interval: 7, nextReview: now + 9 * 86400000 }, now).scheduleChanged, false);
  assert.equal(scheduleExternalReview({ interval: 7, nextReview: now, recoveryStage: 2 }, now).reason, 'recovery');
  assert.equal(scheduleExternalReview({ interval: 7, nextReview: now, stubbornUntil: now }, now).reason, 'stubborn');
});
```

- [ ] **Step 2: Write failing atomic DB tests**

Cover these exact outcomes with fake IndexedDB:

```js
test('first old-word import updates schedule, event, and daily dedupe atomically', async () => {
  const result = await db.applyWordImportSignal({ word: 'constraint' }, { batchId: 'b1', dayKey: '2026-08-24', occurredAt: now });
  assert.equal(result.status, 'external_review');
  assert.equal(result.scheduleChanged, true);
  assert.equal((await db.getReviewEventsForWord(wordId)).at(-1).source, 'external-import');
  assert.ok(await db.getLearningActivityByDedupeKey('import-word:2026-08-24:constraint'));
});

test('same local day returns today_ignored without a second review event', async () => {
  const second = await db.applyWordImportSignal({ word: 'constraint' }, { batchId: 'b2', dayKey: '2026-08-24', occurredAt: now + 1000 });
  assert.equal(second.status, 'today_ignored');
  assert.equal((await db.getReviewEventsForWord(wordId)).length, 1);
});

test('new word is added once and cannot become an external review later that day', async () => {
  assert.equal((await db.applyWordImportSignal({ word: 'derive' }, context)).status, 'new');
  assert.equal((await db.applyWordImportSignal({ word: 'derive' }, { ...context, batchId: 'b2' })).status, 'today_ignored');
});
```

- [ ] **Step 3: Run tests and verify RED**

```powershell
node --test tests/external-review-scheduler.test.mjs tests/db-external-import-review.test.mjs
```

Expected: FAIL because the module and DB method do not exist.

- [ ] **Step 4: Implement the pure scheduler**

```js
const DAY_MS = 86_400_000;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function externalReviewCreditDays(interval) {
  return Math.max(1, Math.min(7, Math.round(Math.max(0, finite(interval)) * 0.25)));
}

export function scheduleExternalReview(word = {}, now = Date.now()) {
  const externalReviewCount = Math.max(0, Math.trunc(finite(word.externalReviewCount))) + 1;
  const contactPatch = { externalReviewCount, lastExternalReviewAt: now };
  if (Math.max(0, Math.trunc(finite(word.recoveryStage))) > 0) {
    return { reason: 'recovery', scheduleChanged: false, creditDays: 0, patch: contactPatch };
  }
  if (finite(word.stubbornUntil) > 0) {
    return { reason: 'stubborn', scheduleChanged: false, creditDays: 0, patch: contactPatch };
  }
  const creditDays = externalReviewCreditDays(word.interval);
  const candidate = now + creditDays * DAY_MS;
  const existing = finite(word.nextReview, now);
  if (existing >= candidate) {
    return { reason: 'existing_schedule_later', scheduleChanged: false, creditDays, patch: contactPatch };
  }
  return {
    reason: 'credited',
    scheduleChanged: true,
    creditDays,
    patch: {
      ...contactPatch,
      nextReview: candidate,
      reviewRevision: Math.max(0, Math.trunc(finite(word.reviewRevision))) + 1
    }
  };
}
```

- [ ] **Step 5: Implement `DB.applyWordImportSignal` as one transaction**

The method must open `learnWords`, `reviewEvents`, and `learningActivityEvents` in one `readwrite` transaction. It must:

1. Normalize with the existing `getStemForm`.
2. Read `dedupeKey` from the activity index.
3. Return `today_ignored` without writes if found.
4. Read the word index.
5. Add a new word plus `word_import_daily` event when absent.
6. Run `scheduleExternalReview` and put the existing word when present.
7. Add one `reviewEvents` row with `source: 'external-import'`, `rating: null`, `evidenceStrength: 'medium'`, `scheduleChanged`, `creditDays`, and `batchId`.
8. Put the daily event last; any constraint or transaction failure rejects the whole operation.

Return exactly:

```js
{
  status: 'new' | 'external_review' | 'today_ignored',
  wordId,
  lemma,
  scheduleChanged: false,
  reason: 'new' | 'credited' | 'existing_schedule_later' | 'recovery' | 'stubborn' | 'today_ignored'
}
```

- [ ] **Step 6: Run focused tests and existing review regressions**

```powershell
node --test tests/external-review-scheduler.test.mjs tests/db-external-import-review.test.mjs tests/db-review-events.test.mjs tests/db-review-settle.test.mjs tests/db-review-practice.test.mjs tests/recovery-scheduler.test.mjs
```

Expected: all tests pass, 0 fail.

- [ ] **Step 7: Commit**

```powershell
git add src/external-review-scheduler.mjs src/db.js tests/external-review-scheduler.test.mjs tests/db-external-import-review.test.mjs
git commit -m "feat(vocabulary): add bounded external import reviews"
```

---

### Task 4: Refactor WordImport into an analyzable and resumable service

**Files:**
- Create: `src/word-import-service.mjs`
- Modify: `src/views/chat.js:1745-1900`
- Modify: `css/style.css`
- Create: `tests/word-import-service.test.mjs`
- Create: `tests/word-import-view-contract.test.mjs`

- [ ] **Step 1: Write failing import-analysis tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeImportWords, analyzeWordImport, WordImportService } from '../src/word-import-service.mjs';

test('normalizes one file to unique lemmas before analysis', () => {
  assert.deepEqual(normalizeImportWords('Constraint constraint\nDERIVE, nearly'), ['constraint', 'derive', 'nearly']);
});

test('classifies new, external, and today-ignored words before confirmation', async () => {
  const result = await analyzeWordImport({
    words: ['newword', 'oldword', 'todayword'],
    findWord: async word => word === 'newword' ? null : { id: word, word },
    findDaily: async word => word === 'todayword' ? { id: 'daily' } : null,
    dayKey: '2026-08-24'
  });
  assert.deepEqual(result.counts, { recognized: 3, new: 1, externalReview: 1, todayIgnored: 1, invalid: 0 });
});

test('service resumes an in-progress batch and never reapplies successful words', async () => {
  const applied = [];
  const service = new WordImportService({
    db: fakeDbWithBatch({ status: 'in_progress', completedLemmas: ['one'] }),
    lookup: async word => ({ word, translation: '释义' }),
    now: () => new Date(2026, 7, 24, 9).getTime()
  });
  service.applyWord = async word => { applied.push(word); return { status: 'new', lemma: word }; };
  await service.execute({ batchId: 'batch-1', words: ['one', 'two'] });
  assert.deepEqual(applied, ['two']);
});
```

- [ ] **Step 2: Run tests and verify RED**

```powershell
node --test tests/word-import-service.test.mjs tests/word-import-view-contract.test.mjs
```

Expected: FAIL because the service and preview UI do not exist.

- [ ] **Step 3: Implement the service API**

Export these exact APIs:

- `normalizeImportWords(text)`: reuse the current 2–200-character English extraction rule, lower-case lemmas, preserve first-seen `Set` order, and cap the result at 200 words.
- `analyzeWordImport({ words, findWord, findDaily, dayKey })`: classify every normalized word as `new`, `external_review`, `today_ignored`, `invalid`, or `failed`; return ordered category arrays plus all five counts.
- `new WordImportService({ db, lookup, now = () => Date.now() })`: require `db`, accept an injected dictionary lookup and clock, and keep no hidden global state.
- `createPlan(text)`: return `{ batchId, dayKey, words, categories, counts, status: 'preview' }`.
- `execute(plan, { onProgress = () => {} } = {})`: persist `in_progress` before applying any word, skip `completedLemmas`, call `onProgress` after each durable result, and persist a final `completed` or resumable `failed` summary.
- `resume(batchId, options = {})`: load the durable batch and call `execute` only for lemmas absent from `completedLemmas`.

`execute` must call dictionary lookup only for planned new words. A failed lookup creates a new word with empty trusted-definition fields and `definitionPending: true`. A failed DB operation enters `failed` with a clipped reason and leaves that lemma retryable.

- [ ] **Step 4: Replace the modal's one-step import with preview and confirm**

Keep paste/PDF selection intact. Change the primary button flow to:

```js
const plan = await wordImportService.createPlan(input.value);
this.renderImportPreview(plan);
```

The preview must show all five counts and buttons “确认导入” and “返回修改”. During execution disable both buttons, display `processed/recognized`, and on completion add one system message containing new, external, schedule-adjusted, Recovery-contact, today-ignored, and failed counts.

- [ ] **Step 5: Add responsive preview styles**

Add `.word-import-preview`, `.word-import-preview-grid`, `.word-import-preview-row`, `.word-import-progress`, and mobile single-column rules. Reuse existing theme variables and keep every control at least 44px high.

- [ ] **Step 6: Run focused tests**

```powershell
node --test tests/word-import-service.test.mjs tests/word-import-view-contract.test.mjs tests/db-external-import-review.test.mjs
```

Expected: all focused tests pass, 0 fail.

- [ ] **Step 7: Commit**

```powershell
git add src/word-import-service.mjs src/views/chat.js css/style.css tests/word-import-service.test.mjs tests/word-import-view-contract.test.mjs
git commit -m "feat(vocabulary): add import analysis and recovery"
```

---

### Task 5: Record reading lookups and reading-saved word sources

**Files:**
- Modify: `src/components/reading-word-lookup.js`
- Modify: `src/components/tooltip.js:170-335`
- Modify: `src/views/reading.js:410-565`
- Create: `tests/reading-learning-activity.test.mjs`
- Modify: `tests/reading-word-lookup.test.mjs`

- [ ] **Step 1: Write failing callback and dedupe tests**

Add tests proving:

```js
test('successful lookup calls onLookupResolved once after Tooltip accepts the result', async () => {
  const events = [];
  const cleanup = bindReadingStyleWordLookup({ root, dictionary, tooltip, onLookupResolved: event => events.push(event) });
  clickWord(root, 'constraint');
  await flushPromises();
  assert.equal(events.length, 1);
  assert.equal(events[0].lemma, 'constraint');
  cleanup();
});

test('failed or superseded lookup does not emit learning activity', async () => {
  assert.equal(events.length, 0);
});

test('reading save callback distinguishes a new learn word from a reencounter', async () => {
  assert.deepEqual(saved, { lemma: 'derive', createdLearnWord: true, articleId: 7 });
});
```

- [ ] **Step 2: Run tests and verify RED**

```powershell
node --test tests/reading-word-lookup.test.mjs tests/reading-learning-activity.test.mjs
```

Expected: FAIL because callbacks and events are absent.

- [ ] **Step 3: Extend lookup binding without changing existing callers**

Extend `bindReadingStyleWordLookup` with two optional arguments, `onLookupResolved = null` and `onWordSaved = null`, while preserving the existing `root`, `getContextSentence`, `getTargetTrack`, `shouldIgnoreClick`, and `isEnabled` arguments. Guard each callback with `typeof callback === 'function'`; callback errors must be swallowed after telemetry logging so lookup and save UI remain usable.

Only call `onLookupResolved` after a current lookup successfully displays. Pass callbacks and source metadata to Tooltip without making exam/review callers provide them.

- [ ] **Step 4: Make Tooltip return save provenance**

Before `saveLearnWord`, read `DB.findLearnWord`. Return and emit:

```js
{
  lemma,
  createdLearnWord: !existingLearnWord,
  learnWordId: existingLearnWord?.id || insertedId,
  vocabularyId,
  source: lookupContext?.source || 'unknown',
  articleId: lookupContext?.articleId || null,
  articleTitle: lookupContext?.articleTitle || ''
}
```

Do not call the callback if saving fails.

- [ ] **Step 5: Wire ReadingView to activity writes**

Pass `source: 'reading'`, article ID/title, and session ID. Save `reading_word_lookup` only after success. Use dedupe key `lookup:<sessionId>:<lemma>:<two-second-bucket>` so accidental double dispatch cannot create two events. Save `reading_word_saved` with `createdLearnWord`; repeated saves count as reencounters and never alter SRS.

Telemetry write errors must be caught and logged with `console.warn` without hiding Tooltip or blocking save.

- [ ] **Step 6: Run focused and reading regressions**

```powershell
node --test tests/reading-word-lookup.test.mjs tests/reading-learning-activity.test.mjs tests/reading-context.test.mjs tests/reading-effective-time-contract.test.mjs tests/reading-review-scheduling.test.mjs
```

Expected: all tests pass, 0 fail.

- [ ] **Step 7: Commit**

```powershell
git add src/components/reading-word-lookup.js src/components/tooltip.js src/views/reading.js tests/reading-word-lookup.test.mjs tests/reading-learning-activity.test.mjs
git commit -m "feat(reading): record lookup and saved-word activity"
```

---

### Task 6: Add a reusable foreground/idle study-session timer

**Files:**
- Create: `src/study-session-timer.mjs`
- Create: `tests/study-session-timer.test.mjs`

- [ ] **Step 1: Write failing timer tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { StudySessionTimer } from '../src/study-session-timer.mjs';

test('activity does not reset already accumulated active time', () => {
  let now = new Date(2026, 7, 24, 9).getTime();
  const timer = new StudySessionTimer({ sessionId: 's1', mode: 'flashcard', now: () => now, idleMs: 30_000 });
  timer.start({ contextKey: 'recall' });
  now += 10_000;
  timer.noteActivity();
  now += 5_000;
  assert.equal(timer.getActiveDuration(), 15_000);
});

test('switchContext closes the old slice and starts the new one', () => {
  timer.start({ contextKey: 'reading_mcq' });
  advance(12_000);
  timer.switchContext({ contextKey: 'translation' });
  advance(8_000);
  const slices = timer.finish();
  assert.deepEqual(slices.map(item => [item.contextKey, item.durationMs]), [['reading_mcq', 12_000], ['translation', 8_000]]);
});

test('midnight splits a single active interval into two local-day slices', () => {
  assert.deepEqual(timer.finish().map(item => item.dayKey), ['2026-08-24', '2026-08-25']);
});

test('pause and finish are idempotent', () => {
  const first = timer.finish();
  const second = timer.finish();
  assert.deepEqual(second, []);
  assert.ok(first.length > 0);
});
```

- [ ] **Step 2: Run test and verify RED**

```powershell
node --test tests/study-session-timer.test.mjs
```

Expected: FAIL because the timer module does not exist.

- [ ] **Step 3: Implement the timer**

The complete public API is:

```js
export class StudySessionTimer {
  constructor({ sessionId, mode, now = () => Date.now(), idleMs = 30_000 })
  start(context = {})
  noteActivity()
  pause(reason = 'paused')
  switchContext(context = {})
  getActiveDuration()
  finish(reason = 'completed')
}
```

Maintain separate `activeStartedAt` and `lastActivityAt`; `noteActivity` may update only `lastActivityAt`. `pause` closes at `min(now(), lastActivityAt + idleMs)`. Split closed intervals with `splitIntervalByLocalDay`. Each emitted slice must include stable `id`, `sessionId`, `mode`, `contextKey`, `startedAt`, `endedAt`, `durationMs`, `dayKey`, and reason. `finish` returns only slices not previously returned.

- [ ] **Step 4: Run tests**

```powershell
node --test tests/study-session-timer.test.mjs tests/learning-day.test.mjs
```

Expected: all tests pass, 0 fail.

- [ ] **Step 5: Commit**

```powershell
git add src/study-session-timer.mjs tests/study-session-timer.test.mjs
git commit -m "feat(analytics): add active study session timer"
```

---

### Task 7: Record flashcard, context, and practice session summaries

**Files:**
- Modify: `src/views/flashcard.js`
- Modify: `src/views/context-review.js`
- Create: `tests/review-session-activity.test.mjs`
- Modify: `tests/flashcard-two-stage.test.mjs`
- Modify: `tests/context-review-view.test.mjs`

- [ ] **Step 1: Write failing review telemetry contract tests**

Assert source contracts and pure summaries:

```js
test('flashcard creates one timer per render and writes one summary on result', () => {
  assert.match(source, /new StudySessionTimer/);
  assert.match(source, /type:\s*ActivityType\.REVIEW_SESSION_SUMMARY/);
  assert.match(source, /mode:\s*this\.practiceScope\s*\?\s*'practice'\s*:\s*'flashcard'/);
});

test('context review summary carries known uncertain unknown and missing counts', () => {
  assert.deepEqual(buildReviewSummary(fixture), { known: 2, uncertain: 1, unknown: 1, skipped: 0, missing: 1 });
});

test('partial cleanup is marked partial and is not presented as completed', () => {
  assert.equal(summary.status, 'partial');
});
```

- [ ] **Step 2: Run tests and verify RED**

```powershell
node --test tests/review-session-activity.test.mjs tests/flashcard-two-stage.test.mjs tests/context-review-view.test.mjs
```

Expected: FAIL because views do not create summary events.

- [ ] **Step 3: Wire FlashcardView**

On render, create one timer with mode `practice` or `flashcard` and stable session ID. Call `noteActivity` on card reveal, rating, correction, skip, study-panel interaction, and keyboard actions. At `renderResult`, finish and write one `review_session_summary` with:

```js
{
  mode,
  scope: this.practiceScope || 'scheduled',
  status: practiceCompleted === false ? 'partial' : 'completed',
  durationMs,
  counts: { known: ratingCounts[5], uncertain: ratingCounts[3], unknown: ratingCounts[1], skipped },
  completedWordIds,
  recovery: { fragile, relearning, difficult, reducedStages, stubborn }
}
```

On cleanup before completion, flush one `partial` summary only when active duration or completed words are nonzero. Use a stable summary dedupe key per session.

- [ ] **Step 4: Wire ContextReviewView**

Start from the persisted context session ID. Restore timer state using already persisted `startedAt` and do not count closed time. At result write one completed summary; cleanup writes one partial summary. Preserve existing session persistence and scoring behavior.

- [ ] **Step 5: Run review regressions**

```powershell
node --test tests/review-session-activity.test.mjs tests/flashcard-two-stage.test.mjs tests/flashcard-practice-completion.test.mjs tests/context-review-view.test.mjs tests/context-review-service.test.mjs tests/db-review-practice.test.mjs tests/db-review-settle.test.mjs
```

Expected: all tests pass, 0 fail; practice SRS invariants remain green.

- [ ] **Step 6: Commit**

```powershell
git add src/views/flashcard.js src/views/context-review.js tests/review-session-activity.test.mjs tests/flashcard-two-stage.test.mjs tests/context-review-view.test.mjs
git commit -m "feat(review): record active session summaries"
```

---

### Task 8: Record per-type active time in exam practice

**Files:**
- Modify: `src/views/exam-practice.js:63-300, 461-740, 1250-1360`
- Create: `tests/exam-active-time.test.mjs`
- Modify: `tests/exam-practice-service.test.mjs`
- Modify: `tests/exam-full-paper.test.mjs`

- [ ] **Step 1: Write failing timing tests**

```js
test('question activity does not erase time accumulated before the latest event', () => {
  const timer = createExamTimerFixture();
  timer.start({ contextKey: 'reading_mcq' });
  advance(10_000);
  timer.noteActivity();
  advance(5_000);
  assert.equal(timer.getActiveDuration(), 15_000);
});

test('full-paper unit switch emits old type before activating the next type', async () => {
  await view.goToUnit(1, 0);
  assert.deepEqual(savedSlices.map(item => item.contextKey), ['reading_mcq']);
  assert.equal(view.examStudyTimer.contextKey, 'translation');
});

test('wrong-review and manual-review origins remain separate from normal attempts', () => {
  assert.equal(slice.practiceOrigin, 'review_center_due');
});
```

- [ ] **Step 2: Run tests and verify RED**

```powershell
node --test tests/exam-active-time.test.mjs tests/exam-practice-service.test.mjs
```

Expected: FAIL because per-type slices do not exist.

- [ ] **Step 3: Replace the faulty last-event timer bookkeeping**

Use `StudySessionTimer` as the active-time authority. Keep `attempt.activeDurationMs` compatible by setting autosave and submit values from `timer.getActiveDuration()` plus restored duration. Do not reset accumulated time in `noteActivity`.

Build context keys from unit type and variant:

```js
const examTypeKey = unit => unit?.type === 'matching' && unit.matchingVariant
  ? `${unit.type}:${unit.matchingVariant}`
  : unit?.type || 'unknown';
```

- [ ] **Step 4: Flush slices at every lifecycle boundary**

Before `goToUnit` changes `this.unit`, call `switchContext` and persist returned old-unit slices. Pause and persist on hidden, idle, exit modal, cleanup, autosave flush, abandon, and submit. Each `exam_active_slice` payload must contain attempt, bank, paper, unit, type/variant, practice kind/origin, and duration.

Telemetry failures must not block autosave or submit. Keep an in-memory retry queue for the current mounted view and retry it during the next flush.

- [ ] **Step 5: Run focused and full-paper regressions**

```powershell
node --test tests/exam-active-time.test.mjs tests/exam-practice-service.test.mjs tests/exam-attempt-state.test.mjs tests/exam-learning-analytics.test.mjs tests/exam-full-paper.test.mjs
```

Expected: all selected tests pass, 0 fail.

- [ ] **Step 6: Commit**

```powershell
git add src/views/exam-practice.js tests/exam-active-time.test.mjs tests/exam-practice-service.test.mjs tests/exam-full-paper.test.mjs
git commit -m "feat(exam): track active time by question type"
```

---

### Task 9: Build the deterministic daily report and Markdown formatter

**Files:**
- Create: `src/daily-learning-report.mjs`
- Create: `tests/daily-learning-report.test.mjs`
- Modify: `src/exam/learning-analytics.mjs` only to reuse/export stable type labels if needed
- Modify: `tests/exam-learning-analytics.test.mjs`

- [ ] **Step 1: Write failing aggregation fixtures**

Create one fixed local day containing:

- one PDF-new word, one reading-new word, two external reviews, one ignored duplicate;
- three successful lookups with two unique lemmas;
- one effective and one incomplete reading;
- one flashcard and one practice summary;
- CET4 banked cloze, long reading, careful reading, and translation responses;
- one English One reading response;
- one wrong-review attempt that must not count as new work.

Assert:

```js
test('aggregates one deterministic local-day report without double counting', () => {
  const report = buildDailyLearningReport(fixture);
  assert.equal(report.vocabulary.newUnique, 2);
  assert.deepEqual(report.vocabulary.newBySource, { pdf: 1, reading: 1 });
  assert.equal(report.vocabulary.externalReviewed, 2);
  assert.equal(report.vocabulary.lookupCount, 3);
  assert.equal(report.vocabulary.distinctLookups, 2);
  assert.equal(report.reading.completedCount, 1);
  assert.equal(report.coreStudyDurationMs, 72 * 60_000);
});

test('exam breakdown exposes every real type and keeps translation non-objective', () => {
  const types = report.exam.papers.flatMap(paper => paper.types);
  assert.deepEqual(types.map(item => item.key), ['matching:banked_cloze', 'matching:long_reading', 'reading_mcq', 'translation']);
  assert.equal(types[0].accuracy, 70);
  assert.equal(types.at(-1).accuracy, null);
});

test('markdown lists at most one hundred words and states the remainder', () => {
  const markdown = formatDailyLearningReportMarkdown(reportWithWords(104));
  assert.match(markdown, /其余 4 个词未展开/);
});
```

- [ ] **Step 2: Run tests and verify RED**

```powershell
node --test tests/daily-learning-report.test.mjs
```

Expected: FAIL because the aggregator does not exist.

- [ ] **Step 3: Implement the report schema and reducers**

Export exactly these public symbols:

- `DAILY_REPORT_SCHEMA_VERSION = 1`.
- `buildDailyLearningReport(input)`: pure aggregation with no DB, clock, network, or locale side effects.
- `buildDailyLearningTrends(reports, { todayKey })`: return explicit 7-day averages and a 30-day ordered series, marking missing dates instead of filling them with fabricated zeroes.
- `formatDailyLearningReportMarkdown(report)`: return the fixed seven-section Markdown document specified below.
- `toDailyReportAgentSummary(report)`: return bounded structured facts and completeness flags, excluding full article, question, answer, and conversation content.

Input keys must be explicit: `dateKey`, `articles`, `readingStats`, `learnWords`, `reviewEvents`, `activities`, `papers`, `attempts`, `responsesByAttempt`, `wrongStates`, `translationReviews`, `recentReports`, and `now`.

Use stable maps keyed by normalized lemma, attempt ID, paper identity, and type key. Sort event-derived lists by `occurredAt` then lemma. Objective accuracy uses only responses whose `correct` is boolean and whose answer was present. Translation reports segments and review status only.

- [ ] **Step 4: Implement completeness and core duration**

Each section returns `complete`, `partial`, or `unavailable`. Missing pre-v18 activity is `partial`, not zero. Core duration is the sum of effective reading, exam active slices, flashcard, context, and practice durations. AI interaction count remains outside that sum.

- [ ] **Step 5: Implement exact Markdown headings**

```markdown
# 英语学习日报｜YYYY-MM-DD

## 今日概览
## 词汇
## 阅读
## 单词复习
## 真题训练
## 近期趋势
## 总结与明日建议
```

When AI analysis is absent, the final section must say `智能分析暂不可用；以上数据由本地学习记录生成。`.

- [ ] **Step 6: Run report and analytics tests**

```powershell
node --test tests/daily-learning-report.test.mjs tests/reading-analytics.test.mjs tests/exam-learning-analytics.test.mjs
```

Expected: all tests pass, 0 fail.

- [ ] **Step 7: Commit**

```powershell
git add src/daily-learning-report.mjs src/exam/learning-analytics.mjs tests/daily-learning-report.test.mjs tests/exam-learning-analytics.test.mjs
git commit -m "feat(report): aggregate deterministic daily learning facts"
```

---

### Task 10: Add report persistence, fingerprinting, AI analysis, and retention

**Files:**
- Create: `src/daily-learning-report-service.mjs`
- Create: `tests/daily-learning-report-service.test.mjs`

- [ ] **Step 1: Write failing service tests**

```js
test('same fingerprint reuses the stored analysis without another AI request', async () => {
  await service.getOrCreate('2026-08-24', { withAnalysis: true });
  await service.getOrCreate('2026-08-24', { withAnalysis: true });
  assert.equal(aiCalls, 1);
});

test('changed facts update the same dateKey and request a new analysis', async () => {
  const first = await service.getOrCreate('2026-08-24', { withAnalysis: true });
  activities.push(extraLookup);
  const second = await service.getOrCreate('2026-08-24', { withAnalysis: true });
  assert.equal(first.dateKey, second.dateKey);
  assert.notEqual(first.dataFingerprint, second.dataFingerprint);
  assert.equal(aiCalls, 2);
});

test('AI failure preserves deterministic Markdown and is retryable', async () => {
  const report = await failingService.getOrCreate('2026-08-24', { withAnalysis: true });
  assert.equal(report.analysisStatus, 'unavailable');
  assert.match(report.markdown, /本地学习记录/);
});

test('expired date is rejected and pruning touches only report telemetry', async () => {
  await assert.rejects(() => service.getOrCreate('2026-07-25'), /已过期/);
});
```

- [ ] **Step 2: Run test and verify RED**

```powershell
node --test tests/daily-learning-report-service.test.mjs
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement the service API**

Implement `DailyLearningReportService` with these exact public contracts:

- `new DailyLearningReportService({ db, examProvider, analyze = null, now = () => Date.now() })`: require the DB and exam provider; keep AI optional and injected.
- `getOrCreate(dateKey, { withAnalysis = false, signal = null } = {})`: return one persisted deterministic report, optionally enriched with validated analysis.
- `getActivityDetail({ dateKey, category, limit = 20 })`: return a bounded, category-specific detail payload with completeness metadata.
- `listRecent(limit = 30)`: return newest-first report summaries, hard-capped at 30.
- `prune()`: apply only the 30-day report and 35-day supplemental-event retention policies.

`getOrCreate` must validate the 30-day range, load all facts in parallel, aggregate locally, compute a SHA-256 fingerprint over stable JSON facts and schema version, and save by `dateKey`. Call `analyze` only when requested and the fingerprint lacks a successful cached analysis.

- [ ] **Step 4: Bound and validate the AI analysis**

Send no more than 100 lemmas and no complete passage/question text. Request Chinese output with exactly: one summary paragraph, 2–4 observations, and 2–4 next-day actions. Normalize to 6,000 characters. Empty, cancelled, non-Chinese, or failed output is not cached as success.

- [ ] **Step 5: Implement pruning**

Retain reports for 30 local dates and supplemental activities for 35 local dates. Derive thresholds with `localDayBounds`, not fixed UTC subtraction. Call only `DB.deleteExpiredLearningTelemetry`.

- [ ] **Step 6: Run focused tests**

```powershell
node --test tests/daily-learning-report-service.test.mjs tests/daily-learning-report.test.mjs tests/learning-activity-db.test.mjs
```

Expected: all tests pass, 0 fail.

- [ ] **Step 7: Commit**

```powershell
git add src/daily-learning-report-service.mjs tests/daily-learning-report-service.test.mjs
git commit -m "feat(report): persist and analyze daily reports"
```

---

### Task 11: Expose bounded daily-report tools to the home Agent

**Files:**
- Modify: `src/components/learning-agent.js:1-180`
- Modify: `src/components/context-builder.js:69-84`
- Modify: `src/views/chat.js:38-110, 965-1110`
- Create: `tests/learning-agent-daily-report.test.mjs`
- Modify: `tests/chat-service-agent-tool.test.mjs`
- Modify: `tests/learning-agent.test.mjs`

- [ ] **Step 1: Write failing tool-schema and execution tests**

```js
test('declares three bounded read-only daily learning tools', () => {
  const names = LEARNING_TOOLS.map(tool => tool.function.name);
  assert.ok(names.includes('get_daily_learning_report'));
  assert.ok(names.includes('list_recent_learning_reports'));
  assert.ok(names.includes('get_learning_activity_detail'));
  assert.equal(tool('list_recent_learning_reports').function.parameters.properties.limit.maximum, 30);
});

test('daily report execution returns bounded facts and an artifact reference', async () => {
  const handled = await executeHomeTool('get_daily_learning_report', { date: '2026-08-24' });
  assert.equal(handled.result.source, 'daily_learning_report');
  assert.equal(handled.artifact.type, 'daily_learning_report');
  assert.equal(handled.artifact.reportId, 'daily:2026-08-24');
  assert.equal(JSON.stringify(handled.result).length < 8000, true);
});

test('tools reject out-of-range dates, categories, and limits', async () => {
  await assert.rejects(() => agent.execute('get_learning_activity_detail', { date: '2020-01-01', category: 'database', limit: 999 }));
});
```

- [ ] **Step 2: Run tests and verify RED**

```powershell
node --test tests/learning-agent-daily-report.test.mjs tests/chat-service-agent-tool.test.mjs tests/learning-agent.test.mjs
```

Expected: FAIL because tools and provider injection do not exist.

- [ ] **Step 3: Add exact tool schemas**

Add date pattern `^\d{4}-\d{2}-\d{2}$`, report list maximum 30, and detail categories enum `['vocabulary', 'lookup', 'reading', 'review', 'exam']`. Descriptions must state that data is local, read-only, and may be partial.

- [ ] **Step 4: Inject the report provider into LearningAgent**

Extend the constructor with `dailyReportProvider = null`. Route the three names to provider methods and fail with a typed unavailable result when absent. Never expose the DB object or arbitrary store names in arguments.

- [ ] **Step 5: Return a report artifact from ChatView**

For `get_daily_learning_report`, call the provider, return `toDailyReportAgentSummary(report)` as result, and attach:

```js
{
  type: 'daily_learning_report',
  reportId: `daily:${report.dateKey}`,
  dateKey: report.dateKey,
  dataFingerprint: report.dataFingerprint
}
```

List/detail tools return bounded results without artifacts.

- [ ] **Step 6: Update the Agent system prompt**

Add rules: use daily tools for date-specific questions; distinguish zero from partial/unavailable; never recompute supplied numbers; label facts versus inference; never claim an expired report exists; do not send full article or exam content.

- [ ] **Step 7: Run tool regressions**

```powershell
node --test tests/learning-agent-daily-report.test.mjs tests/chat-service-agent-tool.test.mjs tests/learning-agent.test.mjs tests/context-builder.test.mjs
```

Expected: all tests pass, 0 fail.

- [ ] **Step 8: Commit**

```powershell
git add src/components/learning-agent.js src/components/context-builder.js src/views/chat.js tests/learning-agent-daily-report.test.mjs tests/chat-service-agent-tool.test.mjs tests/learning-agent.test.mjs
git commit -m "feat(agent): expose read-only daily learning tools"
```

---

### Task 12: Add the home quick action, report card, restoration, and full-copy behavior

**Files:**
- Create: `src/components/daily-report-card.mjs`
- Modify: `src/views/chat.js:218-295, 308-338, 890-965, 1470-1715`
- Modify: `src/components/conversation-store.js`
- Modify: `src/components/message-actions.mjs`
- Modify: `css/style.css`
- Create: `tests/daily-report-card.test.mjs`
- Create: `tests/daily-report-chat-contract.test.mjs`
- Modify: `tests/chat-copy-followup.test.mjs`

- [ ] **Step 1: Write failing card and copy tests**

```js
test('collapsed card exposes summary and an accessible expand control', () => {
  const html = renderDailyReportCard(report);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /学习总时长/);
  assert.doesNotMatch(html, /完整试卷正文/);
});

test('copy action prefers explicit full Markdown over collapsed text', () => {
  const root = nodeWithCopyValue('# 英语学习日报\n\n## 今日概览');
  assert.equal(readCopyText(root), '# 英语学习日报\n\n## 今日概览');
});

test('conversation stores only report reference fields', () => {
  store.append('home', { role: 'assistant', kind: 'daily_report', reportId: 'daily:2026-08-24', dateKey: '2026-08-24' });
  const saved = store.getSession('home').messages.at(-1);
  assert.deepEqual(Object.keys(saved).filter(key => !['createdAt', 'role', 'kind'].includes(key)), ['reportId', 'dateKey']);
});
```

- [ ] **Step 2: Run tests and verify RED**

```powershell
node --test tests/daily-report-card.test.mjs tests/daily-report-chat-contract.test.mjs tests/chat-copy-followup.test.mjs
```

Expected: FAIL because card/ref/custom copy support is absent.

- [ ] **Step 3: Implement the card renderer**

`renderDailyReportCard(report)` must return escaped semantic markup with a button controlling an expandable region. Collapsed summary shows date, core duration, reading count, exam objective accuracy, vocabulary new/external counts, and one AI sentence. Expanded content renders the saved Markdown using the existing safe rich-text renderer or escaped section markup.

- [ ] **Step 4: Extend copy behavior safely**

Add `data-copy-value` support to `message-actions.mjs`. `readCopyText` must prefer the explicit string, cap it at the existing 12,000-character limit, and otherwise preserve current visible-content behavior. Set the report message's copy value to saved complete Markdown and reuse `createCopyButton()` in its existing position.

- [ ] **Step 5: Version ConversationStore and persist references only**

Bump its storage version from 4 to 5. Normalize `kind: 'daily_report'` to `{ role, kind, reportId, dateKey, createdAt }`; discard embedded Markdown/report objects from malformed or legacy messages. Clearing home chat keeps DB reports untouched.

- [ ] **Step 6: Add the quick action and direct fallback path**

Add one quick-action button with `data-action="daily-report"` and label “今日日报”. It must call `DailyLearningReportService.getOrCreate(localDayKey(), { withAnalysis: Config.hasApiKey() })` directly, so local facts still work without an API key. Append one report reference and render its card. Do not route this button through the current `submitComposer` API-key gate.

Instantiate the service next to the existing `chatService` in `src/views/chat.js`. Inject an `analyze` adapter that calls the provider-neutral `API.chat(messages, { signal, temperature: 0.2 })` and returns `message.content`; do not add a DeepSeek-specific path or modify `src/api.js`.

- [ ] **Step 7: Restore and expire report cards**

During `restoreHistory`, resolve each report reference from `dailyLearningReports`. Render current reports; render a compact “日报已过期” card when absent/expired. A historical Agent tool artifact uses the same append/render path and must not create duplicate references for the same `reportId` and fingerprint.

- [ ] **Step 8: Add responsive styles**

Add card summary grid, disclosure states, section spacing, partial/unavailable badges, and phone/tablet rules. The card must never produce horizontal scrolling; use `min-width: 0`, `overflow-wrap: anywhere`, and 44px controls. Preserve current copy-button placement.

- [ ] **Step 9: Run card/chat tests**

```powershell
node --test tests/daily-report-card.test.mjs tests/daily-report-chat-contract.test.mjs tests/chat-copy-followup.test.mjs tests/chat-shell.test.mjs tests/chat-service-agent-tool.test.mjs
```

Expected: all tests pass, 0 fail.

- [ ] **Step 10: Commit**

```powershell
git add src/components/daily-report-card.mjs src/views/chat.js src/components/conversation-store.js src/components/message-actions.mjs css/style.css tests/daily-report-card.test.mjs tests/daily-report-chat-contract.test.mjs tests/chat-copy-followup.test.mjs
git commit -m "feat(chat): add persistent daily report cards"
```

---

### Task 13: Integrate cleanup, audit all requirements, and run complete verification

**Files:**
- Modify: `src/app.js:14-28, 40-50`
- Create: `tests/daily-report-startup-contract.test.mjs`
- Modify: `android/app/build.gradle`
- Modify: `version.json`
- Test: all files under `tests/`

- [ ] **Step 1: Write a failing startup cleanup contract**

```js
test('startup schedules telemetry pruning without blocking router initialization', async () => {
  assert.ok(routerStartedBeforePruneResolved);
  assert.equal(pruneCalls, 1);
});
```

- [ ] **Step 2: Run the startup test and verify RED**

```powershell
node --test tests/daily-report-startup-contract.test.mjs
```

Expected: FAIL because pruning is not scheduled.

- [ ] **Step 3: Schedule best-effort pruning after startup**

Invoke `DailyLearningReportService.prune()` after router initialization or through the existing non-blocking prewarm queue. Catch and log failure; never await it before the first route renders.

- [ ] **Step 4: Run every new/focused test together**

```powershell
node --test tests/learning-day.test.mjs tests/learning-activity.test.mjs tests/learning-activity-db.test.mjs tests/external-review-scheduler.test.mjs tests/db-external-import-review.test.mjs tests/word-import-service.test.mjs tests/word-import-view-contract.test.mjs tests/reading-learning-activity.test.mjs tests/study-session-timer.test.mjs tests/review-session-activity.test.mjs tests/exam-active-time.test.mjs tests/daily-learning-report.test.mjs tests/daily-learning-report-service.test.mjs tests/learning-agent-daily-report.test.mjs tests/daily-report-card.test.mjs tests/daily-report-chat-contract.test.mjs tests/daily-report-startup-contract.test.mjs
```

Expected: all selected tests pass, 0 fail.

- [ ] **Step 5: Run the complete regression suite**

```powershell
node --test tests/*.test.mjs
```

Expected: zero failures. Record totals and skipped count.

- [ ] **Step 6: Build and validate the private QA web artifact**

```powershell
npm run build:private-qa
```

Expected: Vite build, private release-artifact verification, and Capacitor Android sync all exit 0; all five indexed private packs are reported.

- [ ] **Step 7: Perform a browser smoke test**

Verify on phone-width and tablet-width layouts:

1. Import preview categories and same-day second import.
2. External review changes a due normal word but not a Recovery word.
3. Reading lookup/save appears in today's facts.
4. Flashcard/context/practice time is nonzero and idle time is excluded.
5. A full paper reports separate type durations.
6. “今日日报” works with and without API availability.
7. Card expands, copies full Markdown, survives reload, and disappears from chat only after clearing chat.
8. Asking for a retained date restores a card; an expired date reports expiry.

- [ ] **Step 8: Bump only Android build metadata for the QA APK**

Keep semantic version `2.0.0`. Increment current Android `versionCode` by exactly one and copy the same value to `version.json`; set `buildDate` to the execution date. Do not use `npm run version:patch`, because that changes semantic version.

- [ ] **Step 9: Commit the verified integration and build number**

```powershell
git add src/app.js tests/daily-report-startup-contract.test.mjs android/app/build.gradle version.json
git commit -m "chore(android): prepare daily report qa build"
```

- [ ] **Step 10: Build and independently verify the APK**

```powershell
npm run build:apk
```

Expected: Gradle `BUILD SUCCESSFUL`, APK verification reports `flavor: private-qa`, semantic version `2.0.0`, the new versionCode, all five private packs, and `sourceDirty: false`.

Then verify the copied artifact and checksum:

```powershell
$versionCode = (Select-String -Path 'android/app/build.gradle' -Pattern 'versionCode\s+(\d+)').Matches[0].Groups[1].Value
$apk = "E:\play\claude\EnglishReader-private-qa-v2.0.0-$versionCode-debug.apk"
$declared = ((Get-Content "$apk.sha256" -Raw).Trim() -split '\s+')[0]
$actual = (Get-FileHash $apk -Algorithm SHA256).Hash
if ($declared -ne $actual) { throw 'APK SHA-256 mismatch' }
Get-Item $apk | Select-Object FullName, Length, LastWriteTime
git status --short
```

Expected: checksum matches and `git status --short` is empty.

- [ ] **Step 11: Final requirement audit**

Check every numbered section in the approved design against a task commit. Confirm explicitly:

- no diary UI was added to Learning Archive;
- no background scheduled notification was added;
- external import never masquerades as rating 3 or 5;
- practice review still does not affect SRS;
- full article/question text is absent from Agent payloads;
- reports retain 30 days and supplemental events 35 days;
- no main/public/private-pack mutation occurred;
- branch remains `feat/daily-learning-report-agent` and no push/merge occurred.

---

## Expected commit sequence

1. `feat(analytics): add local learning day primitives`
2. `feat(analytics): add learning activity storage`
3. `feat(vocabulary): add bounded external import reviews`
4. `feat(vocabulary): add import analysis and recovery`
5. `feat(reading): record lookup and saved-word activity`
6. `feat(analytics): add active study session timer`
7. `feat(review): record active session summaries`
8. `feat(exam): track active time by question type`
9. `feat(report): aggregate deterministic daily learning facts`
10. `feat(report): persist and analyze daily reports`
11. `feat(agent): expose read-only daily learning tools`
12. `feat(chat): add persistent daily report cards`
13. `chore(android): prepare daily report qa build`

## Handoff evidence

The executing worker must return:

- branch and worktree path;
- commit list above with actual hashes;
- focused and full test totals;
- private QA build result and five-pack verification;
- browser smoke-test observations;
- APK absolute path, byte size, version/versionCode, and SHA-256;
- `git status --short` output;
- explicit confirmation that nothing was merged or pushed.
