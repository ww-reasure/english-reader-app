import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  contentFingerprint,
  createReadingProgressSession
} from '../src/reading-progress.mjs';

let moduleSequence = 0;

async function loadReadingView({ db, evidence }) {
  const source = await readFile(new URL('../src/views/reading.js', import.meta.url), 'utf8');
  const runtime = source.replace(
    /^import\s+(?:\{[\s\S]*?\}|[^;\n]+)\s+from\s+['"][^'"]+['"];\r?\n/gm,
    ''
  );
  globalThis.__readingCompletionDb = db;
  globalThis.__readingCompletionEvidence = evidence;
  globalThis.window = { removeEventListener() {} };
  globalThis.document = {
    removeEventListener() {},
    querySelectorAll() { return []; }
  };

  return import(`data:text/javascript;base64,${Buffer.from(`
    const DB = globalThis.__readingCompletionDb;
    const createLexiconLoader = () => ({});
    const createKnowledgeEvidenceBridge = () => globalThis.__readingCompletionEvidence;
    const evaluateReadingSession = () => ({ qualified: true });
    const resolveArticleTrack = () => ({ targetTrack: 'cet4' });
    const __moduleSequence = ${moduleSequence++};
    ${runtime}
  `).toString('base64')}`);
}

function createActivityTracker({ failCompletedFlush = false } = {}) {
  let completed = false;
  let failed = false;
  return {
    record() {},
    async markCompleted() {
      completed = true;
    },
    async flush() {
      if (completed && failCompletedFlush && !failed) {
        failed = true;
        throw new Error('completed activity unavailable');
      }
      return { saved: true };
    }
  };
}

test('failed completion activity keeps the reading cycle restartable for idempotent replay', async () => {
  const stats = new Map();
  const evidenceByArticle = new Map();
  let statAttempts = 0;
  let evidenceAttempts = 0;
  const db = {
    async saveReadingStat(stat) {
      statAttempts += 1;
      if (!stats.has(stat.completionId)) stats.set(stat.completionId, structuredClone(stat));
    }
  };
  const evidence = {
    async recordQualifiedReadingObservation(observation) {
      evidenceAttempts += 1;
      if (!evidenceByArticle.has(observation.articleId)) {
        evidenceByArticle.set(observation.articleId, structuredClone(observation));
      }
      return { accepted: true };
    }
  };
  const { ReadingView } = await loadReadingView({ db, evidence });
  const article = {
    id: 'restartable-article',
    title: 'Restartable reading',
    content: 'A reading cycle that must survive a failed completion activity write.',
    wordCount: 240,
    difficulty: 'cet4'
  };
  let storedProgress = null;
  let deleteCalls = 0;
  const sessionOptions = persisted => ({
    articleId: article.id,
    content: article.content,
    persisted,
    now: () => persisted ? 20_000 : 10_000,
    save: async snapshot => { storedProgress = structuredClone(snapshot); },
    remove: async () => {
      deleteCalls += 1;
      storedProgress = null;
    }
  });
  let activityFailurePrompts = 0;
  let summaries = 0;

  Object.assign(ReadingView, {
    articleData: article,
    clickedWords: [],
    cycleReviewRatings: [],
    reviewMode: false,
    guideModeUsed: false,
    readingScrollDepth: 1,
    readingProgress: null,
    readingProgressSession: createReadingProgressSession(sessionOptions(null)),
    readingProgressFinalizing: false,
    readingProgressCompletion: null,
    readingCompletionSummary: null,
    readingActivityTracker: createActivityTracker({ failCompletedFlush: true }),
    readingActivityCompletionPending: false,
    timer: { elapsed: 120, stop() {} },
    _resumeHandler: null,
    _readingScrollTarget: null,
    _scrollProgressHandler: null,
    _visibilityHandler: null,
    _pagehideHandler: null,
    _updateReadingScrollDepth() {},
    _readingProgressInput() {
      return { activeSeconds: 120, fullProgress: 1, mode: 'full' };
    },
    _recordReadingProgressActivity() {},
    getSentenceGuideProgress() { return 0; },
    _showReadingActivitySaveFailure() { activityFailurePrompts += 1; },
    _showReadingProgressCleanupFailure() {
      assert.fail('progress cleanup should not run before completion activity is durable');
    },
    async showSummary() { summaries += 1; }
  });

  const originalCompletionId = ReadingView.readingProgressSession.getCompletionId();
  await ReadingView.finishReading();

  assert.equal(storedProgress?.status, 'in_progress');
  assert.equal(storedProgress?.completionId, originalCompletionId);
  assert.equal(deleteCalls, 0);
  assert.equal(activityFailurePrompts, 1);
  assert.equal(summaries, 0);

  const restartedSession = createReadingProgressSession(sessionOptions(storedProgress));
  assert.equal(restartedSession.getCompletionId(), originalCompletionId);
  ReadingView.readingProgressSession = restartedSession;
  ReadingView.readingProgressCompletion = null;
  ReadingView.readingCompletionSummary = null;
  ReadingView.readingProgressFinalizing = false;
  ReadingView.readingActivityCompletionPending = false;
  ReadingView.readingActivityTracker = createActivityTracker();

  await ReadingView.finishReading();

  assert.equal(statAttempts, 2);
  assert.equal(stats.size, 1);
  assert.equal(evidenceAttempts, 2);
  assert.equal(evidenceByArticle.size, 1);
  assert.equal(deleteCalls, 1);
  assert.equal(storedProgress, null);
  assert.equal(summaries, 1);
});
