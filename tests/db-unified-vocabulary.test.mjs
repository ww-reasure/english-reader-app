import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { indexedDB } from 'fake-indexeddb';
import {
  LIBRARY_SOURCE_VERSION,
  createLibrarySources
} from '../src/vocabulary-library.mjs';

let databaseSequence = 0;

async function loadDatabaseModule(moduleId) {
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
  return import(`data:text/javascript;base64,${Buffer.from(adapted).toString('base64')}#${moduleId}`);
}

async function createDatabase() {
  globalThis.indexedDB = indexedDB;
  const moduleId = databaseSequence++;
  const module = await loadDatabaseModule(moduleId);
  module.DB.DB_NAME = `EnglishReaderUnifiedVocabulary-${process.pid}-${moduleId}`;
  return module;
}

test('getUnifiedVocabulary migrates saved matches and unmatched imports once', async () => {
  const { DB } = await createDatabase();

  const savedId = await DB.saveWord({ word: 'derive', translation: '获得', createdAt: 20 });
  const deriveId = await DB.saveLearnWord({ word: 'derive', interval: 30, reviewRevision: 4, createdAt: 10 });
  const retainId = await DB.saveLearnWord({ word: 'retain', interval: 7, reviewRevision: 2, createdAt: 15 });

  const first = await DB.getUnifiedVocabulary();
  const second = await DB.getUnifiedVocabulary();
  assert.equal(first.length, 2);
  assert.equal(second.length, 2);
  assert.equal((await DB.findLearnWordById(deriveId)).librarySources.reading.active, true);
  assert.equal((await DB.findLearnWordById(deriveId)).librarySources.import.active, false);
  assert.equal((await DB.findLearnWordById(retainId)).librarySources.import.active, true);
  assert.equal((await DB.findLearnWordById(deriveId)).interval, 30);
  assert.equal((await DB.findLearnWordById(deriveId)).reviewRevision, 4);
  assert.ok(savedId);
});

test('migration creates a canonical word when only vocabulary exists', async () => {
  const { DB } = await createDatabase();

  await DB.saveWord({ word: 'constraint', translation: '限制', phonetic: '/kənˈstreɪnt/' });
  const rows = await DB.getUnifiedVocabulary();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].word, 'constraint');
  assert.equal(rows[0].librarySources.reading.active, true);
});

async function seedDualSourceWord({ interval = 0, reviewRevision = 0 } = {}) {
  const { DB } = await createDatabase();
  await DB.saveWord({ word: 'derive', translation: '获得', createdAt: 10 });
  const id = await DB.saveLearnWord({
    word: 'derive',
    translation: '获得',
    interval,
    reviewRevision,
    librarySourceVersion: LIBRARY_SOURCE_VERSION,
    librarySources: createLibrarySources({ readingAt: 10, importAt: 20 }),
    libraryAddedAt: 10,
    archivedAt: null
  });
  return { DB, id };
}

async function seedReadingOnlyWord() {
  const { DB } = await createDatabase();
  await DB.saveWord({ word: 'derive', translation: '获得', createdAt: 10 });
  const id = await DB.saveLearnWord({
    word: 'derive',
    translation: '获得',
    interval: 0,
    reviewRevision: 0,
    librarySourceVersion: LIBRARY_SOURCE_VERSION,
    librarySources: createLibrarySources({ readingAt: 10 }),
    libraryAddedAt: 10,
    archivedAt: null
  });
  return { DB, id };
}

test('removing reading from a dual-source word preserves its SRS and import membership', async () => {
  const { DB, id } = await seedDualSourceWord({ interval: 30, reviewRevision: 8 });

  await DB.removeReadingVocabularySource(id, { occurredAt: 1000 });
  const word = await DB.findLearnWordById(id);
  assert.equal(word.librarySources.reading.active, false);
  assert.equal(word.librarySources.import.active, true);
  assert.equal(word.archivedAt, null);
  assert.equal(word.interval, 30);
  assert.equal(word.reviewRevision, 8);
  assert.equal((await DB.getAllWords()).length, 0);
});

test('removing the only reading source archives without deleting history', async () => {
  const { DB, id } = await seedReadingOnlyWord();

  await DB.addReviewEvent({ wordId: id, rating: 3, source: 'flashcard' });
  await DB.removeReadingVocabularySource(id, { occurredAt: 2000 });
  assert.equal((await DB.getAllLearnWords()).length, 0);
  assert.equal((await DB.getAllLearnWords({ includeArchived: true })).length, 1);
  assert.equal((await DB.findLearnWordById(id)).archivedAt, 2000);
  assert.equal((await DB.getReviewEventsForWord(id)).length, 1);
});

