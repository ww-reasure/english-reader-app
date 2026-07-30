import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { indexedDB } from 'fake-indexeddb';

let databaseSequence = 0;

async function loadDatabaseModule() {
  const source = await readFile(new URL('../src/db.js', import.meta.url), 'utf8');
  const metadataUrl = new URL('../src/cloud-article-metadata.mjs', import.meta.url).href;
  const adapted = source
    .replace(
      "import { getStemForm } from './helpers.js';",
      "const getStemForm = word => String(word || '').trim().toLowerCase();"
    )
    .replace("from './cloud-article-metadata.mjs'", `from '${metadataUrl}'`);
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

test('review revisions reject a stale score from another review mode without duplicating events', async () => {
  const { DB } = await createDatabase();
  const wordId = await DB.saveLearnWord({ word: 'shared', reviewRevision: 0 });

  const updated = await DB.recordLearnWordReview(wordId, {
    state: 'learning', interval: 1, nextReview: 1000
  }, {
    rating: 5,
    source: 'context-review',
    expectedRevision: 0,
    contextResult: 'known'
  });
  assert.equal(updated.reviewRevision, 1);

  await assert.rejects(DB.recordLearnWordReview(wordId, {
    state: 'relearning', interval: 0, nextReview: 500
  }, {
    rating: 1,
    source: 'flashcard',
    expectedRevision: 0
  }), /已在另一种复习方式中更新/);

  assert.equal((await DB.getReviewEventsForWord(wordId)).length, 1);
  assert.equal((await DB.findLearnWordById(wordId)).reviewRevision, 1);
});

test('persists a versioned context sentence bank and resumable session without changing learning words', async () => {
  const { DB } = await createDatabase();
  const wordId = await DB.saveLearnWord({ word: 'retain', interval: 3 });
  await DB.saveContextReviewSentences([{
    key: 'v1:cet4:retain:one',
    wordId,
    lemma: 'retain',
    sentence: 'Good notes help students retain the most important ideas.',
    targetTrack: 'cet4',
    savedAt: 100,
    lastUsedAt: 100
  }]);
  await DB.saveContextReviewSession({ id: 'session-1', currentIndex: 2, updatedAt: 200 });

  assert.equal((await DB.getContextReviewSentencesForWord(wordId))[0].lemma, 'retain');
  assert.equal((await DB.getContextReviewSession('session-1')).currentIndex, 2);
  assert.equal((await DB.findLearnWordById(wordId)).interval, 3);

  await DB.deleteContextReviewSession('session-1');
  assert.equal(await DB.getContextReviewSession('session-1'), null);
});
