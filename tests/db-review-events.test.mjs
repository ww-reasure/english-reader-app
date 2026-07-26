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
