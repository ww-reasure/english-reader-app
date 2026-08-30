import assert from 'node:assert/strict';
import test from 'node:test';

import { ReviewQueueCoordinator } from '../src/review-queue-coordinator.mjs';

test('both review modes read the same due queue and capture the current revision', async () => {
  const words = [
    { id: 1, word: 'shared', nextReview: 10, reviewRevision: 3 },
    { id: 2, word: 'future', nextReview: Date.now() + 86400000, reviewRevision: 1 }
  ];
  const coordinator = new ReviewQueueCoordinator({
    db: { getAllLearnWords: async () => words },
    srs: { getDueWords: input => input.filter(word => word.nextReview <= 10) }
  });

  const recall = await coordinator.getDueWords({ limit: 20 });
  const context = await coordinator.getDueWords({ limit: 10 });

  assert.deepEqual(recall, [{ ...words[0], expectedRevision: 3 }]);
  assert.deepEqual(context, recall);
});

test('uses a caller-provided word snapshot without reading the full vocabulary again', async () => {
  const words = [
    { id: 1, word: 'snapshot', nextReview: 10, reviewRevision: 2 },
    { id: 2, word: 'archived', nextReview: 10, reviewRevision: 1, archivedAt: 20 }
  ];
  let fullReads = 0;
  const coordinator = new ReviewQueueCoordinator({
    db: {
      async getAllLearnWords() {
        fullReads += 1;
        return [];
      }
    },
    srs: { getDueWords: input => input.filter(word => word.nextReview <= 10) }
  });

  const due = await coordinator.getDueWords({ words, limit: 20 });

  assert.equal(fullReads, 0);
  assert.deepEqual(due, [{ ...words[0], expectedRevision: 2 }]);
});

test('summarizes a caller-provided snapshot without a second full vocabulary read', async () => {
  const words = [
    { id: 1, nextReview: 5, recoveryStage: 1 },
    { id: 2, nextReview: null },
    { id: 3, nextReview: 999 }
  ];
  let fullReads = 0;
  const coordinator = new ReviewQueueCoordinator({
    db: {
      async getAllLearnWords() {
        fullReads += 1;
        return [];
      }
    },
    srs: { getDueWords: input => input.filter(word => !word.nextReview || word.nextReview <= 10) },
    now: () => 10
  });

  const summary = await coordinator.getDueSummary({ words });

  assert.equal(fullReads, 0);
  assert.equal(summary.candidateCount, 2);
  assert.equal(summary.recoveryCount, 1);
});

test('revalidation skips a word reviewed by the other mode', async () => {
  const coordinator = new ReviewQueueCoordinator({
    db: { findLearnWordById: async () => ({ id: 1, reviewRevision: 4, nextReview: 999 }) },
    srs: { getDueWords: words => words.filter(word => word.nextReview <= 10) },
    now: () => 10
  });

  assert.deepEqual(await coordinator.revalidate({ id: 1, expectedRevision: 3 }), {
    current: false,
    reason: 'reviewed-elsewhere',
    word: null
  });
});

test('uses exam priority only as a tie-breaker inside the shared due queue', async () => {
  const words = [
    { id: 1, word: 'ordinary', nextReview: null, state: 'new', interval: 0 },
    { id: 2, word: 'frequent', nextReview: null, state: 'new', interval: 0 },
    { id: 3, word: 'future', nextReview: 999, state: 'review', interval: 3 }
  ];
  const coordinator = new ReviewQueueCoordinator({
    db: { getAllLearnWords: async () => words },
    srs: { getDueWords: input => input.filter(word => !word.nextReview || word.nextReview <= 10) },
    examPriority: async word => word.word === 'frequent' ? 90 : 0
  });

  const due = await coordinator.getDueWords({ limit: 10, targetTrack: 'kaoyan1' });
  assert.deepEqual(due.map(word => word.word), ['frequent', 'ordinary']);
  assert.equal(due.some(word => word.word === 'future'), false);
});

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

test('the review entry reads the vocabulary once and preloads only the configured track', async () => {
  const { readFile } = await import('node:fs/promises');
  const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const srcUrl = relative => new URL(relative, new URL('../src/review-mode.js', import.meta.url)).href;

  const reviewModeSource = await readFile(new URL('../src/views/review-mode.js', import.meta.url), 'utf8');
  const dbStub = dataModule(`
    let fullReads = 0;
    export const DB = {
      getAllLearnWords: async () => {
        fullReads += 1;
        return [
          { id: 1, word: 'due', nextReview: 1, reviewRevision: 1 },
          { id: 2, word: 'future', nextReview: Date.now() + 86400000, reviewRevision: 1 }
        ];
      },
      getReads: () => fullReads
    };
  `);
  const srsStub = dataModule(`
    export const SpacedRepetition = {
      getDueWords: (words, limit) => words.filter(word => (word.nextReview || 0) <= 10).slice(0, limit)
    };
  `);
  const reviewQueueShim = dataModule(`
    import { ReviewQueueCoordinator } from '${srcUrl('./review-queue-coordinator.mjs')}';
    import { SpacedRepetition } from '${srsStub}';
    import { DB } from '${dbStub}';
    export const ReviewQueue = new ReviewQueueCoordinator({ db: DB, srs: SpacedRepetition, examPriority: async () => 0 });
  `);
  const examStub = dataModule(`
    export const ExamCorpus = {
      preloaded: [],
      preload: async targetTrack => { ExamCorpus.preloaded.push(targetTrack); return true; }
    };
  `);

  const adapted = reviewModeSource
    .replace("from '../db.js'", `from '${dbStub}'`)
    .replace("from '../review-queue.js'", `from '${reviewQueueShim}'`)
    .replace("from '../config.js'", `from '${dataModule("export const Config = { get: () => 'cet4' };")}'`)
    .replace("from '../exam-corpus-runtime.mjs'", `from '${examStub}'`);
  const { ReviewModeView } = await import(dataModule(adapted));
  const { DB } = await import(dbStub);
  const { ExamCorpus } = await import(examStub);

  const container = { innerHTML: '' };
  await ReviewModeView.render(container);

  assert.equal(DB.getReads(), 1, 'the review entry must read the full vocabulary exactly once');
  assert.match(container.innerHTML, /个词可进入复习/);
  assert.match(container.innerHTML, /到期 1/);

  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(ExamCorpus.preloaded, ['cet4'], 'idle preload must target the configured exam track only');

  ReviewModeView.cleanup();
  assert.equal(ReviewModeView.container, null);
});
