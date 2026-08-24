# Unified Vocabulary Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the split saved-word/imported-word experience with one source-aware, archive-safe vocabulary library at `#/vocab` without changing formal SRS or practice scoring.

**Architecture:** Keep `learnWords` as the canonical record and SRS identity for every active word. Add versioned source metadata and archive fields directly to those records, keep `vocabulary` only as reading-context metadata, and migrate legacy rows idempotently when the unified repository is first read. The unified view, practice scopes, review queue, profile, Agent, and reports consume the same active-word contract; historical consumers explicitly request archived rows.

**Tech Stack:** Vanilla ES modules, IndexedDB, Vite, Capacitor Android, Node.js built-in test runner, existing `SpacedRepetition`, `ReviewQueue`, `WordStudyDetail`, and `WordImport` UI.

---

## Execution guardrails

- Create a new worktree from the current `feat/english-practice-machine`; do not implement directly in the active private development tree.
- Recommended branch: `feat/unified-vocabulary-library`.
- Do not merge, push, tag, bump versions, build an APK, modify private exam packs, or touch `main` unless the user separately asks.
- Preserve all existing SRS V2, Recovery, `reviewRevision`, external-import credit, daily import dedupe, practice-only scoring, and report retention behavior.
- Use `apply_patch` for source and documentation edits.
- Run the stated RED test before implementation and the stated GREEN test after every task.

## Target file map

### New files

- `src/vocabulary-library.mjs`: pure source metadata, legacy migration planning, row projection, filtering, searching, and sorting.
- `tests/vocabulary-library.test.mjs`: pure domain tests.
- `tests/db-unified-vocabulary.test.mjs`: IndexedDB migration/source/archive tests.
- `tests/unified-vocabulary-view.test.mjs`: unified page behavior and source contract tests.
- `tests/unified-vocabulary-routing.test.mjs`: old-route alias and link consolidation tests.

### Modified files

- `src/db.js`: canonical unified repository methods, active/archive read contract, source mutation transactions, import reactivation.
- `src/components/tooltip.js`: atomic reading-save upsert.
- `src/views/reading.js`: mark explicit reading-origin additions.
- `src/word-import-service.mjs`: preserve import-source outcomes and dispatch refresh notification.
- `src/review-practice.mjs`: resolve scopes directly from active canonical words.
- `src/review-queue-coordinator.mjs`: defensive archived-word exclusion.
- `src/views/vocabulary.js`: replace saved-only page with selected unified design.
- `css/style.css`: unified mobile/tablet layout and no-overflow rules.
- `src/router.js`: make `#/vocab` canonical and normalize `#/learn-words`.
- `src/components/app-shell.js`: canonical route metadata.
- `src/views/chat.js`, `src/views/flashcard.js`, `src/views/context-review.js`, `src/views/review-mode.js`, `src/views/stats.js`: replace split-page links and wording.
- `src/views/report.js`, `src/daily-learning-report-service.mjs`, `src/components/learning-agent.js`: choose active versus historical reads explicitly.
- Existing focused tests listed in each task.

### Removed file

- `src/views/learn-words.js`: delete after every route and feature has moved to `VocabularyView`.

---

### Task 0: Create the isolated worktree and verify the merged baseline

**Files:**
- No tracked source changes.

- [ ] **Step 1: Confirm the source branch and clean state**

```powershell
$source = 'E:\play\claude\english-reader\mobile'
git -C $source status --short --branch
git -C $source rev-parse --abbrev-ref HEAD
```

Expected: branch is `feat/english-practice-machine` and there are no uncommitted files.

- [ ] **Step 2: Create the feature worktree**

```powershell
$source = 'E:\play\claude\english-reader\mobile'
$target = 'E:\play\claude\english-reader\mobile\.worktrees\unified-vocabulary-library'
git -C $source worktree add $target -b feat/unified-vocabulary-library feat/english-practice-machine
git -C $target status --short --branch
```

Expected: the new worktree is on `feat/unified-vocabulary-library` and clean.

- [ ] **Step 3: Copy ignored private QA resources without tracking them**

```powershell
$sourcePacks = 'E:\play\claude\english-reader\mobile\public\exam-packs\private'
$targetPacks = 'E:\play\claude\english-reader\mobile\.worktrees\unified-vocabulary-library\public\exam-packs\private'
if (Test-Path -LiteralPath $sourcePacks) {
  New-Item -ItemType Directory -Force -Path $targetPacks | Out-Null
  Copy-Item -LiteralPath (Join-Path $sourcePacks 'index.json') -Destination $targetPacks -Force
  Get-ChildItem -LiteralPath $sourcePacks -Filter '*.json' | Where-Object Name -ne 'index.json' | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $targetPacks -Force
  }
}
git -C $target status --short
```

Expected: private files remain ignored and `git status --short` is empty.

- [ ] **Step 4: Run the complete baseline suite**

```powershell
node --test tests/*.test.mjs
```

Expected baseline: 0 failures. At plan creation the merged source reported 1096 tests, 1079 pass, 17 skipped.

---

### Task 1: Add the pure unified-library domain contract

**Files:**
- Create: `src/vocabulary-library.mjs`
- Create: `tests/vocabulary-library.test.mjs`

- [ ] **Step 1: Write failing legacy-source and projection tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIBRARY_SOURCE_VERSION,
  planLegacyVocabularyMigration,
  projectUnifiedVocabulary,
  selectUnifiedVocabulary
} from '../src/vocabulary-library.mjs';

test('legacy saved rows are reading sources and unmatched learning rows are imports', () => {
  const plan = planLegacyVocabularyMigration({
    learnWords: [
      { id: 1, word: 'derive', createdAt: 10, interval: 30, reviewRevision: 4 },
      { id: 2, word: 'retain', createdAt: 20, interval: 7, reviewRevision: 2 }
    ],
    vocabulary: [{ id: 9, word: 'Derived', createdAt: 30, translation: '获得' }],
    normalizeLemma: word => word.toLowerCase().replace(/d$/, '')
  });
  assert.equal(plan.updates.find(row => row.id === 1).librarySources.reading.active, true);
  assert.equal(plan.updates.find(row => row.id === 1).librarySources.import.active, false);
  assert.equal(plan.updates.find(row => row.id === 2).librarySources.import.active, true);
  assert.equal(plan.updates.find(row => row.id === 1).interval, 30);
  assert.equal(plan.updates.find(row => row.id === 1).reviewRevision, 4);
});

test('legacy migration creates a missing canonical word from saved metadata', () => {
  const plan = planLegacyVocabularyMigration({
    learnWords: [],
    vocabulary: [{ id: 3, word: 'constraint', createdAt: 50, translation: '限制', phonetic: '/kənˈstreɪnt/' }],
    normalizeLemma: word => word.toLowerCase()
  });
  assert.deepEqual(plan.inserts.map(row => row.word), ['constraint']);
  assert.equal(plan.inserts[0].librarySources.reading.active, true);
  assert.equal(plan.inserts[0].librarySources.import.active, false);
});

