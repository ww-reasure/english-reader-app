import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { indexedDB } from 'fake-indexeddb';

const srcDir = new URL('../src/', import.meta.url);
const fileUrl = relative => new URL(relative, srcDir).href;
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

let databaseSequence = 0;
let flashcardUrl = null;

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: key => { values.delete(key); }
  };
}

function installBrowserGlobals() {
  globalThis.indexedDB = indexedDB;
  globalThis.localStorage = memoryStorage();
  globalThis.sessionStorage = memoryStorage();
  globalThis.window = {};
  globalThis.document = {
    createElement: () => {
      let text = '';
      return {
        set textContent(value) { text = String(value ?? ''); },
        get textContent() { return text; },
        get innerHTML() {
          return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        }
      };
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    body: { classList: { add: () => {}, remove: () => {} } }
  };
}

async function loadSharedDb() {
  const source = await readFile(new URL('../src/db.js', import.meta.url), 'utf8');
  const abs = relative => new URL(relative, new URL('../src/db.js', import.meta.url)).href;
  const adapted = source
    .replace("import { getStemForm } from './helpers.js';", "const getStemForm = word => String(word || '').trim().toLowerCase();")
    .replace("from './cloud-article-metadata.mjs'", `from '${abs('./cloud-article-metadata.mjs')}'`)
    .replace("from './learning-day.mjs'", `from '${abs('./learning-day.mjs')}'`)
    .replace("from './learning-activity.mjs'", `from '${abs('./learning-activity.mjs')}'`)
    .replace("from './external-review-scheduler.mjs'", `from '${abs('./external-review-scheduler.mjs')}'`)
    .replace("from './recovery-scheduler.mjs'", `from '${abs('./recovery-scheduler.mjs')}'`)
    .replace("from './vocabulary-library.mjs'", `from '${abs('./vocabulary-library.mjs')}'`);
  return dataModule(adapted);
}

const stub = source => dataModule(source);

// The package is CommonJS-typed, so .js files with ESM syntax cannot be
// imported by file URL. Load them as data-ESM with rewritten specifiers,
// exactly like the established db.js test assembly does. `overrides` maps an
// original specifier to a final absolute URL; unlisted specifiers keep their
// own file URL (safe for .mjs-only dependency chains).
async function loadSourceAsDataEsm(relative, overrides = {}) {
  const moduleUrl = new URL(relative, srcDir);
  const source = await readFile(moduleUrl, 'utf8');
  const adapted = source.replace(/from '(\.[^']+)'/g, (match, specifier) => {
    const target = Object.prototype.hasOwnProperty.call(overrides, specifier)
      ? overrides[specifier]
      : new URL(specifier, moduleUrl).href;
    return `from '${target}'`;
  });
  return dataModule(adapted);
}

