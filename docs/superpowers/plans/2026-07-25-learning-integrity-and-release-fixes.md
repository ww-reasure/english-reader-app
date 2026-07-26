# Learning Integrity and Release Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every learning and article-generation path behave consistently, prevent invalid assessment recommendations, and release a verifiably new Android build as `1.8.6 (32)`.

**Architecture:** Keep the existing Vite ES-module SPA, IndexedDB schema and Capacitor shell. Centralize article-generation constraints in `ArticleGenerationTool`, use one explicit `stable` SRS state throughout the UI, and separate pure parsing/normalization logic from DOM code so it can receive real unit tests. Release metadata becomes a single synchronized set: package manifest, Android Gradle manifest and `version.json`.

**Tech Stack:** Native ES modules, Node built-in test runner, IndexedDB, Vite, Capacitor Android, existing DeepSeek-compatible API.

---

## File Structure

- `scripts/bump-version.js`: synchronizes all three release metadata files and exports a metadata consistency assertion.
- `scripts/build-apk.js`: refuses to build an APK when release metadata is inconsistent.
- `version.json`: generated/released version metadata, including current version code and build date.
- `src/spaced-repetition.js`: exposes the canonical `stable` status predicate used by views.
- `src/views/learn-words.js`: displays and filters long-term stable words correctly.
- `src/views/chat.js`: routes review reading into the shared article-generation executor.
- `src/components/article-generation-tool.js`: owns profile-aware prompting, bounded/deduplicated target words, validation and article persistence.
- `src/difficulty-profile.mjs`: owns pure profile constraints shared by article and assessment prompts.
- `src/api.js`: receives the selected profile from the tool instead of consulting unrelated global difficulty state.
- `src/views/flashcard.js` and `src/views/reading.js`: form explicit, bounded review batches and accurately describe any deferred words.
- `src/assessment-questions.mjs` (new): pure answer normalization and question-set validation.
- `src/views/assessment.js`: retries malformed AI question sets, requires answers before scoring, and cancels stale background assessment requests.
- `src/db.js`: aborts failed scoring transactions and clears review history when the learning store is explicitly cleared.
- `tests/*.test.mjs`: regression coverage for each fixed contract.

### Task 1: Make Release Metadata Atomic

**Files:**
- Modify: `scripts/bump-version.js`
- Modify: `scripts/build-apk.js`
- Modify: `tests/bump-version.test.mjs`
- Modify: `tests/build-apk-script.test.mjs`
- Modify: `version.json`
- Modify: `VERSIONING.md`

- [ ] **Step 1: Add a failing metadata synchronization test.**

Add a pure helper test that starts with a version manifest and expects its semantic version, code and date fields to be updated together:

```js
test('synchronizes version.json with the Android release metadata', () => {
  const manifest = { version: '1.8.5', versionCode: 31, buildDate: '2026-07-24', changes: [] };
  assert.deepEqual(withVersionManifest(manifest, '1.8.6', 32, '2026-07-25'), {
    ...manifest, version: '1.8.6', versionCode: 32, buildDate: '2026-07-25'
  });
});
```

- [ ] **Step 2: Run the focused test to prove the helper is missing.**

Run: `node --test tests/bump-version.test.mjs`
Expected: FAIL because `withVersionManifest` is not exported.

- [ ] **Step 3: Implement synchronized manifest updates.**

Add `versionJsonPath`, `getAndroidVersionCode(buildGradle)`, and `withVersionManifest(manifest, version, code, date)`. `writeVersion()` must:

```js
const nextCode = getAndroidVersionCode(buildGradle) + 1;
const versionManifest = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
fs.writeFileSync(versionJsonPath, `${JSON.stringify(
  withVersionManifest(versionManifest, nextVersion, nextCode, new Date().toISOString().slice(0, 10)),
  null,
  2
)}\n`, 'utf8');
```

Keep the `changes` array untouched; release notes remain a deliberate release-time edit, rather than an invented automatic description.

Export a pure `assertReleaseMetadata(packageJson, buildGradle, versionManifest)` function. It must throw when the semantic version or Android version code differs across those three sources.

- [ ] **Step 4: Block manual inconsistent APK builds.**

At the beginning of `scripts/build-apk.js`, read the three manifests and call `assertReleaseMetadata()`. Add a failing test that passes a stale `version.json` fixture and expects `npm run build:apk`'s preflight helper to reject before Gradle starts. This prevents a manually invoked build from bypassing `npm run release:patch` and recreating the current mismatch.