test('versioned rows are never reclassified after a source becomes inactive', () => {
  const versioned = {
    id: 1,
    word: 'derive',
    librarySourceVersion: LIBRARY_SOURCE_VERSION,
    librarySources: {
      reading: { active: false, firstAddedAt: 10, lastAddedAt: 10 },
      import: { active: false, firstAddedAt: null, lastAddedAt: null }
    },
    archivedAt: 99
  };
  const plan = planLegacyVocabularyMigration({ learnWords: [versioned], vocabulary: [], normalizeLemma: value => value });
  assert.deepEqual(plan.updates, []);
  assert.deepEqual(plan.inserts, []);
});
```

- [ ] **Step 2: Write failing filter, search, and stable-sort tests**

```js
function fixtures() {
  return [
    {
      id: 1, word: 'gamma', phonetic: '/ˈɡæmə/', translation: '第三个字母',
      libraryAddedAt: 10, sourceKeys: ['reading'], isDue: false, nextReview: 300, status: 'stable'
    },
    {
      id: 2, word: 'alpha', phonetic: '/ˈælfə/', translation: '第一个字母',
      libraryAddedAt: 20, sourceKeys: ['import'], isDue: false, nextReview: 200, status: 'learning'
    },
    {
      id: 3, word: 'beta', phonetic: '/ˈbiːtə/', translation: '第二个字母',
      libraryAddedAt: 30, sourceKeys: ['reading', 'import'], isDue: true, nextReview: 50, status: 'due'
    }
  ];
}

test('projection emits one canonical row with both active sources', () => {
  const rows = projectUnifiedVocabulary({
    learnWords: [{
      id: 7,
      word: 'inevitable',
      translation: '不可避免的',
      libraryAddedAt: 20,
      librarySources: {
        reading: { active: true, firstAddedAt: 20, lastAddedAt: 30 },
        import: { active: true, firstAddedAt: 25, lastAddedAt: 25 }
      }
    }],
    vocabulary: [{ id: 70, word: 'inevitable', articleId: 4, contextSentence: 'It was inevitable.' }],
    normalizeLemma: value => value.toLowerCase()
  });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].sourceKeys, ['reading', 'import']);
  assert.equal(rows[0].savedContexts.length, 1);
});

test('source filters include a dual-source row in both tabs', () => {
  const rows = fixtures();
  assert.deepEqual(selectUnifiedVocabulary(rows, { source: 'reading' }).map(row => row.id), [3, 1]);
  assert.deepEqual(selectUnifiedVocabulary(rows, { source: 'import' }).map(row => row.id), [3, 2]);
});

test('default sort is recent, with alphabetical and due alternatives', () => {
  const rows = fixtures();
  assert.deepEqual(selectUnifiedVocabulary(rows, { sort: 'recent' }).map(row => row.id), [3, 2, 1]);
  assert.deepEqual(selectUnifiedVocabulary(rows, { sort: 'alpha' }).map(row => row.word), ['alpha', 'beta', 'gamma']);
  assert.equal(selectUnifiedVocabulary(rows, { sort: 'due', now: 100 })[0].isDue, true);
});

test('search matches lemma phonetic and Chinese definition', () => {
  const rows = [{
    id: 4,
    word: 'constrain',
    phonetic: '/kənˈstreɪn/',
    translation: '限制；约束',
    libraryAddedAt: 5,
    sourceKeys: ['import'],
    isDue: false,
    status: 'new'
  }];
  assert.deepEqual(selectUnifiedVocabulary(rows, { query: '限制' }).map(row => row.word), ['constrain']);
  assert.deepEqual(selectUnifiedVocabulary(rows, { query: 'streɪn' }).map(row => row.word), ['constrain']);
});
```

- [ ] **Step 3: Run the tests and verify RED**

```powershell
node --test tests/vocabulary-library.test.mjs
```

Expected: FAIL because `src/vocabulary-library.mjs` does not exist.

- [ ] **Step 4: Implement the exact pure contracts**

```js
export const LIBRARY_SOURCE_VERSION = 1;

const emptySource = () => ({ active: false, firstAddedAt: null, lastAddedAt: null });

export function createLibrarySources({ readingAt = null, importAt = null } = {}) {
  return {
    reading: readingAt == null ? emptySource() : { active: true, firstAddedAt: readingAt, lastAddedAt: readingAt },
    import: importAt == null ? emptySource() : { active: true, firstAddedAt: importAt, lastAddedAt: importAt }
  };
}

export function activateLibrarySource(record, source, occurredAt) {
  if (!['reading', 'import'].includes(source)) throw new TypeError('Unsupported vocabulary source');
  const sources = structuredClone(record.librarySources || createLibrarySources());
  const previous = sources[source] || emptySource();
  sources[source] = {
    active: true,
    firstAddedAt: previous.firstAddedAt ?? occurredAt,
    lastAddedAt: occurredAt
  };
  return {
    ...record,
    librarySourceVersion: LIBRARY_SOURCE_VERSION,
    librarySources: sources,
    libraryAddedAt: record.libraryAddedAt ?? record.createdAt ?? occurredAt,
    archivedAt: null
  };
}

export function deactivateLibrarySource(record, source, occurredAt) {
  const sources = structuredClone(record.librarySources || createLibrarySources());
  sources[source] = { ...(sources[source] || emptySource()), active: false };
  const active = sources.reading.active || sources.import.active;
  return {
    ...record,
    librarySourceVersion: LIBRARY_SOURCE_VERSION,
    librarySources: sources,
    archivedAt: active ? null : occurredAt
  };
}
```

Implement the remaining exports with these exact rules:

- `planLegacyVocabularyMigration({ learnWords, vocabulary, normalizeLemma })` returns `{ updates, inserts }` and never mutates inputs.
- A versioned row is omitted from `updates`.
- A legacy canonical row matching any saved row receives only the reading source; an unmatched row receives only the import source.
- A missing canonical row copies trusted definition fields from the newest matching saved row and uses the earliest valid saved `createdAt` as `createdAt` and `libraryAddedAt`.
- `projectUnifiedVocabulary` excludes `archivedAt != null`, joins all saved contexts by normalized lemma, and emits `sourceKeys`, `sourceLabel`, `isDue`, and `status` once per canonical ID.
- `selectUnifiedVocabulary(rows, filters)` applies query, source, SRS status, then stable sort. Dual-source rows belong to both source filters.
- Recent order is `libraryAddedAt DESC, id DESC`; alphabetical is normalized lemma ASC, id ASC; due order is recovery/due first, then recent.

- [ ] **Step 5: Run the pure tests and verify GREEN**

```powershell
node --test tests/vocabulary-library.test.mjs
```

Expected: all tests pass, 0 fail.

- [ ] **Step 6: Commit**

```powershell
git add src/vocabulary-library.mjs tests/vocabulary-library.test.mjs
git commit -m "feat(vocabulary): define unified library model"
```

---

### Task 2: Add idempotent migration, active reads, source mutation, and archive storage

**Files:**
- Modify: `src/db.js`
- Create: `tests/db-unified-vocabulary.test.mjs`
- Modify: `tests/db-review-events.test.mjs`

- [ ] **Step 1: Write failing IndexedDB migration tests**

Use the existing fake IndexedDB loader pattern from `tests/db-review-events.test.mjs`.

```js
test('getUnifiedVocabulary migrates saved matches and unmatched imports once', async () => {
  const savedId = await DB.saveWord({ word: 'derive', translation: '获得', createdAt: 20 });
  const deriveId = await DB.saveLearnWord({ word: 'derive', interval: 30, reviewRevision: 4, createdAt: 10 });
  const retainId = await DB.saveLearnWord({ word: 'retain', interval: 7, reviewRevision: 2, createdAt: 15 });

  const first = await DB.getUnifiedVocabulary();
  const second = await DB.getUnifiedVocabulary();
  assert.equal(first.length, 2);
  assert.equal(second.length, 2);
  assert.equal((await DB.findLearnWordById(deriveId)).librarySources.reading.active, true);
  assert.equal((await DB.findLearnWordById(deriveId)).librarySources.import.active, false);
  assert.equal((await DB.findLearnWordById(retainId)).librarySources.import.active, true);
  assert.equal((await DB.findLearnWordById(deriveId)).interval, 30);
  assert.equal((await DB.findLearnWordById(deriveId)).reviewRevision, 4);
  assert.ok(savedId);
});