async function loadFlashcardView(dbUrl) {
  if (flashcardUrl) return import(flashcardUrl);
  const spacedRepetitionUrl = await loadSourceAsDataEsm('./spaced-repetition.js');
  const helpersUrl = await loadSourceAsDataEsm('./helpers.js');
  const wordStudyStageUrl = await loadSourceAsDataEsm('./components/word-study-stage.mjs', {
    '../helpers.js': helpersUrl
  });
  const reviewQueueShim = stub(`
    import { ReviewQueueCoordinator } from '${fileUrl('./review-queue-coordinator.mjs')}';
    import { SpacedRepetition } from '${spacedRepetitionUrl}';
    import { DB } from '${dbUrl}';
    export const ReviewQueue = new ReviewQueueCoordinator({
      db: DB,
      srs: SpacedRepetition,
      examPriority: async () => 0
    });
  `);
  const source = await readFile(new URL('../src/views/flashcard.js', import.meta.url), 'utf8');
  const importMap = new Map([
    ["'../db.js'", `'${dbUrl}'`],
    ["'../spaced-repetition.js'", `'${spacedRepetitionUrl}'`],
    ["'../dictionary.js'", stub('export const Dictionary = { lookup: async () => null };')],
    ["'../helpers.js'", `'${helpersUrl}'`],
    ["'../config.js'", stub("export const Config = { get: () => '', hasApiKey: () => false };")],
    ["'../components/modal.js'", stub('export const Modal = { showApiSettings: () => {} };')],
    ["'../api.js'", stub('export const API = { translateSentence: async () => "" };')],
    ["'./chat.js'", stub('export const ChatView = {};')],
    ["'../examples.js'", stub('export const Examples = { getExamples: async () => [] };')],
    ["'../affixes.js'", stub(`export const Affixes = {
      getAnalysis: async () => null,
      getRelatedWordDetails: () => [],
      enrichRelatedTranslations: async () => null,
      hasStructuredRoot: () => false,
      ensureStructuredRoot: async () => null
    };`)],
    ["'../components/tooltip.js'", stub(`export const Tooltip = {
      hide: () => {},
      attachAutoDismiss: () => {},
      beginLookup: () => {},
      show: () => {},
      showError: () => {},
      isVisible: () => false,
      getWordAtPoint: () => null
    };`)],
    ["'../audio-cache.js'", stub('export const AudioCache = { getAudio: async () => false, stop: () => {} };')],
    ["'../exam-corpus-runtime.mjs'", stub(`export const ExamCorpus = {
      getExamples: async () => [],
      lookupAll: async () => ({}),
      lookup: async () => null,
      preload: async () => {}
    };`)],
    ["'../components/article-generation-tool.js'", stub('export const normalizeTargetWords = value => value;')],
    ["'../lexicon-runtime.mjs'", stub('export const createLexiconLoader = () => ({});')],
    ["'../components/knowledge-evidence-bridge.mjs'", stub(`export const createKnowledgeEvidenceBridge = () => ({
      recordFlashcardRating: async () => {}
    });`)],
    ["'../learning-track.mjs'", `'${fileUrl('./learning-track.mjs')}'`],
    ["'../components/definition-trust.mjs'", `'${fileUrl('./components/definition-trust.mjs')}'`],
    ["'../components/saved-word-definition.mjs'", `'${fileUrl('./components/saved-word-definition.mjs')}'`],
    ["'../review-queue.js'", reviewQueueShim],
    ["'../review-practice.mjs'", `'${fileUrl('./review-practice.mjs')}'`],
    ["'../review-session.mjs'", `'${fileUrl('./review-session.mjs')}'`],
    ["'../review-persistence.mjs'", `'${fileUrl('./review-persistence.mjs')}'`],
    ["'../review-persistence-status.mjs'", `'${fileUrl('./review-persistence-status.mjs')}'`],
    ["'../recovery-scheduler.mjs'", `'${fileUrl('./recovery-scheduler.mjs')}'`],
    ["'../learning-activity.mjs'", `'${fileUrl('./learning-activity.mjs')}'`],
    ["'../learning-day.mjs'", `'${fileUrl('./learning-day.mjs')}'`],
    ["'../study-session-timer.mjs'", `'${fileUrl('./study-session-timer.mjs')}'`],
    ["'../review-session-metrics.mjs'", `'${fileUrl('./review-session-metrics.mjs')}'`],
    ["'../components/word-phrases.js'", stub('export const WordPhrases = { get: async () => [] };')],
    ["'../components/word-similar.js'", stub('export const WordSimilar = { get: async () => [] };')],
    ["'../components/exam-corpus-presentation.mjs'", `'${fileUrl('./components/exam-corpus-presentation.mjs')}'`],
    ["'../components/word-study-materials.mjs'", `'${fileUrl('./components/word-study-materials.mjs')}'`],
    ["'../components/word-study-stage.mjs'", `'${wordStudyStageUrl}'`],
    ["'../flashcard-flow.mjs'", `'${fileUrl('./flashcard-flow.mjs')}'`]
  ]);
  let unmapped = null;
  const adapted = source.replace(/from '(\.[^']+)'/g, (match, specifier) => {
    const target = importMap.get(`'${specifier}'`);
    if (!target) {
      unmapped = specifier;
      return match;
    }
    return `from '${target.replaceAll("'", '')}'`;
  });
  if (unmapped) throw new Error(`flashcard behavior test: unmapped import ${unmapped}`);
  flashcardUrl = dataModule(adapted);
  return import(flashcardUrl);
}

function createContainer() {
  return {
    innerHTML: '',
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {}
  };
}

async function seedDueWords(DB, count) {
  const ids = [];
  for (let index = 0; index < count; index += 1) {
    ids.push(await DB.saveLearnWord({
      word: `behavior${index + 1}`,
      translation: `释义 ${index + 1}`,
      interval: 30,
      reviewCount: 8,
      easeFactor: 2.5,
      state: 'review',
      nextReview: 1,
      reviewRevision: 3
    }));
  }
  return ids;
}