- [ ] **Step 5: Make the release contract explicit.**

Update `VERSIONING.md` to state that `npm run release:patch` synchronizes `package.json`, `package-lock.json`, `android/app/build.gradle`, and `version.json`; a release is invalid if any version or code differs.

- [ ] **Step 6: Verify and commit.**

Run: `node --test tests/bump-version.test.mjs`
Expected: PASS.

Commit:

```powershell
git add scripts/bump-version.js scripts/build-apk.js tests/bump-version.test.mjs tests/build-apk-script.test.mjs VERSIONING.md
git commit -m "fix: synchronize release version metadata"
```

### Task 2: Repair the `stable` SRS-State Integration

**Files:**
- Modify: `src/spaced-repetition.js`
- Modify: `src/views/learn-words.js`
- Modify: `src/views/chat.js`
- Create: `tests/srs-status-integration.test.mjs`

- [ ] **Step 1: Add failing state-consistency tests.**

Test the pure state contract and each UI call site:

```js
test('long-interval words are stable and excluded only from non-due review candidates', async () => {
  assert.equal(SpacedRepetition.getStatus({ reviewCount: 6, interval: 21 }), 'stable');
  assert.equal(SpacedRepetition.isStable({ reviewCount: 6, interval: 21 }), true);
  assert.match(chatSource, /dueWords[\s\S]*!SpacedRepetition\.isStable\(w\)/);
  assert.match(learnWordsSource, /filterMode === 'stable'/);
});
```

- [ ] **Step 2: Run the focused test and confirm the current `mastered` references fail.**

Run: `node --test tests/srs-status-integration.test.mjs`
Expected: FAIL because `isStable` and the `stable` UI filter do not exist.

- [ ] **Step 3: Introduce one stable-state predicate.**

In `SpacedRepetition`, add:

```js
isStable(word) {
  return this.getStatus(word) === 'stable';
}
```

Use it from chat when building review candidates. Do not compare a raw status string outside the SRS facade for the stable/not-stable decision.

In `getStatus()`, map a legacy persisted `state: 'mastered'` to `stable` before the interval fallback, so old records do not disappear while their state is migrated lazily on the next score.

- [ ] **Step 4: Rename the visible filter state coherently.**

Change `LearnWordsView.filterMode` from `mastered` to `stable`, count `SpacedRepetition.isStable(word)`, and render the last tab as `长期巩固`. Include `relearning` in the visible `学习中` count/filter so it does not vanish from all status tabs. Preserve the other filters exactly as they are. Homepage review construction must be `dueWords + nonStableWords`: an already-due stable word remains eligible through `dueWords`, while an unexpired stable word is excluded from the supplemental candidate set.

- [ ] **Step 5: Run focused and full tests, then commit.**

Run: `node --test tests/srs-status-integration.test.mjs; node --test tests/*.test.mjs`
Expected: all tests PASS.

Commit:

```powershell
git add src/spaced-repetition.js src/views/learn-words.js src/views/chat.js tests/srs-status-integration.test.mjs
git commit -m "fix: use stable SRS status consistently"
```

### Task 3: Centralize Bounded, Profile-Aware Article Generation

**Files:**
- Modify: `src/components/article-generation-tool.js`
- Modify: `src/difficulty-profile.mjs`
- Modify: `src/api.js`
- Modify: `tests/article-generation-tool.test.mjs`
- Create: `tests/article-generation-profile.test.mjs`

- [ ] **Step 1: Add failing tests for two invariants.**

The tool must normalize a supplied target list to unique, non-empty words with a maximum of eight, and pass the same normalized profile into the API prompt:

```js
test('bounds explicit targets and validates only the selected batch', async () => {
  assert.deepEqual(normalizeTargetWords(['one', 'one', '', ...Array.from({ length: 12 }, (_, i) => `w${i}`)]),
    ['one', 'w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6']);
});

test('uses the requested generation profile in the API prompt', () => {
  const prompt = API.buildArticlePrompt('cet4', 280, 'one, two', getDifficultyProfile('cet4', 'support'));
  assert.match(prompt, /平均句长必须控制在 10-17 词/);
  assert.doesNotMatch(prompt, /每句18-25个单词/);
});
```

- [ ] **Step 2: Run focused tests and confirm they fail.**