test('migration creates a canonical word when only vocabulary exists', async () => {
  await DB.saveWord({ word: 'constraint', translation: '限制', phonetic: '/kənˈstreɪnt/' });
  const rows = await DB.getUnifiedVocabulary();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].word, 'constraint');
  assert.equal(rows[0].librarySources.reading.active, true);
});
```

- [ ] **Step 2: Write failing archive and source-removal tests**

```js
async function seedDualSourceWord({ interval = 0, reviewRevision = 0 } = {}) {
  await DB.saveWord({ word: 'derive', translation: '获得', createdAt: 10 });
  return DB.saveLearnWord({
    word: 'derive',
    translation: '获得',
    interval,
    reviewRevision,
    librarySourceVersion: LIBRARY_SOURCE_VERSION,
    librarySources: createLibrarySources({ readingAt: 10, importAt: 20 }),
    libraryAddedAt: 10,
    archivedAt: null
  });
}

async function seedReadingOnlyWord() {
  await DB.saveWord({ word: 'derive', translation: '获得', createdAt: 10 });
  return DB.saveLearnWord({
    word: 'derive',
    translation: '获得',
    interval: 0,
    reviewRevision: 0,
    librarySourceVersion: LIBRARY_SOURCE_VERSION,
    librarySources: createLibrarySources({ readingAt: 10 }),
    libraryAddedAt: 10,
    archivedAt: null
  });
}

test('removing reading from a dual-source word preserves its SRS and import membership', async () => {
  const id = await seedDualSourceWord({ interval: 30, reviewRevision: 8 });
  await DB.removeReadingVocabularySource(id, { occurredAt: 1000 });
  const word = await DB.findLearnWordById(id);
  assert.equal(word.librarySources.reading.active, false);
  assert.equal(word.librarySources.import.active, true);
  assert.equal(word.archivedAt, null);
  assert.equal(word.interval, 30);
  assert.equal(word.reviewRevision, 8);
  assert.equal((await DB.getAllWords()).length, 0);
});

test('removing the only reading source archives without deleting history', async () => {
  const id = await seedReadingOnlyWord();
  await DB.addReviewEvent({ wordId: id, rating: 3, source: 'flashcard' });
  await DB.removeReadingVocabularySource(id, { occurredAt: 2000 });
  assert.equal((await DB.getAllLearnWords()).length, 0);
  assert.equal((await DB.getAllLearnWords({ includeArchived: true })).length, 1);
  assert.equal((await DB.findLearnWordById(id)).archivedAt, 2000);
  assert.equal((await DB.getReviewEvents()).length, 1);
});

test('archiveLearnWords hides words without clearing schedule or review events', async () => {
  const id = await DB.saveLearnWord({ word: 'retain', interval: 12, nextReview: 500, reviewRevision: 3 });
  await DB.addReviewEvent({ wordId: id, rating: 5, source: 'flashcard' });
  await DB.archiveLearnWords([id], { occurredAt: 3000 });
  assert.deepEqual(await DB.getAllLearnWords(), []);
  const archived = await DB.findLearnWordById(id);
  assert.equal(archived.interval, 12);
  assert.equal(archived.nextReview, 500);
  assert.equal(archived.reviewRevision, 3);
  assert.equal((await DB.getReviewEvents()).length, 1);
});
```

- [ ] **Step 3: Run the DB tests and verify RED**

```powershell
node --test tests/db-unified-vocabulary.test.mjs tests/db-review-events.test.mjs
```

Expected: FAIL because the unified repository methods and archive-aware read option do not exist.

- [ ] **Step 4: Add imports and the active-read contract**

Import `getStemForm`-based pure helpers from `src/vocabulary-library.mjs`. Change the read method without breaking existing callers:

```js
async getAllLearnWords({ includeArchived = false } = {}) {
  const db = await this.open();
  const rows = await new Promise((resolve, reject) => {
    const tx = db.transaction('learnWords', 'readonly');
    const req = tx.objectStore('learnWords').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  return includeArchived ? rows : rows.filter(word => word?.archivedAt == null);
}
```

`findLearnWord` and `findLearnWordById` continue returning archived rows so reactivation can reuse the same ID.

- [ ] **Step 5: Implement `ensureUnifiedVocabulary` and `getUnifiedVocabulary`**

```js
async ensureUnifiedVocabulary() {
  const db = await this.open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['vocabulary', 'learnWords'], 'readwrite');
    const savedStore = tx.objectStore('vocabulary');
    const wordStore = tx.objectStore('learnWords');
    const savedRequest = savedStore.getAll();
    const wordsRequest = wordStore.getAll();
    let savedRows;
    let learnRows;
    const apply = () => {
      if (!savedRows || !learnRows) return;
      const plan = planLegacyVocabularyMigration({
        learnWords: learnRows,
        vocabulary: savedRows,
        normalizeLemma: getStemForm
      });
      for (const row of plan.updates) wordStore.put(row);
      for (const row of plan.inserts) wordStore.add(row);
    };
    savedRequest.onsuccess = () => { savedRows = savedRequest.result || []; apply(); };
    wordsRequest.onsuccess = () => { learnRows = wordsRequest.result || []; apply(); };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('统一词库迁移失败'));
  });
},

