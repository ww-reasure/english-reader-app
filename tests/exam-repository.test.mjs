import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { indexedDB } from 'fake-indexeddb';
import { buildExamPackFromMarkdown } from '../src/exam/pack.mjs';
import { installExamPack } from '../src/exam/pack-installer.mjs';
import { ExamRepository } from '../src/exam/repository.mjs';

const fixtureUrl = new URL('./fixtures/exam-md-minimal.md', import.meta.url);
const generatedAt = '2026-08-07T00:00:00.000Z';
let sequence = 0;

async function loadDatabaseModule() {
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
      "const getStemForm = word => String(word || '').trim().toLowerCase();"
    )
    .replace("from './cloud-article-metadata.mjs'", `from '${metadataUrl}'`)
    .replace("from './learning-day.mjs'", `from '${learningDayUrl}'`)
    .replace("from './learning-activity.mjs'", `from '${learningActivityUrl}'`)
    .replace("from './external-review-scheduler.mjs'", `from '${externalSchedulerUrl}'`)
    .replace("from './recovery-scheduler.mjs'", `from '${recoverySchedulerUrl}'`)
    .replace("from './vocabulary-library.mjs'", `from '${vocabularyLibraryUrl}'`);
  return import(`data:text/javascript;base64,${Buffer.from(adapted).toString('base64')}`);
}

test('repository requires examId and isolates content by exam', async () => {
  globalThis.indexedDB = indexedDB;
  const module = await loadDatabaseModule();
  module.DB.DB_NAME = `EnglishReaderExamRepository-${process.pid}-${sequence++}`;
  const db = await module.DB.open();
  const openDb = () => Promise.resolve(db);
  const repository = new ExamRepository({ openDb });
  const markdown = await readFile(fixtureUrl, 'utf8');
  await installExamPack(openDb, await buildExamPackFromMarkdown(markdown, { generatedAt, displayName: 'Synthetic' }));

  assert.equal((await repository.listPapers({ examId: 'kaoyan_en1' })).length, 1);
  assert.equal((await repository.listPapers({ examId: 'cet4' })).length, 0);
  assert.equal((await repository.listUnits({ examId: 'cet4' })).length, 0);
  assert.equal((await repository.listQuestions({ examId: 'cet4' })).length, 0);
  assert.equal(
    await repository.getQuestion({
      examId: 'cet4',
      bankId: 'synthetic_kaoyan_bank',
      questionKey: 'synthetic_kaoyan_2026_q21'
    }),
    null
  );

  const fullPaper = await repository.getFullPaper({
    examId: 'kaoyan_en1',
    bankId: 'synthetic_kaoyan_bank',
    paperKey: 'synthetic_kaoyan_2026'
  });
  assert.equal(fullPaper.units.length, 1);
  assert.equal(fullPaper.units[0].questions.length, 2);
  assert.equal(fullPaper.units[0].questions[0].answer, 'B');

  await assert.rejects(repository.listPapers({}), /examId/);
  await assert.rejects(
    repository.getPaper({ examId: 'kaoyan_en1', bankId: null, paperKey: 'x' }),
    /bankId/
  );

  db.close();
});