Run: `node --test tests/article-generation-tool.test.mjs tests/article-generation-profile.test.mjs`
Expected: FAIL because the target cap and profile parameter do not exist.

- [ ] **Step 3: Add explicit target and profile helpers.**

In `article-generation-tool.js`, export a case-insensitive normalizer:

```js
export const MAX_TARGET_WORDS = 8;
export function normalizeTargetWords(words = [], limit = MAX_TARGET_WORDS) {
  const seen = new Set();
  return words.reduce((selected, value) => {
    const word = String(value || '').trim();
    const key = word.toLowerCase();
    if (word && !seen.has(key) && selected.length < limit) {
      seen.add(key);
      selected.push(word);
    }
    return selected;
  }, []);
}
```

Use its result for both `keywords` and `validateArticle()`. Return `selectedWords` and `deferredWords` metadata so callers can accurately tell users what was included. Add a narrow `articleFields` option that only persists `{ reviewMode: Boolean, usedWords: string[] }`; merge that whitelist after the generated article fields. This is the only internal extension point used by review-reading callers.

- [ ] **Step 4: Pass the profile into the API prompt.**

Change the API signatures to carry the selected profile:

```js
buildArticlePrompt(difficulty, wordCount, keywords, profile)
generateArticle(prompt, difficulty, topic, keywords, wordCount, learningContext, { signal, profile } = {})
```

Export `formatProfileConstraints(profile)` from `difficulty-profile.mjs`, then generate the authoritative profile section from `profile.wordRange` and `profile.sentenceRange`. Use legacy easy/hard vocabulary guidance only as supporting material; it must not state conflicting word-count or sentence-length rules. Do not read `Config.get('level')` inside this generation path.

- [ ] **Step 5: Verify tool behavior and commit.**

Run: `node --test tests/article-generation-tool.test.mjs tests/article-generation-profile.test.mjs`
Expected: PASS, including retry/no-save behavior.

Commit:

```powershell
git add src/components/article-generation-tool.js src/difficulty-profile.mjs src/api.js tests/article-generation-tool.test.mjs tests/article-generation-profile.test.mjs
git commit -m "fix: align article prompts with validated profiles"
```

### Task 4: Route Every Review-Reading Entry Through the Shared Tool

**Files:**
- Modify: `src/views/chat.js`
- Modify: `src/views/flashcard.js`
- Modify: `src/views/reading.js`
- Modify: `src/api.js`
- Modify: `tests/article-generation-tool.test.mjs`
- Create: `tests/review-reading-routes.test.mjs`

- [ ] **Step 1: Add failing route-regression tests.**

Test that no view directly calls `API.generateArticle` or `API.generateReviewArticle`, and that all three review flows use `ArticleGenerationTool.execute`:

```js
for (const source of [chatSource, flashcardSource, readingSource]) {
  assert.match(source, /ArticleGenerationTool/);
  assert.match(source, /\.execute\(/);
  assert.doesNotMatch(source, /API\.generateReviewArticle\(/);
}
```

- [ ] **Step 2: Create bounded review batches.**

Export `chunkTargetWords(words, size = MAX_TARGET_WORDS)` from `article-generation-tool.js`. It must deduplicate first, then split into groups of at most eight. The UI policy is:

- generate at most two cards per user action;
- take the first two explicit batches in the caller's already meaningful order (due-first on the homepage, review order on flashcards, click order in reading);
- if more than sixteen words exist, state `本次优先巩固 16 / N 个词` before generation;
- never claim that every supplied word was used when words were deferred.

Use this exact selection shape in callers:

```js
const allWords = normalizeTargetWords(candidateWords, Number.POSITIVE_INFINITY);
const allBatches = chunkTargetWords(allWords);
const selectedBatches = allBatches.slice(0, 2);
const selectedWords = selectedBatches.flat();
const deferredCount = Math.max(0, allWords.length - selectedWords.length);
```

- [ ] **Step 3: Migrate homepage review reading.**

Replace `API.generateReviewArticle()` in `ChatView.handleReviewGenerate()` with the tool. Pass `fallbackChallenge: 'support'`, each selected target batch, and `articleFields: { reviewMode: true, usedWords: selectedBatch }`. Remove the obsolete API method after its final caller is gone.

- [ ] **Step 4: Migrate flashcard and reader review wording.**

