import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { indexedDB } from 'fake-indexeddb';
import { ActivityType, importWordDedupeKey } from '../src/learning-activity.mjs';

let databaseSequence = 0;

async function loadDatabaseModule(getStemFormSource = null) {
  const source = await readFile(new URL('../src/db.js', import.meta.url), 'utf8');
  const metadataUrl = new URL('../src/cloud-article-metadata.mjs', import.meta.url).href;
  const learningDayUrl = new URL('../src/learning-day.mjs', import.meta.url).href;
  const learningActivityUrl = new URL('../src/learning-activity.mjs', import.meta.url).href;
  const externalSchedulerUrl = new URL('../src/external-review-scheduler.mjs', import.meta.url).href;
  const recoverySchedulerUrl = new URL('../src/recovery-scheduler.mjs', import.meta.url).href;
  const vocabularyLibraryUrl = new URL('../src/vocabulary-library.mjs', import.meta.url).href;
  const adapted = source
    .replace(
      "import { getStemForm } from './helpers.js';",
      getStemFormSource || "const getStemForm = word => String(word || '').trim().toLowerCase();"
    )
    .replace("from './cloud-article-metadata.mjs'", `from '${metadataUrl}'`)
    .replace("from './learning-day.mjs'", `from '${learningDayUrl}'`)
    .replace("from './learning-activity.mjs'", `from '${learningActivityUrl}'`)
    .replace("from './external-review-scheduler.mjs'", `from '${externalSchedulerUrl}'`)
    .replace("from './recovery-scheduler.mjs'", `from '${recoverySchedulerUrl}'`)
    .replace("from './vocabulary-library.mjs'", `from '${vocabularyLibraryUrl}'`);
  return import(`data:text/javascript;base64,${Buffer.from(adapted).toString('base64')}`);
}

async function createDatabase(getStemFormSource = null) {
  globalThis.indexedDB = indexedDB;
  const module = await loadDatabaseModule(getStemFormSource);
  module.DB.DB_NAME = `EnglishReaderDiagnostics-${process.pid}-${databaseSequence++}`;
  return module;
}

test('diagnostic log storage is additive and does not affect learning data', async () => {
  const { DB } = await createDatabase();
  const wordId = await DB.saveLearnWord({ word: 'retain', interval: 4, state: 'review' });
  const now = Date.now();
  const events = [
    {
      id: 'diagnostic-1',
      schemaVersion: 1,
      occurredAt: now - 1_000,
      level: 'info',
      category: 'app',
      event: 'app.start'
    },
    {
      id: 'diagnostic-2',
      schemaVersion: 1,
      occurredAt: now,
      level: 'error',
      category: 'db',
      event: 'db.open.pending'
    }
  ];

  const appended = await DB.appendDiagnosticLogs(events);
  assert.equal(appended, 2);
  assert.deepEqual(await DB.listDiagnosticLogs({ from: now - 500, to: now + 500 }), [events[1]]);

  const stats = await DB.getDiagnosticLogStats();
  assert.equal(stats.count, 2);
  assert.ok(stats.bytes >= JSON.stringify(events[0]).length);
  assert.deepEqual(await DB.listDiagnosticLogs({ limit: 0 }), []);
  assert.equal((await DB.findLearnWordById(wordId)).word, 'retain');

  await DB.clearDiagnosticLogs();
  assert.deepEqual(await DB.listDiagnosticLogs(), []);
  assert.equal((await DB.findLearnWordById(wordId)).interval, 4);
});

test('existing databases gain the diagnostic store during an additive upgrade', async () => {
  globalThis.indexedDB = indexedDB;
  const name = `EnglishReaderDiagnosticsUpgrade-${process.pid}-${databaseSequence++}`;
  await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 19);
    request.onupgradeneeded = event => {
      const db = event.target.result;
      db.createObjectStore('learnWords', { keyPath: 'id', autoIncrement: true });
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });

  const { DB } = await createDatabase();
  DB.DB_NAME = name;
  const connection = await DB.open();
  assert.equal(connection.objectStoreNames.contains('learnWords'), true);
  assert.equal(connection.objectStoreNames.contains('diagnosticLogs'), true);
  connection.close();
});

test('batch import classification reuses one connection and one read-only transaction', async () => {
  const { DB } = await createDatabase();
  const originalOpen = indexedDB.open;
  let openCount = 0;
  indexedDB.open = function countedOpen(...args) {
    openCount += 1;
    return originalOpen.apply(this, args);
  };

  try {
    await DB.open();
    await DB.open();
    assert.equal(openCount, 1);

    await DB.saveLearnWord({ word: 'existing' });
    await DB.saveLearningActivity({
      id: 'import-word:2026-08-27:existing',
      type: ActivityType.WORD_IMPORT_DAILY,
      occurredAt: Date.now(),
      dayKey: '2026-08-27',
      sessionId: 'import:test',
      dedupeKey: importWordDedupeKey('2026-08-27', 'existing'),
      payload: { lemma: 'existing', status: 'external_review' }
    });

    const result = await DB.classifyWordImportCandidates(['existing', 'newword'], '2026-08-27');
    assert.equal(openCount, 1, '分类不应再次打开 IndexedDB');
    assert.equal(result.existingWords.has('existing'), true);
    assert.equal(result.existingWords.has('newword'), false);
    assert.equal(result.todayProcessedWords.has('existing'), true);
    assert.equal(result.todayProcessedWords.has('newword'), false);
  } finally {
    indexedDB.open = originalOpen;
  }
});

test('batch import classification preserves the original candidate when lookup uses a stem', async () => {
  const { DB } = await createDatabase(
    "const getStemForm = word => String(word || '').trim().toLowerCase() === 'running' ? 'run' : String(word || '').trim().toLowerCase();"
  );
  await DB.saveLearnWord({ word: 'run' });
  const result = await DB.classifyWordImportCandidates(['running'], '2026-08-27');
  assert.equal(result.existingWords.has('running'), true);
  assert.equal(result.existingWords.has('run'), false);
});
