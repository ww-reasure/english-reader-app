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
    .replace("import { getStemForm } from './helpers.js';", "const getStemForm = word => String(word || '').trim().toLowerCase();")
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
  module.DB.DB_NAME = `EnglishReaderReviewIdempotency-${process.pid}-${databaseSequence++}`;
  return module;
}

test('settleSessionReview replays the same attempt without a second revision or event', async () => {
  const { DB } = await createDatabase();
  const wordId = await DB.saveLearnWord({
    word: 'idempotent',
    reviewRevision: 0,
    interval: 2,
    state: 'review'
  });
  const srsData = { interval: 4, state: 'review', nextReview: 4000 };
  const event = {
    attemptId: 'attempt-idempotent',
    expectedRevision: 0,
    rating: 5,
    source: 'flashcard'
  };

  const first = await DB.settleSessionReview(wordId, srsData, event);
  const replay = await DB.settleSessionReview(wordId, srsData, event);

  assert.equal(first.reviewRevision, 1);
  assert.equal(replay.reviewRevision, 1);
  assert.equal((await DB.findLearnWordById(wordId)).reviewRevision, 1);
  assert.equal((await DB.getReviewEventsForWord(wordId)).length, 1);
});

test('database version includes the additive attemptId index migration', async () => {
  const { DB } = await createDatabase();
  assert.ok(Number(DB.DB_VERSION) >= 21);
});
