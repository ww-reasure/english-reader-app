import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { indexedDB } from 'fake-indexeddb';

let databaseSequence = 0;

async function loadDatabaseModule() {
  const source = await readFile(new URL('../src/db.js', import.meta.url), 'utf8');
  const metadataUrl = new URL('../src/cloud-article-metadata.mjs', import.meta.url).href;
  const learningDayUrl = new URL('../src/learning-day.mjs', import.meta.url).href;
  const learningActivityUrl = new URL('../src/learning-activity.mjs', import.meta.url).href;
  const externalSchedulerUrl = new URL('../src/external-review-scheduler.mjs', import.meta.url).href;
  const vocabularyLibraryUrl = new URL('../src/vocabulary-library.mjs', import.meta.url).href;
  const adapted = source
    .replace(
      "import { getStemForm } from './helpers.js';",
      "const getStemForm = word => String(word || '').trim().toLowerCase();"
    )
    .replace("from './cloud-article-metadata.mjs'", `from '${metadataUrl}'`)
    .replace("from './learning-day.mjs'", `from '${learningDayUrl}'`)
    .replace("from './learning-activity.mjs'", `from '${learningActivityUrl}'`)
    .replace("from './external-review-scheduler.mjs'", `from '${externalSchedulerUrl}'`)
    .replace("from './vocabulary-library.mjs'", `from '${vocabularyLibraryUrl}'`);
  return import(`data:text/javascript;base64,${Buffer.from(adapted).toString('base64')}`);
}

async function createDatabase() {
  globalThis.indexedDB = indexedDB;
  const module = await loadDatabaseModule();
  module.DB.DB_NAME = `EnglishReaderPractice-${process.pid}-${databaseSequence++}`;
  return module;
}

test('practice ratings write only a review event and never touch the SRS plan', async () => {
  const { DB } = await createDatabase();
  const wordId = await DB.saveLearnWord({
    word: 'settler',
    interval: 4,
    reviewCount: 2,
    easeFactor: 2.5,
    state: 'review',
    learningStep: null,
    lapseCount: 0,
    nextReview: 1_000,
    lastReview: 500,
    lastQuality: 5,
    schedulerVersion: 2,
    reviewRevision: 3
  });
  const before = await DB.findLearnWordById(wordId);

  await DB.recordLearnWordPractice(wordId, { rating: 1, sawAnswer: false, practiceScope: 'today_added' });
  await DB.recordLearnWordPractice(wordId, { rating: 3, sawAnswer: true, practiceScope: 'manual' });

  const after = await DB.findLearnWordById(wordId);
  for (const field of ['interval', 'reviewCount', 'easeFactor', 'state', 'learningStep', 'lapseCount', 'nextReview', 'lastReview', 'lastQuality', 'schedulerVersion', 'reviewRevision']) {
    assert.deepEqual(after[field], before[field], `${field} 不应被练习评分修改`);
  }

  const events = (await DB.getReviewEventsForWord(wordId)).sort((a, b) => Number(a.reviewedAt) - Number(b.reviewedAt));
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(event => event.source), ['practice-flashcard', 'practice-flashcard']);
  assert.equal(events[0].rating, 1);
  assert.equal(events[0].practiceScope, 'today_added');
  assert.equal(events[1].rating, 3);
  assert.equal(events[1].practiceScope, 'manual');
});

test('practice rating rejects invalid ratings and missing words gracefully', async () => {
  const { DB } = await createDatabase();
  await assert.rejects(DB.recordLearnWordPractice(1, { rating: 4 }), /有效评分/);
  await assert.rejects(DB.recordLearnWordPractice(null, { rating: 5 }), /有效的单词 id/);

  const events = await DB.getReviewEventsForWord(1);
  assert.equal(events.length, 0);
});

test('practice review events can be queried in one bounded batch for progress', async () => {
  const { DB } = await createDatabase();
  const startedAt = Date.now() - 1_000;

  await DB.recordLearnWordPractice(11, { rating: 5, practiceScope: 'today_added' });
  await DB.recordLearnWordPractice(12, { rating: 3, practiceScope: 'recent_added' });

  const events = await DB.getPracticeReviewEvents({
    practiceScope: 'today_added',
    from: startedAt,
    to: Date.now() + 1_000,
    wordIds: [11, 99]
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].wordId, 11);
  assert.equal(events[0].practiceScope, 'today_added');
  assert.equal(events[0].source, 'practice-flashcard');
});
