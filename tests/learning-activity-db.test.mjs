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
  const module = await import(`data:text/javascript;base64,${Buffer.from(adapted).toString('base64')}`);
  module.DB.DB_NAME = `LearningActivity-${label}-${process.pid}-${databaseSequence++}`;
  return module.DB;
}

test('v18 adds telemetry stores without changing existing learnWords', async () => {
  const db = await loadFreshDb('Migration');
  const opened = await db.open();
  assert.ok(opened.version >= 21);
  assert.equal(opened.objectStoreNames.contains('learningActivityEvents'), true);
  assert.equal(opened.objectStoreNames.contains('dailyLearningReports'), true);
  assert.equal(opened.transaction('learnWords').objectStore('learnWords').indexNames.contains('word'), true);
  opened.close();
});

test('activity dedupeKey is unique while ordinary events may omit it', async () => {
  const db = await loadFreshDb('Dedupe');
  await db.saveLearningActivity({ id: 'a', type: 'word_import_daily', occurredAt: 1, dayKey: '2026-08-24', dedupeKey: 'import-word:2026-08-24:word' });
  await assert.rejects(() => db.saveLearningActivity({ id: 'b', type: 'word_import_daily', occurredAt: 2, dayKey: '2026-08-24', dedupeKey: 'import-word:2026-08-24:word' }));
  await db.saveLearningActivity({ id: 'c', type: 'reading_word_lookup', occurredAt: 3, dayKey: '2026-08-24' });
  await db.saveLearningActivity({ id: 'd', type: 'reading_word_lookup', occurredAt: 4, dayKey: '2026-08-24' });

  assert.equal((await db.getLearningActivityByDedupeKey('import-word:2026-08-24:word')).id, 'a');
  assert.deepEqual((await db.listLearningActivities({ from: 1, to: 5 })).map(item => item.id), ['a', 'c', 'd']);
  assert.deepEqual((await db.listLearningActivities({ types: ['reading_word_lookup'] })).map(item => item.id), ['c', 'd']);
});

test('daily reports are stored newest-first and pruning is telemetry-only', async () => {
  const db = await loadFreshDb('Reports');
  await db.saveLearnWord({ word: 'preserve' });
  await db.saveDailyLearningReport({ dateKey: '2026-08-23', updatedAt: 20, expiresAt: 30, facts: { value: 1 } });
  await db.saveDailyLearningReport({ dateKey: '2026-08-24', updatedAt: 30, expiresAt: 40, facts: { value: 2 } });
  await db.saveLearningActivity({ id: 'old-activity', type: 'reading_word_lookup', occurredAt: 10, dayKey: '2026-08-20' });
  await db.saveLearningActivity({ id: 'new-activity', type: 'reading_word_lookup', occurredAt: 30, dayKey: '2026-08-24' });

  assert.deepEqual((await db.listDailyLearningReports({ limit: 30 })).map(item => item.dateKey), ['2026-08-24', '2026-08-23']);
  assert.deepEqual(await db.getDailyLearningReport('2026-08-24'), { dateKey: '2026-08-24', updatedAt: 30, expiresAt: 40, facts: { value: 2 } });
  assert.deepEqual(await db.deleteExpiredLearningTelemetry({ reportBefore: 30, activityBefore: 30 }), { reportsDeleted: 1, activitiesDeleted: 1 });
  assert.equal((await db.getDailyLearningReport('2026-08-23')), null);
  assert.equal((await db.getDailyLearningReport('2026-08-24')).facts.value, 2);
  assert.equal((await db.listLearningActivities({ from: 0, to: 31 })).map(item => item.id).join(','), 'new-activity');
  assert.equal((await db.findLearnWord('preserve')).word, 'preserve');
});
