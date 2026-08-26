import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { indexedDB } from 'fake-indexeddb';

let databaseSequence = 0;

async function loadFreshDb(label) {
  globalThis.indexedDB = indexedDB;
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
  const module = await import(`data:text/javascript;base64,${Buffer.from(adapted).toString('base64')}#${label}-${databaseSequence}`);
  module.DB.DB_NAME = `ExternalImport-${label}-${process.pid}-${databaseSequence++}`;
  return module.DB;
}

test('first old-word import updates schedule, event, and daily dedupe atomically', async () => {
  const db = await loadFreshDb('Existing');
  const now = 1_800_000_000_000;
  const wordId = await db.saveLearnWord({ word: 'constraint', interval: 30, nextReview: now - 1000, reviewRevision: 4 });

  const result = await db.applyWordImportSignal(
    { word: 'constraint' },
    { batchId: 'b1', dayKey: '2026-08-24', occurredAt: now }
  );

  assert.equal(result.status, 'external_review');
  assert.equal(result.scheduleChanged, true);
  assert.equal(result.wordId, wordId);
  assert.equal(result.lemma, 'constraint');
  const savedWord = await db.findLearnWordById(wordId);
  assert.equal(savedWord.nextReview, now + 7 * 86400000);
  assert.equal(savedWord.librarySources.import.active, true);
  assert.equal(savedWord.archivedAt, null);
  assert.equal((await db.getReviewEventsForWord(wordId)).at(-1).source, 'external-import');
  assert.ok(await db.getLearningActivityByDedupeKey('import-word:2026-08-24:constraint'));
});

test('same local day returns today_ignored without a second review event', async () => {
  const db = await loadFreshDb('Duplicate');
  const now = 1_800_000_000_000;
  const wordId = await db.saveLearnWord({ word: 'constraint', interval: 30, nextReview: now - 1000 });

  await db.applyWordImportSignal(
    { word: 'constraint' },
    { batchId: 'b1', dayKey: '2026-08-24', occurredAt: now }
  );
  const second = await db.applyWordImportSignal(
    { word: 'constraint' },
    { batchId: 'b2', dayKey: '2026-08-24', occurredAt: now + 1000 }
  );

  assert.equal(second.status, 'today_ignored');
  assert.equal((await db.getReviewEventsForWord(wordId)).length, 1);
});

test('new word is added once and cannot become an external review later that day', async () => {
  const db = await loadFreshDb('New');
  const context = { batchId: 'b1', dayKey: '2026-08-24', occurredAt: 1_800_000_000_000 };

  assert.equal((await db.applyWordImportSignal({ word: 'derive' }, context)).status, 'new');
  assert.equal((await db.applyWordImportSignal({ word: 'derive' }, { ...context, batchId: 'b2' })).status, 'today_ignored');
  const words = await db.getAllLearnWords();
  assert.equal(words.filter(item => item.word === 'derive').length, 1);
  assert.equal(words[0].librarySourceVersion, 1);
  assert.equal(words[0].librarySources.import.active, true);
  assert.equal(words[0].archivedAt, null);
});
