import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { buildExamPackFromMarkdown } from '../src/exam/pack.mjs';
import { installExamPack } from '../src/exam/pack-installer.mjs';
import { createAttempt } from '../src/exam/attempt-state.mjs';
import { ExamRepository } from '../src/exam/repository.mjs';
import { ExamStateRepository } from '../src/exam/state-repository.mjs';

const fixtureUrl = new URL('./fixtures/exam-md-minimal.md', import.meta.url);
let sequence = 0;

async function loadDatabaseModule() {
  const source = await readFile(new URL('../src/db.js', import.meta.url), 'utf8');
  const metadataUrl = new URL('../src/cloud-article-metadata.mjs', import.meta.url).href;
  const learningDayUrl = new URL('../src/learning-day.mjs', import.meta.url).href;
  const learningActivityUrl = new URL('../src/learning-activity.mjs', import.meta.url).href;
  const adapted = source
    .replace(
      "import { getStemForm } from './helpers.js';",
      "const getStemForm = word => String(word || '').trim().toLowerCase();"
    )
    .replace("from './cloud-article-metadata.mjs'", `from '${metadataUrl}'`)
    .replace("from './learning-day.mjs'", `from '${learningDayUrl}'`)
    .replace("from './learning-activity.mjs'", `from '${learningActivityUrl}'`);
  return import(`data:text/javascript;base64,${Buffer.from(adapted).toString('base64')}`);
}

test('state repository isolates attempts, wrong states and bookmarks by examId', async () => {
  globalThis.indexedDB = indexedDB;
  const module = await loadDatabaseModule();
  module.DB.DB_NAME = `EnglishReaderExamState-${process.pid}-${sequence++}`;
  const db = await module.DB.open();
  const openDb = () => Promise.resolve(db);
  const contentRepository = new ExamRepository({ openDb });
  const stateRepository = new ExamStateRepository({ openDb });
  const markdown = await readFile(fixtureUrl, 'utf8');
  await installExamPack(openDb, await buildExamPackFromMarkdown(markdown, { generatedAt: '2026-08-07T00:00:00.000Z', displayName: 'Synthetic' }));

  const attempt = createAttempt({
    examId: 'kaoyan_en1',
    bankId: 'synthetic_kaoyan_bank',
    packageId: 'synthetic.kaoyan.en1',
    paperKey: 'synthetic_kaoyan_2026',
    unitKey: 'synthetic_kaoyan_2026_text_1',
    questionKeys: ['synthetic_kaoyan_2026_q21'],
    optionOrders: { synthetic_kaoyan_2026_q21: ['A', 'B', 'C', 'D'] },
    packVersion: '1.0.0',
    contentHashSnapshot: 'sha256:abc'
  });
  await stateRepository.saveAttempt({ examId: 'kaoyan_en1', attempt });

  assert.equal((await stateRepository.listAttempts({ examId: 'cet4' })).length, 0);
  assert.equal((await stateRepository.getAttempt({ examId: 'cet4', attemptId: attempt.attemptId })), null);

  await stateRepository.saveWrongState({
    examId: 'kaoyan_en1',
    wrongState: {
      key: 'synthetic_kaoyan_bank:synthetic_kaoyan_2026_q21',
      examId: 'kaoyan_en1',
      bankId: 'synthetic_kaoyan_bank',
      packageId: 'synthetic.kaoyan.en1',
      questionKey: 'synthetic_kaoyan_2026_q21',
      status: 'active',
      updatedAt: Date.now(),
      createdAt: Date.now()
    }
  });
  await stateRepository.saveBookmark({
    examId: 'kaoyan_en1',
    bookmark: {
      key: 'synthetic_kaoyan_bank:synthetic_kaoyan_2026_q21',
      examId: 'kaoyan_en1',
      bankId: 'synthetic_kaoyan_bank',
      packageId: 'synthetic.kaoyan.en1',
      questionKey: 'synthetic_kaoyan_2026_q21',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  });

  assert.equal((await stateRepository.listWrongStates({ examId: 'cet4' })).length, 0);
  assert.equal((await stateRepository.getWrongState({ examId: 'cet4', bankId: 'synthetic_kaoyan_bank', questionKey: 'synthetic_kaoyan_2026_q21' })), null);
  assert.equal((await stateRepository.listBookmarks({ examId: 'cet4' })).length, 0);
  assert.equal((await stateRepository.getBookmark({ examId: 'kaoyan_en1', bankId: 'synthetic_kaoyan_bank', questionKey: 'synthetic_kaoyan_2026_q21' })).questionKey, 'synthetic_kaoyan_2026_q21');

  await assert.rejects(stateRepository.saveAttempt({ examId: 'cet4', attempt }), /examId 不一致/);
  db.close();
});

test('submission writes attempt, responses, and tracked wrong states in one transaction', async () => {
  const source = await readFile(new URL('../src/exam/state-repository.mjs', import.meta.url), 'utf8');
  assert.match(source, /runStoreTransaction\(this\.openDb, \['examAttempts', 'examResponses', 'examWrongStates'\]/);
  assert.match(source, /transitionObjectiveReview/);
});

test('repository lists only due objective and translation states through scheduling indexes', async () => {
  globalThis.indexedDB = indexedDB;
  globalThis.IDBKeyRange = IDBKeyRange;
  const module = await loadDatabaseModule();
  module.DB.DB_NAME = `EnglishReaderExamDue-${process.pid}-${sequence++}`;
  const db = await module.DB.open();
  const openDb = () => Promise.resolve(db);
  const repository = new ExamStateRepository({ openDb });
  const now = 1_700_000_000_000;
  await repository.saveWrongState({
    examId: 'kaoyan_en1',
    wrongState: {
      key: 'bank:q-due', examId: 'kaoyan_en1', bankId: 'bank', questionKey: 'q-due',
      status: 'active', nextDueAt: now - 1, updatedAt: now - 1, createdAt: now - 1
    }
  });
  await repository.saveWrongState({
    examId: 'kaoyan_en1',
    wrongState: {
      key: 'bank:q-later', examId: 'kaoyan_en1', bankId: 'bank', questionKey: 'q-later',
      status: 'active', nextDueAt: now + 1, updatedAt: now + 1, createdAt: now + 1
    }
  });
  await repository.saveTranslationReview({
    examId: 'kaoyan_en1',
    review: {
      key: 'bank:t-due', examId: 'kaoyan_en1', bankId: 'bank', questionKey: 't-due',
      status: 'needs_review', nextDueAt: now, createdAt: now, updatedAt: now
    }
  });
  const dueWrong = await repository.listDueWrongStates({ examId: 'kaoyan_en1', now });
  const dueTranslations = await repository.listDueTranslationReviews({ examId: 'kaoyan_en1', now });
  assert.deepEqual(dueWrong.map(row => row.questionKey), ['q-due']);
  assert.deepEqual(dueTranslations.map(row => row.questionKey), ['t-due']);
  db.close();
});