async getUnifiedVocabulary() {
  await this.ensureUnifiedVocabulary();
  const [learnWords, vocabulary] = await Promise.all([
    this.getAllLearnWords(),
    this.getAllWords()
  ]);
  return projectUnifiedVocabulary({ learnWords, vocabulary, normalizeLemma: getStemForm });
}
```

Guard `apply()` with a local `applied` boolean so both request callbacks cannot enqueue the plan twice.

- [ ] **Step 6: Implement transactional source removal and archive methods**

Add these public contracts:

```js
DB.removeReadingVocabularySource(wordId, { occurredAt = Date.now() } = {})
DB.archiveLearnWords(wordIds, { occurredAt = Date.now() } = {})
DB.restoreLearnWordSource(wordId, source, { occurredAt = Date.now() } = {})
```

`removeReadingVocabularySource` must call `ensureUnifiedVocabulary` first, then use one readwrite transaction over `vocabulary` and `learnWords`. It deletes every saved row whose normalized lemma equals the canonical word, applies `deactivateLibrarySource(word, 'reading', occurredAt)`, and writes the canonical row. It must not touch review events.

`archiveLearnWords` deduplicates numeric IDs, sets only `archivedAt`, and keeps all source and SRS fields. Empty input is a no-op.

`restoreLearnWordSource` applies `activateLibrarySource`, clears `archivedAt`, and preserves SRS/revision fields.

- [ ] **Step 7: Keep the destructive reset API separate**

Do not change `clearLearnWords()` or its tests: it remains an explicit internal total reset that clears SRS and review history. The new unified page must never call it.

- [ ] **Step 8: Run DB tests and verify GREEN**

```powershell
node --test tests/vocabulary-library.test.mjs tests/db-unified-vocabulary.test.mjs tests/db-review-events.test.mjs tests/db-review-practice.test.mjs tests/db-review-settle.test.mjs
```

Expected: all selected tests pass, 0 fail.

- [ ] **Step 9: Commit**

```powershell
git add src/db.js tests/db-unified-vocabulary.test.mjs tests/db-review-events.test.mjs
git commit -m "feat(vocabulary): persist unified sources and archives"
```

---

### Task 3: Make reading saves and external imports update the same canonical word

**Files:**
- Modify: `src/db.js`
- Modify: `src/components/tooltip.js`
- Modify: `src/views/reading.js`
- Modify: `src/word-import-service.mjs`
- Modify: `tests/db-unified-vocabulary.test.mjs`
- Modify: `tests/db-external-import-review.test.mjs`
- Modify: `tests/reading-learning-activity.test.mjs`
- Modify: `tests/word-import-service.test.mjs`

- [ ] **Step 1: Write failing atomic reading-save tests**

```js
test('saving an imported word activates reading source without a second canonical row', async () => {
  const id = await DB.saveLearnWord({
    word: 'derive',
    interval: 20,
    reviewRevision: 6,
    librarySourceVersion: 1,
    librarySources: createLibrarySources({ importAt: 10 }),
    libraryAddedAt: 10
  });
  const result = await DB.saveVocabularyWord({ word: 'Derived', translation: '获得', articleId: 4 }, { occurredAt: 50 });
  assert.equal(result.learnWordId, id);
  assert.equal(result.createdLearnWord, false);
  assert.equal((await DB.getAllLearnWords()).length, 1);
  const word = await DB.findLearnWordById(id);
  assert.equal(word.librarySources.reading.active, true);
  assert.equal(word.librarySources.import.active, true);
  assert.equal(word.interval, 20);
  assert.equal(word.reviewRevision, 6);
});

test('saving an archived word restores the same id', async () => {
  const id = await DB.saveLearnWord({
    word: 'derive',
    translation: '获得',
    librarySourceVersion: LIBRARY_SOURCE_VERSION,
    librarySources: createLibrarySources(),
    libraryAddedAt: 10,
    archivedAt: 40
  });
  const result = await DB.saveVocabularyWord({ word: 'derive', translation: '获得' }, { occurredAt: 80 });
  assert.equal(result.learnWordId, id);
  assert.equal((await DB.findLearnWordById(id)).archivedAt, null);
});
```

- [ ] **Step 2: Write failing import-reactivation and same-day-dedupe tests**

```js
test('same-day import restores an archived source without adding another review event', async () => {
  const id = await DB.saveLearnWord({
    word: 'derive',
    translation: '获得',
    librarySourceVersion: LIBRARY_SOURCE_VERSION,
    librarySources: createLibrarySources({ importAt: 10 }),
    libraryAddedAt: 10,
    archivedAt: 40
  });
  await DB.applyWordImportSignal({ word: 'derive' }, { dayKey: '2026-08-24', occurredAt: 50, batchId: 'a' });
  await DB.archiveLearnWords([id], { occurredAt: 60 });
  const second = await DB.applyWordImportSignal({ word: 'derive' }, { dayKey: '2026-08-24', occurredAt: 70, batchId: 'b' });
  assert.equal(second.status, 'today_ignored');
  assert.equal((await DB.findLearnWordById(id)).archivedAt, null);
  assert.equal((await DB.getAllReviewEvents()).filter(event => event.source === 'external-import').length, 1);
});

test('importing a reading-only word activates import source and keeps one id', async () => {
  await DB.saveWord({ word: 'derive', translation: '获得', createdAt: 10 });
  const id = await DB.saveLearnWord({
    word: 'derive',
    translation: '获得',
    librarySourceVersion: LIBRARY_SOURCE_VERSION,
    librarySources: createLibrarySources({ readingAt: 10 }),
    libraryAddedAt: 10,
    archivedAt: null
  });
  await DB.applyWordImportSignal({ word: 'derive' }, { dayKey: '2026-08-24', occurredAt: 90, batchId: 'c' });
  const word = await DB.findLearnWordById(id);
  assert.equal(word.librarySources.reading.active, true);
  assert.equal(word.librarySources.import.active, true);
  assert.equal((await DB.getAllLearnWords()).length, 1);
});
```

- [ ] **Step 3: Run source-flow tests and verify RED**

```powershell
node --test tests/db-unified-vocabulary.test.mjs tests/db-external-import-review.test.mjs tests/reading-learning-activity.test.mjs tests/word-import-service.test.mjs
```

Expected: FAIL because source-aware save/reactivation is not wired.

- [ ] **Step 4: Add the atomic reading-save repository method**

Implement:

```js
DB.saveVocabularyWord(wordData, { occurredAt = Date.now() } = {})
```

It opens one transaction over `vocabulary` and `learnWords`, normalizes the lemma, reuses the existing canonical row including archived rows, writes one saved metadata row only when an equivalent active saved row does not already exist, activates the reading source, and returns:

```js
{
  vocabularyId,
  learnWordId,
  createdVocabulary,
  createdLearnWord,
  restored: previous.archivedAt != null
}
```

For a new canonical row copy only trusted definition fields already used by `Tooltip.saveWord`: `translation`, `phonetic`, `pos`, `definitionSenses`, definition schema/version metadata, and `createdAt`. Do not initialize review success fields.

- [ ] **Step 5: Replace Tooltip's two-write save flow**

Replace the existing `DB.saveWord` + `findLearnWord` + conditional `saveLearnWord` sequence with one call:

```js
const saved = await DB.saveVocabularyWord({
  articleId,
  word,
  translation: savedTranslation,
  phonetic,
  pos,
  definitionSenses,
  definitionSchemaVersion: DEFINITION_SCHEMA_VERSION,
  ...(wordData?.lexiconVersion ? { definitionLexiconVersion: wordData.lexiconVersion } : {}),
  contextSentence: ''
});
```

Build existing telemetry provenance from `saved.createdLearnWord`, `saved.learnWordId`, and `saved.vocabularyId`. Preserve failure UI and `onWordSaved` behavior.

- [ ] **Step 6: Mark explicit reading additions**

Where `src/views/reading.js` directly calls `saveLearnWord`, pass source metadata through the new source-aware option or replace it with the repository upsert so reading-origin words receive `reading` rather than the default `import` source. Do not classify a mere lookup as a source.

- [ ] **Step 7: Activate import before daily dedupe returns**

Inside `applyWordImportSignal`, read the canonical row and write the import-source activation/reactivation even when the daily activity key already exists. If the daily key exists, return `today_ignored` after the source write and do not append another external review event or change SRS. For a first signal, preserve the existing external-credit transaction exactly.

New canonical import rows must contain:

```js
librarySourceVersion: 1,
librarySources: createLibrarySources({ importAt: occurredAt }),
libraryAddedAt: occurredAt,
archivedAt: null
```

- [ ] **Step 8: Dispatch one refresh event after an import batch**

After `WordImportService.execute` completes, dispatch:

```js
document.dispatchEvent(new CustomEvent('word-library-changed', {
  detail: { reason: 'import', batchId: result.batchId || '' }
}));
```

Do not dispatch per word. The event is a UI refresh hint, not a data fact.

- [ ] **Step 9: Run source-flow tests and verify GREEN**

```powershell
node --test tests/db-unified-vocabulary.test.mjs tests/db-external-import-review.test.mjs tests/reading-learning-activity.test.mjs tests/word-import-service.test.mjs tests/word-import-view-contract.test.mjs
```

Expected: all selected tests pass, 0 fail.

- [ ] **Step 10: Commit**

```powershell
git add src/db.js src/components/tooltip.js src/views/reading.js src/word-import-service.mjs tests/db-unified-vocabulary.test.mjs tests/db-external-import-review.test.mjs tests/reading-learning-activity.test.mjs tests/word-import-service.test.mjs
git commit -m "feat(vocabulary): unify saved and imported source writes"
```

---

### Task 4: Move every practice scope and queue to active canonical words

**Files:**
- Modify: `src/review-practice.mjs`
- Modify: `src/review-queue-coordinator.mjs`
- Modify: `tests/review-practice.test.mjs`
- Modify: `tests/review-queue-coordinator.test.mjs`

- [ ] **Step 1: Replace saved-first scope fixtures with canonical fixtures**

```js
const LIBRARY_NOW = new Date(2026, 7, 24, 12).getTime();
const LIBRARY_DAY = 24 * 60 * 60 * 1000;