Use `chunkTargetWords()` in `FlashcardView.generateReviewArticle()` and `ReadingView.generateReview()`. Preserve the existing two-card maximum, pass each batch through the tool, and show a truthful selected/deferred-word count in the chat message. A failed first batch must not save a partial article or attempt the second batch.

- [ ] **Step 5: Run route tests and manual flow checks.**

Run: `node --test tests/review-reading-routes.test.mjs tests/article-generation-tool.test.mjs`
Expected: PASS.

Manually verify in the web app with 20+ saved/reviewed words:

1. Homepage `复习阅读` creates at most two valid cards.
2. Flashcard `生成阅读` shows selected/deferred counts.
3. Reader `生成巩固阅读` cannot fail solely because more than eight words were clicked.

- [ ] **Step 6: Commit.**

```powershell
git add src/views/chat.js src/views/flashcard.js src/views/reading.js src/api.js src/components/article-generation-tool.js tests/review-reading-routes.test.mjs tests/article-generation-tool.test.mjs
git commit -m "fix: unify bounded review reading generation"
```

### Task 5: Make Assessment Results Valid or Explicitly Incomplete

**Files:**
- Create: `src/assessment-questions.mjs`
- Modify: `src/views/assessment.js`
- Modify: `src/difficulty-profile.mjs`
- Create: `tests/assessment-questions.test.mjs`
- Modify: `tests/assessment-reading-profile.test.mjs`

- [ ] **Step 1: Add pure question-normalization tests.**

```js
test('normalizes numeric and letter answers into zero-based indexes', () => {
  assert.equal(normalizeAnswer('A', 4), 0);
  assert.equal(normalizeAnswer('d', 4), 3);
  assert.equal(normalizeAnswer('2', 4), 2);
});

test('rejects an incomplete AI question set', () => {
  assert.equal(normalizeQuestionSet([{ question: 'Q', options: ['a', 'b', 'c', 'd'], answer: 'A' }]).valid, false);
});
```

- [ ] **Step 2: Run focused tests and confirm they fail.**

Run: `node --test tests/assessment-questions.test.mjs`
Expected: FAIL because the pure normalization module does not exist.

- [ ] **Step 3: Implement valid question-set normalization.**

`normalizeQuestionSet(rawQuestions)` must return `{ valid, questions, reason }`, accept numeric `0-3`, numeric strings and `A-D` answers, and require exactly three questions with four non-empty options each.

- [ ] **Step 4: Integrate it into generation and submission.**

During `generateAssessmentArticle()`, import and use `formatProfileConstraints(profile)` rather than embedding legacy `API.difficultyRules[difficultyKey]` sentence/word-count instructions. Validate both article metrics and the question set before returning. Treat an invalid question set as a retryable generation deviation. After two invalid attempts, show a generation error rather than a misleading assessment.

Before `showResult()` calculates any profile, require an answer for every rendered question. Leave the user on the self-assessment page and show `请完成全部阅读理解题后查看结果` when any is missing. Never convert absence into an incorrect answer.

- [ ] **Step 5: Prevent stale background articles from entering a new run.**

Add an `assessmentRunId` and an `AbortController` to state. Capture the run ID before generating article two; only append it when the ID still matches. `cleanup()` must abort the controller. This prevents an old background request from adding an article after the user leaves and starts a new assessment.

- [ ] **Step 6: Verify and commit.**

Run: `node --test tests/assessment-questions.test.mjs tests/assessment-reading-profile.test.mjs tests/reading-profile.test.mjs`
Expected: PASS.

Manual checks:

1. A CET-6 assessment cannot submit with a blank answer.
2. An `A/B/C/D` model response renders three answerable questions.
3. Leaving an in-flight assessment and starting another does not insert a stale second article.

Commit:

```powershell
git add src/assessment-questions.mjs src/views/assessment.js tests/assessment-questions.test.mjs tests/assessment-reading-profile.test.mjs
git commit -m "fix: require valid assessment evidence"
```

### Task 6: Finish the Review-Event Transaction Contract

**Files:**
- Modify: `src/db.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tests/learning-scheduler.test.mjs`
- Create: `tests/db-review-events.test.mjs`

- [ ] **Step 1: Add actual IndexedDB and abort-path regression tests.**

Add `fake-indexeddb` as a development dependency. In the new test, install its `indexedDB` implementation on `globalThis`, set `DB.DB_NAME` to a unique test database, and assert both the successful and missing-word paths. Also test the exported abort helper directly so the cancellation call itself is covered:

