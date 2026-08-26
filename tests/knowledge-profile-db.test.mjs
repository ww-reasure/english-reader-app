import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { indexedDB } from 'fake-indexeddb';

import { createKnowledgeProfileRepository } from '../src/knowledge-profile.mjs';

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
  module.DB.DB_NAME = `EnglishReaderKnowledgeProfile-${process.pid}-${databaseSequence++}`;
  return module.DB;
}

function openLegacyDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 7);
    request.onupgradeneeded = () => {
      const db = request.result;
      const words = db.createObjectStore('learnWords', { keyPath: 'id', autoIncrement: true });
      words.createIndex('word', 'word', { unique: true });
      db.createObjectStore('articles', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('vocabulary', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('readingStats', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('reviewEvents', { keyPath: 'id', autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openV8KnowledgeDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 8);
    request.onupgradeneeded = () => {
      const db = request.result;
      const events = db.createObjectStore('knowledgeEvidence', { keyPath: 'id', autoIncrement: true });
      events.createIndex('lemma', 'lemma');
      events.add({ lemma: 'old', band: 'ngsl-1', kind: 'diagnostic', occurredAt: 1 });
      db.createObjectStore('knowledgeWords', { keyPath: 'lemma' });
      db.createObjectStore('knowledgeBands', { keyPath: 'band' });
      db.createObjectStore('knowledgeProfileMeta', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openV10ReadingDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 10);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('articles', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('vocabulary', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('learnWords', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('reviewEvents', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('readingStats', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('knowledgeWords', { keyPath: 'lemma' });
      db.createObjectStore('knowledgeBands', { keyPath: 'band' });
      const evidence = db.createObjectStore('knowledgeEvidence', { keyPath: 'id', autoIncrement: true });
      evidence.createIndex('lemma', 'lemma');
      evidence.createIndex('band', 'band');
      evidence.createIndex('occurredAt', 'occurredAt');
      evidence.createIndex('articleId', 'articleId');
      evidence.createIndex('questionId', 'questionId');
      evidence.createIndex('calibrationKey', 'calibrationKey', { unique: true });
      db.createObjectStore('knowledgeProfileMeta', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

test('knowledge profile storage is additive and persists a word, band, and immutable evidence together', async () => {
  const DB = await createDatabase();
  const legacyWordId = await DB.saveLearnWord({ word: 'Retain' });

  await DB.saveKnowledgeProfileMeta({
    key: 'knowledge-profile-schema',
    schemaVersion: 1,
    legacyLearnWordsImported: false
  });
  await DB.saveKnowledgeProfileUpdate({
    word: { lemma: 'retain', status: 'provisional', successCount: 1 },
    band: { band: 'ngsl-1', successCount: 1, failureCount: 0 },
    evidence: { lemma: 'retain', band: 'ngsl-1', kind: 'diagnostic', occurredAt: 1 }
  });

  assert.equal((await DB.findLearnWord('retain')).id, legacyWordId);
  assert.equal((await DB.getKnowledgeProfileMeta('knowledge-profile-schema')).legacyLearnWordsImported, false);
  assert.equal((await DB.getKnowledgeWord('retain')).status, 'provisional');
  assert.equal((await DB.getKnowledgeBand('ngsl-1')).successCount, 1);
  assert.deepEqual(await DB.getKnowledgeEvidenceForWord('retain'), [
    { id: 1, lemma: 'retain', band: 'ngsl-1', kind: 'diagnostic', occurredAt: 1 }
  ]);
});

test('v10 persists independent success and failure band statistics without replacing total evidence', async () => {
  const DB = await createDatabase();
  const FIRST = Date.parse('2026-07-26T08:00:00.000Z');
  const profile = createKnowledgeProfileRepository(DB, { now: () => FIRST });

  await profile.recordEvidence({
    word: 'retain', band: 'ngsl-1', kind: 'recall', correct: true,
    source: 'flashcard-review', attemptId: 'one', contextId: 'card-1', occurredAt: FIRST
  });
  await profile.recordEvidence({
    word: 'retain', band: 'ngsl-1', kind: 'review', correct: false,
    source: 'flashcard-review', attemptId: 'two', contextId: 'card-1', occurredAt: FIRST + 60_000
  });
  await profile.recordEvidence({
    word: 'retain', band: 'ngsl-1', kind: 'review', correct: false,
    source: 'flashcard-review', attemptId: 'three', contextId: 'card-2', occurredAt: FIRST + 120_000
  });

  const storedBand = await DB.getKnowledgeBand('ngsl-1');
  assert.equal(storedBand.successCount, 1);
  assert.equal(storedBand.failureCount, 2);
  assert.equal(storedBand.independentSuccessCount, 1);
  assert.equal(storedBand.independentFailureCount, 1);
  assert.equal(storedBand.independentDirectEvidenceCount, 2);
});

test('database rejects a duplicate calibration key before it can alter its word or band snapshot', async () => {
  const DB = await createDatabase();
  const first = {
    word: { lemma: 'repeat', status: 'provisional', successCount: 1 },
    band: { band: 'ngsl-1', successCount: 1, failureCount: 0 },
    evidence: {
      lemma: 'repeat', band: 'ngsl-1', kind: 'diagnostic',
      calibrationKey: 'calibration-v2:0:repeat', occurredAt: 1
    }
  };
  await DB.saveKnowledgeProfileUpdate(first);

  await assert.rejects(
    DB.saveKnowledgeProfileUpdate({
      word: { lemma: 'repeat', status: 'established', successCount: 2 },
      band: { band: 'ngsl-1', successCount: 2, failureCount: 0 },
      evidence: {
        lemma: 'repeat', band: 'ngsl-1', kind: 'diagnostic',
        calibrationKey: 'calibration-v2:0:repeat', occurredAt: 2
      }
    }),
    error => error?.name === 'ConstraintError'
  );

  assert.equal((await DB.getKnowledgeWord('repeat')).successCount, 1);
  assert.equal((await DB.getKnowledgeBand('ngsl-1')).successCount, 1);
  assert.equal((await DB.getKnowledgeEvidenceForWord('repeat')).length, 1);
  assert.equal((await DB.getKnowledgeEvidenceByCalibrationKey('calibration-v2:0:repeat')).occurredAt, 1);
});

test('v7 migration adds knowledge stores without converting or deleting legacy study cards', async () => {
  globalThis.indexedDB = indexedDB;
  const module = await loadDatabaseModule();
  const name = `EnglishReaderKnowledgeLegacy-${process.pid}-${databaseSequence++}`;
  const legacy = await openLegacyDatabase(name);
  const transaction = legacy.transaction('learnWords', 'readwrite');
  transaction.objectStore('learnWords').add({ word: 'legacy' });
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  legacy.close();

  module.DB.DB_NAME = name;
  const upgraded = await module.DB.open();
  assert.equal(upgraded.version, 19);
  assert.equal(upgraded.objectStoreNames.contains('knowledgeWords'), true);
  assert.equal(upgraded.objectStoreNames.contains('knowledgeEvidence'), true);
  upgraded.close();

  const legacyWord = await module.DB.findLearnWord('legacy');
  assert.equal(legacyWord.word, 'legacy');
  assert.equal(await module.DB.getKnowledgeWord('legacy'), null);
});

test('v11 migration resets only reading history and reading-calibration progress', async () => {
  globalThis.indexedDB = indexedDB;
  const module = await loadDatabaseModule();
  const name = `EnglishReaderReadingReset-${process.pid}-${databaseSequence++}`;
  const legacy = await openV10ReadingDatabase(name);
  const write = legacy.transaction(['readingStats', 'knowledgeProfileMeta', 'knowledgeWords'], 'readwrite');
  write.objectStore('readingStats').add({ articleId: 42, activeSeconds: 12, completed: true });
  write.objectStore('knowledgeProfileMeta').put({ key: 'knowledge-profile-qualified-readings', articleIds: ['42'] });
  write.objectStore('knowledgeProfileMeta').put({ key: 'knowledge-profile-reading-feedback', value: 'fitting' });
  write.objectStore('knowledgeProfileMeta').put({ key: 'knowledge-profile-schema', schemaVersion: 3 });
  write.objectStore('knowledgeWords').put({ lemma: 'retain', status: 'stable' });
  await new Promise((resolve, reject) => {
    write.oncomplete = resolve;
    write.onerror = () => reject(write.error);
  });
  legacy.close();

  module.DB.DB_NAME = name;
  const upgraded = await module.DB.open();
  assert.equal(upgraded.version, 19);
  upgraded.close();

  assert.deepEqual(await module.DB.getAllReadingStats(), []);
  assert.equal(await module.DB.getKnowledgeProfileMeta('knowledge-profile-qualified-readings'), null);
  assert.equal(await module.DB.getKnowledgeProfileMeta('knowledge-profile-reading-feedback'), null);
  assert.deepEqual(await module.DB.getKnowledgeProfileMeta('knowledge-profile-schema'), {
    key: 'knowledge-profile-schema', schemaVersion: 3
  });
  assert.deepEqual(await module.DB.getKnowledgeWord('retain'), { lemma: 'retain', status: 'stable' });
});

test('v8 knowledge evidence gains the calibration index during the v10 additive independent-evidence migration', async () => {
  globalThis.indexedDB = indexedDB;
  const module = await loadDatabaseModule();
  const name = `EnglishReaderKnowledgeV8-${process.pid}-${databaseSequence++}`;
  const legacy = await openV8KnowledgeDatabase(name);
  legacy.close();

  module.DB.DB_NAME = name;
  const upgraded = await module.DB.open();
  assert.equal(upgraded.version, 19);
  assert.equal(upgraded.transaction('knowledgeEvidence').objectStore('knowledgeEvidence').indexNames.contains('calibrationKey'), true);
  upgraded.close();

  assert.equal((await module.DB.getKnowledgeEvidenceForWord('old')).length, 1);
  await module.DB.saveKnowledgeProfileUpdate({
    word: { lemma: 'new', status: 'provisional', successCount: 1 },
    band: { band: 'ngsl-1', successCount: 1, failureCount: 0 },
    evidence: {
      lemma: 'new', band: 'ngsl-1', kind: 'diagnostic',
      calibrationKey: 'calibration-v2:0:new', occurredAt: 2
    }
  });
  assert.equal((await module.DB.getKnowledgeEvidenceByCalibrationKey('calibration-v2:0:new')).lemma, 'new');
});