function canonical({ id, word = `word-${id}`, libraryAddedAt = LIBRARY_NOW, source = 'import', createdAt = libraryAddedAt } = {}) {
  const reading = source === 'reading' || source === 'both';
  const imported = source === 'import' || source === 'both';
  return {
    id,
    word,
    createdAt,
    libraryAddedAt,
    archivedAt: null,
    librarySourceVersion: 1,
    librarySources: {
      reading: { active: reading, firstAddedAt: reading ? libraryAddedAt : null, lastAddedAt: reading ? libraryAddedAt : null },
      import: { active: imported, firstAddedAt: imported ? libraryAddedAt : null, lastAddedAt: imported ? libraryAddedAt : null }
    }
  };
}

function archived(values) {
  return { ...canonical(values), archivedAt: LIBRARY_NOW - 1 };
}

function canonicalDb(learnWords) {
  return { getAllLearnWords: async () => learnWords.filter(word => word.archivedAt == null) };
}

test('today_added includes imported and saved canonical words once', async () => {
  const db = canonicalDb([
    canonical({ id: 1, word: 'imported', libraryAddedAt: new Date(2026, 7, 24, 9).getTime(), source: 'import' }),
    canonical({ id: 2, word: 'saved', libraryAddedAt: new Date(2026, 7, 24, 10).getTime(), source: 'reading' }),
    canonical({ id: 3, word: 'both', libraryAddedAt: new Date(2026, 7, 24, 11).getTime(), source: 'both' })
  ]);
  const result = await resolvePracticeScope({ db, scope: 'today_added', now: LIBRARY_NOW });
  assert.deepEqual(result.words.map(word => word.id), [1, 2, 3]);
  assert.equal(result.skipped, 0);
});

test('manual uses canonical ids and skips archived or missing ids', async () => {
  const db = canonicalDb([canonical({ id: 2 }), canonical({ id: 1 }), archived({ id: 3 })]);
  const result = await resolvePracticeScope({ db, scope: 'manual', wordIds: [3, 1, 99, 2] });
  assert.deepEqual(result.words.map(word => word.id), [2, 1]);
  assert.equal(result.skipped, 2);
});

test('recent_added uses seven local calendar days and libraryAddedAt fallback', async () => {
  const db = canonicalDb([
    canonical({ id: 4, libraryAddedAt: LIBRARY_NOW - LIBRARY_DAY * 6 }),
    canonical({ id: 5, libraryAddedAt: null, createdAt: LIBRARY_NOW - LIBRARY_DAY * 6 }),
    canonical({ id: 6, libraryAddedAt: LIBRARY_NOW - LIBRARY_DAY * 8 })
  ]);
  const result = await resolvePracticeScope({ db, scope: 'recent_added', days: 7, now: LIBRARY_NOW });
  assert.deepEqual(result.words.map(word => word.id), [4, 5]);
});
```

- [ ] **Step 2: Add a defensive archived-queue test**

```js
test('coordinator never returns an archived recovery or due word', async () => {
  const words = [
    { id: 1, word: 'active', nextReview: 1, reviewRevision: 0, archivedAt: null },
    { id: 2, word: 'archived', nextReview: 1, reviewRevision: 0, recoveryStage: 3, archivedAt: 10 }
  ];
  const coordinator = new ReviewQueueCoordinator({
    db: { getAllLearnWords: async () => words },
    srs: { getDueWords: input => input.filter(word => word.nextReview <= 10) },
    now: () => 10
  });
  const rows = await coordinator.getDueWords();
  assert.deepEqual(rows.map(word => word.id), [1]);
});
```

- [ ] **Step 3: Run tests and verify RED**

```powershell
node --test tests/review-practice.test.mjs tests/review-queue-coordinator.test.mjs
```

Expected: FAIL because current scopes read `vocabulary` and map by word form.

- [ ] **Step 4: Rewrite `resolvePracticeScope` around canonical rows**

Use only `await db.getAllLearnWords()` for all three scopes. The DB default already removes archived rows, but also filter `archivedAt == null` defensively for mocks and older adapters.

```js
const addedAtOf = word => Number(word.libraryAddedAt ?? word.createdAt) || 0;

if (scope === 'manual') {
  const requested = new Set(uniqueNumericIds(wordIds));
  const words = allWords.filter(word => requested.has(Number(word.id)) && word.archivedAt == null);
  return { words, skipped: requested.size - words.length };
}
```

For time scopes, compare `addedAtOf(word)` with existing local-day boundaries. Do not duplicate rows by source. Preserve completion storage, session snapshots, result shape, and unsupported-scope rejection.

- [ ] **Step 5: Keep a queue-level archive guard**

Filter archived words in `ReviewQueueCoordinator` even though production DB reads active rows. This protects injected DBs, resumed sessions, and stale in-memory snapshots.

- [ ] **Step 6: Run tests and verify GREEN**

```powershell
node --test tests/review-practice.test.mjs tests/review-queue-coordinator.test.mjs tests/db-review-practice.test.mjs tests/review-session.test.mjs
```

Expected: all selected tests pass, 0 fail.

- [ ] **Step 7: Commit**

```powershell
git add src/review-practice.mjs src/review-queue-coordinator.mjs tests/review-practice.test.mjs tests/review-queue-coordinator.test.mjs
git commit -m "feat(vocabulary): use canonical words for practice scopes"
```

---

### Task 5: Build the selected unified “我的词汇” page

**Files:**
- Modify: `src/views/vocabulary.js`
- Modify: `css/style.css`
- Create: `tests/unified-vocabulary-view.test.mjs`
- Modify: `tests/review-practice-view-contract.test.mjs`
- Modify: `tests/vocab-tablet-layout-contract.test.mjs`

- [ ] **Step 1: Write failing page-contract tests**

```js
test('unified page reads canonical rows and exposes the selected hierarchy', () => {
  assert.match(source, /DB\.getUnifiedVocabulary\(\)/);
  assert.match(source, /我的词汇/);
  assert.match(source, /导入单词/);
  assert.match(source, /搜索单词或释义/);
  assert.match(source, /全部/);
  assert.match(source, /收藏/);
  assert.match(source, /导入/);
  assert.match(source, /今日新增/);
  assert.match(source, /待复习/);
  assert.match(source, /最近加入/);
});