test('a formal 20-word mixed session keeps a fixed denominator, weakest-rated results, and one durable outcome per exposure', async () => {
  installBrowserGlobals();
  const dbUrl = await loadSharedDb();
  const { DB } = await import(dbUrl);
  DB.DB_NAME = `EnglishReaderFlashcardBehavior-${process.pid}-${databaseSequence++}`;
  const { FlashcardView } = await loadFlashcardView(dbUrl);
  const { getReviewPersistence } = await import(fileUrl('./review-persistence.mjs'));

  const originalIds = await seedDueWords(DB, 20);
  const firstQuality = new Map();
  originalIds.forEach((id, index) => {
    firstQuality.set(Number(id), index < 12 ? 5 : index < 16 ? 3 : 1);
  });

  const container = createContainer();
  await FlashcardView.render(container);

  assert.match(container.innerHTML, /data-flashcard-content="recall"/);
  assert.match(container.innerHTML, /已学会 0 \/ 20/);

  const exposuresById = new Map();
  const progressReadings = [];
  let exposures = 0;
  let lastStudyHtml = '';

  for (let guard = 0; guard < 45; guard += 1) {
    const progressMatch = container.innerHTML.match(/已学会 (\d+) \/ 20/);
    if (progressMatch) progressReadings.push(Number(progressMatch[1]));
    if (container.innerHTML.includes('flashcard-review-shell--result')) break;

    const word = FlashcardView.words[FlashcardView.currentIndex];
    assert.ok(word, 'a card must be on screen before the session completes');
    const id = Number(word.id);
    const exposureCount = exposuresById.get(id) || 0;
    exposuresById.set(id, exposureCount + 1);
    const quality = exposureCount === 0 ? firstQuality.get(id) : 5;
    exposures += 1;

    await FlashcardView.submitRating(quality);
    lastStudyHtml = container.innerHTML;
    if (container.innerHTML.includes('flashcard-review-shell--result')) break;
    FlashcardView.advanceToNextWord();
  }

  assert.equal(exposures, 28, '20 first exposures plus 8 weak-answer reinserts');
  const reExposed = [...exposuresById.entries()].filter(([, count]) => count > 1);
  assert.equal(reExposed.length, 8, 'exactly the 8 weak-rated words are shown twice');

  const summary = FlashcardView.reviewMetrics.summary();
  assert.deepEqual(summary, {
    total: 20,
    mastered: 20,
    masteryRate: 100,
    known: 12,
    uncertain: 4,
    unknown: 4,
    rated: 20
  });
  assert.match(lastStudyHtml, /已学会 20 \/ 20/);
  assert.match(container.innerHTML, /复习完成/);
  assert.match(container.innerHTML, /本轮学会率：100%/);
  assert.ok(progressReadings.every((learned, index) => learned >= 0 && learned <= 20 && (index === 0 || learned >= progressReadings[index - 1])), 'learned count stays within 0-20 and never decreases');

  const persistence = getReviewPersistence(DB);
  await persistence.flush({ timeoutMs: 10000 });
  const ratingStatus = persistence.getStatus().rating;
  assert.equal(ratingStatus.pending, 0, 'every accepted exposure is settled');
  assert.equal(ratingStatus.failed, 0);

  for (const [index, id] of originalIds.entries()) {
    const word = await DB.findLearnWordById(Number(id));
    assert.ok(word, `word ${id} still exists`);
    const events = await DB.getReviewEventsForWord(Number(id));
    const expected = index < 12 ? [5] : index < 16 ? [3, 5] : [1, 5];
    // getReviewEventsForWord returns newest-first by reviewedAt; the settled
    // rating multiset is the invariant here (journal order is covered by the
    // persistence tests).
    assert.deepEqual(events.map(event => Number(event.rating)).sort((a, b) => a - b), expected.slice().sort((a, b) => a - b), `word ${id} settles exactly its exposed ratings`);
    assert.equal(events.length, expected.length);
    assert.equal(Number(word.reviewRevision), 3 + expected.length, `word ${id} advances revision once per settled rating`);
  }

  const today = JSON.parse(globalThis.localStorage.getItem('todayReviewedWords'));
  assert.equal(today.date.length > 0, true);
  assert.equal(today.words.length, 20, 'today list stays unique per word across reinserts');
  for (const entry of today.words) {
    const id = originalIds.find((_, index) => `behavior${index + 1}` === entry.word);
    const first = firstQuality.get(Number(id));
    assert.equal(entry.weakestQuality, Math.min(first, 5));
    assert.equal(entry.lastQuality, 5);
    assert.equal(entry.mastered, true);
  }
});

