import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { indexedDB } from 'fake-indexeddb';

let databaseSequence = 0;

async function loadDatabaseModule() {
  const source = await readFile(new URL('../src/db.js', import.meta.url), 'utf8');
  const adapted = source.replace(
    "import { getStemForm } from './helpers.js';",
    "const getStemForm = word => String(word || '').trim().toLowerCase();"
  );
  return import(`data:text/javascript;base64,${Buffer.from(adapted).toString('base64')}`);
}

async function createDatabase() {
  globalThis.indexedDB = indexedDB;
  const module = await loadDatabaseModule();
  module.DB.DB_NAME = `EnglishReaderReviewEvents-${process.pid}-${databaseSequence++}`;
  return module;
}

test('missing review words reject without creating a review event', async () => {
  const { DB } = await createDatabase();

  await assert.rejects(
    DB.recordLearnWordReview(999, { interval: 1, state: 'learning' }, { rating: 5 }),
    /学习词不存在/
  );
  assert.deepEqual(await DB.getReviewEventsForWord(999), []);
});

test('correcting a mistaken known score replaces its schedule and review event without duplication', async () => {
  const { DB } = await createDatabase();
  const wordId = await DB.saveLearnWord({
    word: 'settler',
    interval: 4,
    reviewCount: 2,
    easeFactor: 2.5,
    state: 'review',
    learningStep: null,
    lapseCount: 0
  });
  const attemptId = 'flashcard:42:settler';

  await DB.recordLearnWordReview(wordId, {
    interval: 10,
    reviewCount: 3,
    easeFactor: 2.6,
    state: 'review',
    learningStep: null,
    lapseCount: 0,
    lastQuality: 5,
    nextReview: 2_000,
    schedulerVersion: 2
  }, { rating: 5, source: 'flashcard', sawAnswer: false, attemptId });

  await DB.correctLearnWordReview(wordId, {
    interval: 0,
    reviewCount: 2,
    easeFactor: 2.3,
    state: 'relearning',
    learningStep: 0,
    lapseCount: 1,
    lastQuality: 1,
    nextReview: 1_000,
    schedulerVersion: 2
  }, { attemptId, sawAnswer: true, correctionReason: 'mistaken-known' });

  const word = (await DB.getAllLearnWords()).find(item => item.id === wordId);
  const events = await DB.getReviewEventsForWord(wordId);
  assert.equal(word.lastQuality, 1);
  assert.equal(word.state, 'relearning');
  assert.equal(word.nextReview, 1_000);
  assert.equal(events.length, 1);
  assert.equal(events[0].rating, 1);
  assert.equal(events[0].originalRating, 5);
  assert.equal(events[0].sawAnswer, true);
  assert.equal(events[0].correctionReason, 'mistaken-known');
  assert.ok(events[0].correctedAt);
});

test('abortTransaction cancels an active transaction with its domain error', async () => {
  const { abortTransaction } = await createDatabase();
  const tx = {
    aborted: false,
    abort() {
      this.aborted = true;
    }
  };
  const error = new Error('学习词不存在');

  assert.equal(abortTransaction(tx, error), error);
  assert.equal(tx.aborted, true);
});

test('clearing learning words removes their immutable review history', async () => {
  const { DB } = await createDatabase();
  const wordId = await DB.saveLearnWord({ word: 'Persist' });

  await DB.recordLearnWordReview(wordId, { interval: 1, state: 'learning' }, { rating: 5 });
  assert.equal((await DB.getReviewEventsForWord(wordId)).length, 1);

  await DB.clearLearnWords();

  assert.deepEqual(await DB.getAllLearnWords(), []);
  assert.deepEqual(await DB.getReviewEventsForWord(wordId), []);
});

test('definition metadata updates preserve saved-word and SRS fields', async () => {
  const { DB } = await createDatabase();
  const vocabularyId = await DB.saveWord({ word: 'form', translation: '形式', contextSentence: 'A form.' });
  const learnWordId = await DB.saveLearnWord({ word: 'form', interval: 6, state: 'review' });
  const fields = {
    pos: 'noun',
    phonetic: 'fɔːm',
    definitionSenses: [{ pos: 'noun', glossZh: '类型；形式' }],
    definitionSchemaVersion: 1
  };

  await DB.updateWordDefinition(vocabularyId, fields);
  await DB.updateLearnWordDefinition(learnWordId, fields);

  const vocabulary = (await DB.getAllWords()).find(word => word.id === vocabularyId);
  const learnWord = (await DB.getAllLearnWords()).find(word => word.id === learnWordId);
  assert.equal(vocabulary.contextSentence, 'A form.');
  assert.equal(vocabulary.pos, 'noun');
  assert.equal(learnWord.interval, 6);
  assert.equal(learnWord.state, 'review');
  assert.deepEqual(learnWord.definitionSenses, fields.definitionSenses);
});