test('manual selection uses learnWord ids without saved-word remapping', () => {
  assert.match(source, /selectedWordIds/);
  assert.match(source, /scope:\s*'manual'/);
  assert.doesNotMatch(source, /learnWordsByWord/);
});

test('manage mode distinguishes cancel save from archive', () => {
  assert.match(source, /removeReadingSource/);
  assert.match(source, /archiveWords/);
  assert.match(source, /取消收藏/);
  assert.match(source, /移出词库/);
});
```

- [ ] **Step 2: Write failing behavior tests with an injected DOM/DB harness**

```js
test('source filtering keeps a dual-source row in both filters', async () => {
  await view.render(container);
  await view.setSourceFilter('reading');
  assert.deepEqual(visibleIds(container), [3, 1]);
  await view.setSourceFilter('import');
  assert.deepEqual(visibleIds(container), [3, 2]);
});

test('import completion refreshes the mounted route exactly once', async () => {
  await view.render(container);
  document.dispatchEvent(new CustomEvent('word-library-changed', { detail: { reason: 'import' } }));
  await flushPromises();
  assert.equal(db.getUnifiedVocabulary.mock.calls.length, 2);
  await view.cleanup();
  document.dispatchEvent(new CustomEvent('word-library-changed'));
  assert.equal(db.getUnifiedVocabulary.mock.calls.length, 2);
});

test('cancel saved on a dual-source word keeps the row while archive removes it', async () => {
  await view.removeReadingSource(3);
  assert.ok(rowById(container, 3));
  await view.archiveWords([3]);
  assert.equal(rowById(container, 3), null);
});
```

- [ ] **Step 3: Run view tests and verify RED**

```powershell
node --test tests/unified-vocabulary-view.test.mjs tests/review-practice-view-contract.test.mjs tests/vocab-tablet-layout-contract.test.mjs
```

Expected: FAIL because the page is saved-word-only.

- [ ] **Step 4: Replace view state and data loading**

Use this state contract:

```js
export const VocabularyView = {
  container: null,
  rows: [],
  sourceFilter: 'all',
  statusFilter: 'all',
  sortMode: 'recent',
  searchQuery: '',
  manageMode: false,
  selectionMode: false,
  selectedWordIds: new Set(),
  _libraryChangedHandler: null
};
```

`render(container)` loads `DB.getUnifiedVocabulary()` once, computes due count through `SpacedRepetition`, resolves today/recent scopes from the same canonical snapshot, and passes rows through `selectUnifiedVocabulary`. Do not query per row.

- [ ] **Step 5: Render the selected mobile hierarchy**

The visible order is:

```text
我的词汇 + 总数                         导入单词
搜索单词或释义                          筛选
全部 | 收藏 | 导入
今日新增 n | 待复习 n                  开始复习
扁平词汇列表
```

Each row uses `learnWords.id`, shows word, formatted phonetic, one trusted Chinese definition, source label (`收藏`, `导入`, or `收藏·导入`), compact SRS status, and a detail affordance. All controls use buttons/inputs with labels and `aria-pressed` or `aria-expanded` where appropriate.

The filter disclosure contains:

- SRS: 全部、新词、学习中、待复习、长期巩固;
- order: 最近加入、A–Z、待复习优先.

Search updates the local projection; it must not trigger DB reads on every keystroke.

- [ ] **Step 6: Preserve practice and management modes**

- `toggleSelection` and `toggleManage` remain mutually exclusive.
- Selection checkboxes use canonical IDs, so every visible imported word is selectable.
- `startManualPractice` passes selected IDs directly to `resolvePracticeScope`.
- Manage mode exposes “取消收藏” only when `librarySources.reading.active` is true.
- “取消收藏” calls `DB.removeReadingVocabularySource(id)` after a clear confirmation.
- “移出词库” calls `DB.archiveLearnWords(ids)` and states that history is retained.
- Replace “清空全部” with “全部移出” and archive active IDs; never call `clearLearnWords()`.
- `showWordDetail` loads the canonical word by ID and retains existing `ensureSavedWordDefinition` and `WordStudyDetail` behavior.

- [ ] **Step 7: Bind and clean one import refresh listener**

```js
bindLibraryEvents() {
  if (this._libraryChangedHandler) document.removeEventListener('word-library-changed', this._libraryChangedHandler);
  this._libraryChangedHandler = () => {
    if (location.hash === '#/vocab' && this.container?.isConnected) void this.render(this.container);
  };
  document.addEventListener('word-library-changed', this._libraryChangedHandler);
},

cleanup() {
  if (this._libraryChangedHandler) document.removeEventListener('word-library-changed', this._libraryChangedHandler);
  this._libraryChangedHandler = null;
  this.container = null;
}
```

Add `VocabularyView` to the router cleanup allowlist if the router still uses one.

- [ ] **Step 8: Add responsive styles**

Implement scoped classes for the unified header, search/filter bar, source tabs, study strip, flat rows, source/status metadata, management controls, and filter disclosure. Requirements:

```css
.vocab-unified-page,
.vocab-unified-toolbar,
.vocab-unified-list,
.vocab-unified-row { min-width: 0; }