test('a resumed practice session counts only this run in the result while group progress reaches 4/4', async () => {
  installBrowserGlobals();
  const dbUrl = await loadSharedDb();
  const { DB } = await import(dbUrl);
  DB.DB_NAME = `EnglishReaderPracticeResume-${process.pid}-${databaseSequence++}`;
  const { FlashcardView } = await loadFlashcardView(dbUrl);
  const { createPracticeSession, PRACTICE_SESSION_KEY } = await import(fileUrl('./review-practice.mjs'));

  // 四个整组词；SRS 字段固定，练习结束后必须原样保留。
  const groupIds = [];
  const srsSeed = { interval: 30, reviewCount: 8, easeFactor: 2.5, state: 'review', nextReview: Date.now() + 86400000, reviewRevision: 3 };
  for (let index = 1; index <= 4; index += 1) {
    groupIds.push(await DB.saveLearnWord({
      word: `practiceresume${index}`,
      translation: `续练词 ${index}`,
      ...srsSeed,
      createdAt: Date.now() - 86400000
    }));
  }

  // 此前已完成 1 词（manual scope，今日窗口内的练习事件）。
  await DB.recordLearnWordPractice(groupIds[0], {
    rating: 5,
    sawAnswer: true,
    practiceScope: 'manual'
  });

  // 续练会话：本次只展示剩余 3 词，整组仍为 4 词。
  createPracticeSession({
    scope: 'manual',
    wordIds: groupIds.slice(1),
    expectedWordIds: groupIds,
    reviewAll: false
  });

  const container = createContainer();
  await FlashcardView.render(container, 'manual');
  assert.match(container.innerHTML, /data-flashcard-content="recall"/, 'the resumed practice session must start on a recall card');

  const progressReadings = [];
  let exposures = 0;
  for (let guard = 0; guard < 10; guard += 1) {
    if (container.innerHTML.includes('flashcard-review-shell--result')) break;
    const progressMatch = container.innerHTML.match(/(\d+) \/ (\d+)/);
    if (progressMatch) progressReadings.push({ learned: Number(progressMatch[1]), total: Number(progressMatch[2]) });
    await FlashcardView.submitRating(5);
    exposures += 1;
    if (container.innerHTML.includes('flashcard-review-shell--result')) break;
    const studyProgress = container.innerHTML.match(/(\d+) \/ (\d+)/);
    if (studyProgress) progressReadings.push({ learned: Number(studyProgress[1]), total: Number(studyProgress[2]) });
    FlashcardView.advanceToNextWord();
  }

  assert.equal(exposures, 3, 'only the three remaining words are presented this run');
  assert.match(container.innerHTML, /flashcard-review-shell--result/);

  const summary = FlashcardView.reviewMetrics.summary();
  assert.equal(summary.total, 3, 'this-run result counts only the words actually presented');
  assert.equal(summary.rated, 3);
  assert.equal(summary.known, 3);
  assert.equal(summary.mastered, 3);
  assert.equal(summary.masteryRate, 100);

  assert.match(container.innerHTML, /本轮学会率：100%/);
  assert.match(container.innerHTML, /专项练习完成/);
  assert.doesNotMatch(container.innerHTML, /未评分/);
  const lastProgress = progressReadings.at(-1);
  assert.deepEqual(lastProgress, { learned: 4, total: 4 }, 'group progress finishes at 4 / 4');
  assert.ok(progressReadings.every(p => p.total === 4), 'group progress keeps the whole selection as its denominator');

  // 专项练习不得修改正式 SRS。
  for (const id of groupIds) {
    const word = await DB.findLearnWordById(Number(id));
    assert.equal(word.interval, srsSeed.interval, `word ${id} interval unchanged`);
    assert.equal(word.state, srsSeed.state, `word ${id} state unchanged`);
    assert.equal(Number(word.reviewRevision), srsSeed.reviewRevision, `word ${id} reviewRevision unchanged`);
    assert.equal(word.easeFactor, srsSeed.easeFactor, `word ${id} easeFactor unchanged`);
  }
});

test('navigating the real router to #/flashcard/recall opens the formal recall page', async () => {
  installBrowserGlobals();
  const dbUrl = await loadSharedDb();
  const { DB } = await import(dbUrl);
  DB.DB_NAME = `EnglishReaderRouterRecall-${process.pid}-${databaseSequence++}`;
  const flashcardModule = await loadFlashcardView(dbUrl);
  const { createNavigationController } = await import(fileUrl('./router-navigation.mjs'));
  const { resolveRoute } = await import(fileUrl('./router-routes.mjs'));

  await DB.saveLearnWord({
    word: 'routerrecall1',
    translation: '路由回忆词',
    interval: 30,
    reviewCount: 8,
    easeFactor: 2.5,
    state: 'review',
    nextReview: Date.now() - 86400000,
    reviewRevision: 3,
    createdAt: Date.now() - 86400000
  });

  const container = createContainer();
  const controller = createNavigationController({
    appShell: { cleanup() {}, mount() { return container; } },
    wordStudyDetail: { close() {} },
    getApp: () => ({}),
    getRouteMeta: () => ({ title: '单词复习' }),
    resolveRoute: hash => {
      const route = resolveRoute(hash);
      if (route.exportName !== 'FlashcardView') throw new Error(`unexpected route ${route.routeKey}`);
      return { ...route, load: () => Promise.resolve(flashcardModule) };
    }
  });

  const result = await controller.navigate('#/flashcard/recall');
  assert.equal(result.ok, true, `navigation must succeed: ${result.error?.message || ''}`);
  assert.match(container.innerHTML, /data-flashcard-content="recall"/, 'the formal recall card must render');
  assert.doesNotMatch(container.innerHTML, /专项练习已失效/, 'a formal recall navigation must not be treated as an invalid practice session');
  assert.match(container.innerHTML, /routerrecall1/);
});