test('archiveLearnWords hides words without clearing schedule or review events', async () => {
  const { DB } = await createDatabase();

  const id = await DB.saveLearnWord({ word: 'retain', interval: 12, nextReview: 500, reviewRevision: 3 });
  await DB.addReviewEvent({ wordId: id, rating: 5, source: 'flashcard' });
  await DB.archiveLearnWords([id], { occurredAt: 3000 });
  assert.deepEqual(await DB.getAllLearnWords(), []);
  const archived = await DB.findLearnWordById(id);
  assert.equal(archived.interval, 12);
  assert.equal(archived.nextReview, 500);
  assert.equal(archived.reviewRevision, 3);
  assert.equal((await DB.getReviewEventsForWord(id)).length, 1);
});

test('saving an imported word activates reading source without a second canonical row', async () => {
  const { DB } = await createDatabase();

  const id = await DB.saveLearnWord({
    word: 'derive',
    interval: 20,
    reviewRevision: 6,
    librarySourceVersion: LIBRARY_SOURCE_VERSION,
    librarySources: createLibrarySources({ importAt: 10 }),
    libraryAddedAt: 10
  });
  const result = await DB.saveVocabularyWord({ word: 'Derive', translation: '获得', articleId: 4 }, { occurredAt: 50 });

  assert.equal(result.learnWordId, id);
  assert.equal(result.createdLearnWord, false);
  assert.equal((await DB.getAllLearnWords()).length, 1);
  const word = await DB.findLearnWordById(id);
  assert.equal(word.librarySources.reading.active, true);
  assert.equal(word.librarySources.import.active, true);
  assert.equal(word.interval, 20);
  assert.equal(word.reviewRevision, 6);
});

test('saving an archived word restores the same id', async () => {
  const { DB } = await createDatabase();

  const id = await DB.saveLearnWord({
    word: 'derive',
    translation: '获得',
    librarySourceVersion: LIBRARY_SOURCE_VERSION,
    librarySources: createLibrarySources(),
    libraryAddedAt: 10,
    archivedAt: 40
  });
  const result = await DB.saveVocabularyWord({ word: 'derive', translation: '获得' }, { occurredAt: 80 });

  assert.equal(result.learnWordId, id);
  assert.equal((await DB.findLearnWordById(id)).archivedAt, null);
});

test('same-day import restores an archived source without adding another review event', async () => {
  const { DB } = await createDatabase();

  const id = await DB.saveLearnWord({
    word: 'derive',
    translation: '获得',
    librarySourceVersion: LIBRARY_SOURCE_VERSION,
    librarySources: createLibrarySources({ importAt: 10 }),
    libraryAddedAt: 10,
    archivedAt: 40
  });
  await DB.applyWordImportSignal({ word: 'derive' }, { dayKey: '2026-08-24', occurredAt: 50, batchId: 'a' });
  await DB.archiveLearnWords([id], { occurredAt: 60 });
  const second = await DB.applyWordImportSignal({ word: 'derive' }, { dayKey: '2026-08-24', occurredAt: 70, batchId: 'b' });

  assert.equal(second.status, 'today_ignored');
  assert.equal((await DB.findLearnWordById(id)).archivedAt, null);
  assert.equal((await DB.getReviewEventsForWord(id)).filter(event => event.source === 'external-import').length, 1);
});

test('importing a reading-only word activates import source and keeps one id', async () => {
  const { DB } = await createDatabase();

  await DB.saveWord({ word: 'derive', translation: '获得', createdAt: 10 });
  const id = await DB.saveLearnWord({
    word: 'derive',
    translation: '获得',
    librarySourceVersion: LIBRARY_SOURCE_VERSION,
    librarySources: createLibrarySources({ readingAt: 10 }),
    libraryAddedAt: 10,
    archivedAt: null
  });
  await DB.applyWordImportSignal({ word: 'derive' }, { dayKey: '2026-08-24', occurredAt: 90, batchId: 'c' });

  const word = await DB.findLearnWordById(id);
  assert.equal(word.librarySources.reading.active, true);
  assert.equal(word.librarySources.import.active, true);
  assert.equal((await DB.getAllLearnWords()).length, 1);
});