```js
test('missing review words reject without creating a review event', async () => {
  await assert.rejects(DB.recordLearnWordReview(999, { interval: 1 }, { rating: 5 }), /学习词不存在/);
  assert.deepEqual(await DB.getReviewEventsForWord(999), []);
});

test('abortTransaction cancels an active transaction with its domain error', () => {
  const tx = { aborted: false, abort() { this.aborted = true; } };
  const error = new Error('学习词不存在');
  assert.equal(abortTransaction(tx, error), error);
  assert.equal(tx.aborted, true);
});
```

- [ ] **Step 2: Run it to confirm the current transaction path fails or is incomplete.**

Run: `node --test tests/db-review-events.test.mjs`
Expected: FAIL because `abortTransaction` is not exported.

- [ ] **Step 3: Abort rather than merely reject.**

Export `abortTransaction(tx, error)`, which calls `tx.abort()` and returns `error`. In `recordLearnWordReview()`, retain the domain error in `failure`, call `abortTransaction(tx, failure)` if the word cannot be found, and reject from `tx.onabort` with `failure || tx.error`. Do not allow `tx.oncomplete` to resolve after a known failure.

- [ ] **Step 4: Clear invisible review history with an explicit full reset.**

Change `clearLearnWords()` to open one `readwrite` transaction for both `learnWords` and `reviewEvents`, then clear both stores. Keep single-word deletion behavior unchanged for this release so historical event cleanup is not silently broadened.

- [ ] **Step 5: Verify and commit.**

Run: `node --test tests/db-review-events.test.mjs tests/learning-scheduler.test.mjs`
Expected: PASS.

Perform a browser IndexedDB smoke test: create a review event, clear the learning store, reload, and verify that neither word nor event remains.

Commit:

```powershell
git add src/db.js package.json package-lock.json tests/db-review-events.test.mjs tests/learning-scheduler.test.mjs
git commit -m "fix: abort failed review writes and clear event history"
```

### Task 7: Release Verification and Android Package

**Files:**
- Modify: `version.json` through the release script only
- Generated: `android/app/build/outputs/apk/debug/app-debug.apk`

- [ ] **Step 1: Run the complete regression suite.**

Run: `node --test tests/*.test.mjs`
Expected: all tests PASS with no skipped regression suite.

- [ ] **Step 2: Perform browser validation at mobile widths.**

Validate `#/chat`, `#/learn-words`, `#/flashcard`, `#/assessment`, and generated reading cards at 320px and 360px widths. Confirm no horizontal overflow, fixed controls remain reachable, long-term stable words render in their tab, and an incomplete assessment cannot apply settings.

- [ ] **Step 3: Create the patch release exactly once.**

Run: `npm run release:patch`
Expected: `package.json` and `android/app/build.gradle` report `1.8.6 (32)`, `version.json` reports the same values, and an APK is produced.

- [ ] **Step 4: Inspect the exact artifact before handoff.**

Run:

```powershell
Get-Item android\app\build\outputs\apk\debug\app-debug.apk | Select-Object FullName,Length,LastWriteTime
Get-Content version.json
```

Confirm the package is newer than the prior `1.8.5 (31)` build. Install on Android only after this check; do not publish or overwrite a GitHub Release as part of this task.

- [ ] **Step 5: Commit release metadata.**

```powershell
git add package.json package-lock.json android/app/build.gradle version.json
git commit -m "chore: release 1.8.6"
```

## Coverage Audit

- Release inconsistency: Task 1 and Task 7.
- `stable`/`mastered` behavior: Task 2.
- All review-generation paths, target count and profile alignment: Tasks 3 and 4.
- Blank/malformed assessment evidence and stale generation: Task 5.
- Failed review-write transaction semantics: Task 6.
- Build, APK, mobile DOM and final version check: Task 7.

The plan deliberately does not alter CloudBase ingestion, dictionary behavior, stored article schemas, or the visual design system. It keeps the current feature set and corrects the cross-path contracts that currently produce misleading learning outcomes.

## Native Identifier Boundary

`capacitor.config.json` currently declares `com.englishreader.app`, while the installed Android application uses `com.example.englishreader`. Do not change either identifier in this patch: changing Android `applicationId` without a migration decision would create a separate app and prevent normal updates for existing users. Before any future package-ID cleanup, inspect a released APK's package identity and decide whether continuity or a deliberate migration is intended.