.vocab-unified-page { overflow-x: clip; }
.vocab-unified-row { overflow-wrap: anywhere; }
.vocab-unified-source-tabs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
```

At phone widths stack row metadata without shrinking body text below existing app minimums. At tablet rail widths keep the normal App shell and cap readable content consistently with other standard pages. Do not introduce horizontal scrolling, nested card grids, or a second vocabulary grid.

- [ ] **Step 9: Run view tests and verify GREEN**

```powershell
node --test tests/unified-vocabulary-view.test.mjs tests/review-practice-view-contract.test.mjs tests/vocab-tablet-layout-contract.test.mjs tests/app-shell.test.mjs
```

Expected: all selected tests pass, 0 fail.

- [ ] **Step 10: Commit**

```powershell
git add src/views/vocabulary.js css/style.css tests/unified-vocabulary-view.test.mjs tests/review-practice-view-contract.test.mjs tests/vocab-tablet-layout-contract.test.mjs
git commit -m "feat(vocabulary): build unified vocabulary page"
```

---

### Task 6: Retire the split page and normalize every vocabulary route

**Files:**
- Modify: `src/router.js`
- Modify: `src/components/app-shell.js`
- Modify: `src/views/chat.js`
- Modify: `src/views/flashcard.js`
- Modify: `src/views/context-review.js`
- Modify: `src/views/review-mode.js`
- Modify: `src/views/stats.js`
- Delete: `src/views/learn-words.js`
- Create: `tests/unified-vocabulary-routing.test.mjs`
- Modify: `tests/app-shell.test.mjs`
- Modify: `tests/learning-profile-redesign.test.mjs`

- [ ] **Step 1: Write failing route and wording tests**

```js
test('vocab is canonical and the legacy route normalizes without LearnWordsView', () => {
  assert.match(routerSource, /hash === '#\/vocab'/);
  assert.match(routerSource, /#\/learn-words/);
  assert.match(routerSource, /replaceState/);
  assert.doesNotMatch(routerSource, /LearnWordsView/);
});

test('all user-facing vocabulary links use the canonical route', () => {
  for (const [name, source] of Object.entries(sources)) {
    assert.doesNotMatch(source, /href=["']#\/learn-words/, `${name} still links to the split page`);
  }
});

test('profile labels the active canonical count as vocabulary total', () => {
  assert.match(statsSource, /词汇总数/);
  assert.doesNotMatch(statsSource, />生词本</);
});
```

- [ ] **Step 2: Run routing tests and verify RED**

```powershell
node --test tests/unified-vocabulary-routing.test.mjs tests/app-shell.test.mjs tests/learning-profile-redesign.test.mjs
```

Expected: FAIL because the router imports and exposes `LearnWordsView` and several links still use `#/learn-words`.

- [ ] **Step 3: Normalize the legacy hash before mounting**

At the start of `Router.navigate`, normalize only the old exact route:

```js
let hash = location.hash || '#/chat';
if (hash === '#/learn-words') {
  hash = '#/vocab';
  history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`);
}
```

Then route `#/vocab` to `VocabularyView`. Remove the `LearnWordsView` import, `views` entry, and switch case. The replacement must not add another browser-history entry or cause a hashchange loop.

- [ ] **Step 4: Consolidate App shell and all links**

- Keep `navKey: 'vocab'`, title “词汇学习”, and tablet `rail` for `#/vocab`.
- Replace every `#/learn-words` link found by `rg -n "#/learn-words" src` with `#/vocab`.
- Update visible text to “我的词汇” or “词汇学习”; remove “返回生词本”和“学习词库” distinctions.
- Keep flashcard routes as focus pages whose back target is `#/vocab`.

- [ ] **Step 5: Update profile vocabulary wording and count**

`StatsView` already loads `getAllLearnWords()`. Use that active canonical array for the displayed “词汇总数”, while source-specific counts come from unified rows only if shown. Do not count raw `vocabulary` rows as total words.

- [ ] **Step 6: Delete the obsolete view**

Delete `src/views/learn-words.js` only after no source or test imports it. Confirm:

```powershell
rg -n "LearnWordsView|views/learn-words|#/learn-words" src tests
```

Expected after intended compatibility assertions are excluded: no runtime import, no runtime link, and only the router's legacy alias string remains.

- [ ] **Step 7: Run routing and profile tests and verify GREEN**

```powershell
node --test tests/unified-vocabulary-routing.test.mjs tests/app-shell.test.mjs tests/learning-profile-redesign.test.mjs tests/review-practice-view-contract.test.mjs
```

Expected: all selected tests pass, 0 fail.

- [ ] **Step 8: Commit**

```powershell
git add src/router.js src/components/app-shell.js src/views/chat.js src/views/flashcard.js src/views/context-review.js src/views/review-mode.js src/views/stats.js src/views/learn-words.js tests/unified-vocabulary-routing.test.mjs tests/app-shell.test.mjs tests/learning-profile-redesign.test.mjs
git commit -m "refactor(vocabulary): retire split learning library"
```

---

### Task 7: Preserve history while active consumers ignore archives

**Files:**
- Modify: `src/views/report.js`
- Modify: `src/daily-learning-report-service.mjs`
- Modify: `src/components/learning-agent.js`
- Modify: `tests/daily-learning-report-service.test.mjs`
- Modify: `tests/learning-agent.test.mjs`
- Modify: `tests/learning-profile-redesign.test.mjs`
- Modify: `tests/review-queue-coordinator.test.mjs`

- [ ] **Step 1: Write failing active-versus-history tests**

In `tests/daily-learning-report-service.test.mjs`, make these exact edits to the existing `createFixture` helper.

Change its signature:

```js
function createFixture({ analyze = null, learnWords = [], reviewEvents = [] } = {}) {
```

Add this immediately after `const pruneCalls = [];`:

```js
const learnWordReadOptions = [];
```

Replace the two existing DB methods with:

```js
async getAllLearnWords(options = {}) {
  learnWordReadOptions.push(structuredClone(options));
  return options.includeArchived
    ? structuredClone(learnWords)
    : structuredClone(learnWords.filter(word => word.archivedAt == null));
},
async getAllReviewEvents() { return structuredClone(reviewEvents); },
```

Replace the existing helper return with:

```js
return { service, activities, reports, pruneCalls, learnWordReadOptions };
```

Then add the regression test:

```js

test('daily report resolves an archived word referenced by a historical review event', async () => {
  const { service, learnWordReadOptions } = createFixture({
    learnWords: [{ id: 4, word: 'derive', archivedAt: at(11), createdAt: at(8) }],
    reviewEvents: [{ id: 8, wordId: 4, source: 'external-import', reviewedAt: at(9), scheduleChanged: true }]
  });
  const report = await service.getOrCreate(DATE_KEY);
  assert.deepEqual(report.vocabulary.externalReviewWords, ['derive']);
  assert.equal(learnWordReadOptions.some(options => options.includeArchived === true), true);
});
```

In `tests/learning-agent.test.mjs`, add a behavioral active-only check using the existing `loadAgent` helper:

```js
test('agent current vocabulary tools exclude archived words', async () => {
  const { LearningAgent } = await loadAgent();
  const allWords = [
    { id: 1, word: 'active', translation: '活跃', archivedAt: null, nextReview: 1 },
    { id: 2, word: 'archived', translation: '归档', archivedAt: 10, nextReview: 1 }
  ];
  const db = {
    getAllLearnWords: async ({ includeArchived = false } = {}) => includeArchived
      ? allWords
      : allWords.filter(word => word.archivedAt == null),
    getAllArticles: async () => [],
    getAllReadingStats: async () => []
  };
  const agent = new LearningAgent({
    db,
    srs: {
      getDueCount: words => words.length,
      getDueWords: words => words,
      getStatus: () => 'review'
    },
    now: () => 100
  });
  assert.equal((await agent.execute('get_learning_overview')).totals.words, 1);
  assert.deepEqual((await agent.execute('find_learning_words', {})).words.map(word => word.word), ['active']);
  assert.deepEqual((await agent.execute('get_review_queue')).words.map(word => word.word), ['active']);
});
```

In `tests/learning-profile-redesign.test.mjs`, assert that current and lifetime reads are deliberately separate:

```js
test('weekly report separates active vocabulary from lifetime history', async () => {
  const source = await readFile(new URL('../src/views/report.js', import.meta.url), 'utf8');
  assert.match(source, /getAllLearnWords\(\)/);
  assert.match(source, /getAllLearnWords\(\{\s*includeArchived:\s*true\s*\}\)/);
  assert.match(source, /activeLearnWords/);
  assert.match(source, /allLearnWords/);
});
```

- [ ] **Step 2: Run compatibility tests and verify RED**

```powershell
node --test tests/daily-learning-report-service.test.mjs tests/learning-agent.test.mjs tests/learning-profile-redesign.test.mjs tests/review-queue-coordinator.test.mjs
```

Expected: FAIL where historical consumers currently use the default active-only read.

- [ ] **Step 3: Classify every `getAllLearnWords` call**

Use active default reads for:

- `ReviewQueueCoordinator`;
- flashcard/context/practice candidates;
- article generation target candidates;
- reading word marking;
- current Agent word lookup and due summaries;
- current profile “词汇总数”.

Use `getAllLearnWords({ includeArchived: true })` for:

- historical daily-report reconstruction that joins old activities/events by word ID;
- lifetime achievement/report calculations whose meaning is “ever learned”;
- repair/export/data-maintenance paths.

Do not include archived words in current due, recovery, new-word, reading-generation, or current vocabulary totals.

- [ ] **Step 4: Keep event history resolvable**

Where a historical aggregator maps `reviewEvents.wordId` to a word, build that map from the include-archived array. Do not change stored review events, daily activity records, or report fingerprints except where the resolved lemma was previously missing.

- [ ] **Step 5: Run compatibility tests and verify GREEN**

```powershell
node --test tests/daily-learning-report-service.test.mjs tests/daily-learning-report.test.mjs tests/learning-agent.test.mjs tests/learning-agent-daily-report.test.mjs tests/learning-profile-redesign.test.mjs tests/review-queue-coordinator.test.mjs
```

Expected: all selected tests pass, 0 fail.

- [ ] **Step 6: Commit**

```powershell
git add src/views/report.js src/daily-learning-report-service.mjs src/components/learning-agent.js tests/daily-learning-report-service.test.mjs tests/learning-agent.test.mjs tests/learning-profile-redesign.test.mjs tests/review-queue-coordinator.test.mjs
git commit -m "fix(vocabulary): preserve archived learning history"
```

---

### Task 8: Complete regression, build, and browser acceptance

**Files:**
- Modify only if verification exposes a scoped defect.

- [ ] **Step 1: Run every focused vocabulary test together**

```powershell
node --test tests/vocabulary-library.test.mjs tests/db-unified-vocabulary.test.mjs tests/db-external-import-review.test.mjs tests/review-practice.test.mjs tests/review-queue-coordinator.test.mjs tests/unified-vocabulary-view.test.mjs tests/unified-vocabulary-routing.test.mjs tests/review-practice-view-contract.test.mjs tests/vocab-tablet-layout-contract.test.mjs tests/app-shell.test.mjs tests/learning-profile-redesign.test.mjs tests/daily-learning-report-service.test.mjs tests/learning-agent.test.mjs
```

Expected: all selected tests pass, 0 fail.

- [ ] **Step 2: Run the complete regression suite**

```powershell
node --test tests/*.test.mjs
```

Expected: 0 failures. Record total, pass, and skipped counts rather than assuming the plan-creation baseline remains unchanged.

- [ ] **Step 3: Build the private QA web artifact without bumping versions**

```powershell
npm run build:private-qa
```

Expected: Vite build, private artifact validation, and Capacitor sync exit 0. Do not run `npm run build:apk`, change `version.json`, or edit Android `versionCode` in this task.

- [ ] **Step 4: Run phone-width browser smoke tests**

At approximately 390×844 verify:

1. Existing direct-import words appear under “全部”和“导入”.
2. Existing saved words appear under “全部”和“收藏”.
3. Importing an existing saved word changes one row to “收藏·导入”.
4. Search finds English, phonetic, and Chinese text.
5. Default ordering puts newly added words first; A–Z and due order work.
6. Today/recent/manual practice include imported words and still do not modify SRS.
7. Canceling save on a dual-source row keeps it; canceling a reading-only row removes it from the active page.
8. Archiving removes a row and due count without erasing a historical report.
9. Import completion refreshes the open page once.
10. No horizontal scrolling occurs in the toolbar, tabs, filters, or long rows.

- [ ] **Step 5: Run tablet-width browser smoke tests**

At rail-layout tablet widths verify:

1. The global menu/rail remains visible in normal, manage, and selection modes.
2. The page remains one readable unified column rather than two vocabulary grids.
3. Search, filter disclosure, source tabs, actions, and list rows fit without clipping.
4. `#/learn-words` replaces to `#/vocab` without a second history entry.

- [ ] **Step 6: Audit the approved design line by line**

Confirm explicitly:

- `learnWords` remains the only SRS identity;
- historical saved matches are reading, unmatched learning rows are import;
- no legacy dual source is invented;
- `vocabulary` is context metadata only;
- source changes do not alter formal SRS;
- archive retains review/report history;
- every active consumer excludes archives;
- today/recent/manual scopes use canonical IDs;
- the split page and runtime links are gone;
- `main`, private packs, versions, and APK outputs were not modified.

- [ ] **Step 7: Commit only verification fixes, if any**

If verification required a scoped code correction, commit the exact changed files with:

```powershell
git add src/vocabulary-library.mjs src/db.js src/components/tooltip.js src/views/reading.js src/word-import-service.mjs src/review-practice.mjs src/review-queue-coordinator.mjs src/views/vocabulary.js css/style.css src/router.js src/components/app-shell.js src/views/chat.js src/views/flashcard.js src/views/context-review.js src/views/review-mode.js src/views/stats.js src/views/report.js src/daily-learning-report-service.mjs src/components/learning-agent.js tests/vocabulary-library.test.mjs tests/db-unified-vocabulary.test.mjs tests/db-review-events.test.mjs tests/db-external-import-review.test.mjs tests/reading-learning-activity.test.mjs tests/word-import-service.test.mjs tests/review-practice.test.mjs tests/review-queue-coordinator.test.mjs tests/unified-vocabulary-view.test.mjs tests/review-practice-view-contract.test.mjs tests/vocab-tablet-layout-contract.test.mjs tests/unified-vocabulary-routing.test.mjs tests/app-shell.test.mjs tests/learning-profile-redesign.test.mjs tests/daily-learning-report-service.test.mjs tests/learning-agent.test.mjs
git commit -m "fix(vocabulary): close unified library regressions"
```

If no correction was required, do not create an empty commit.

- [ ] **Step 8: Return handoff evidence**

Report:

- branch and worktree path;
- commit hashes and subjects;
- focused and full test totals;
- private QA web build result;
- phone and tablet smoke observations;
- `git status --short --branch`;
- explicit statement that no merge, push, tag, APK build, version bump, `main`, or private-pack edit occurred.

---

## Expected commit sequence

1. `feat(vocabulary): define unified library model`
2. `feat(vocabulary): persist unified sources and archives`
3. `feat(vocabulary): unify saved and imported source writes`
4. `feat(vocabulary): use canonical words for practice scopes`
5. `feat(vocabulary): build unified vocabulary page`
6. `refactor(vocabulary): retire split learning library`
7. `fix(vocabulary): preserve archived learning history`
8. Optional only when verification finds a scoped defect: `fix(vocabulary): close unified library regressions`
