import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { indexedDB } from 'fake-indexeddb';
import { buildExamPackFromMarkdown, createExamPack } from '../src/exam/pack.mjs';
import { installExamPack } from '../src/exam/pack-installer.mjs';
import { parseExamMarkdown } from '../src/exam/parser.mjs';
import { ExamRepository } from '../src/exam/repository.mjs';
import { getExamPackInstallOptions } from '../src/exam/pack-install-policy.mjs';

const fixtureUrl = new URL('./fixtures/exam-md-minimal.md', import.meta.url);
const generatedAt = '2026-08-07T00:00:00.000Z';
let sequence = 0;

function getAll(db, storeName) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openCustomV14(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 14);
    request.onupgradeneeded = () => {
      const db = request.result;
      const packMeta = db.createObjectStore('examPackMeta', { keyPath: 'packageId' });
      packMeta.createIndex('examId', 'examId');
      packMeta.createIndex('bankId', 'bankId');
      const banks = db.createObjectStore('examBanks', { keyPath: 'bankId' });
      banks.createIndex('examId', 'examId');
      const papers = db.createObjectStore('examPapers', { keyPath: 'contentId' });
      papers.createIndex('examId', 'examId');
      papers.createIndex('bankId', 'bankId');
      papers.createIndex('packageId', 'packageId');
      papers.createIndex('paperKey', 'paperKey');
      const units = db.createObjectStore('examUnits', { keyPath: 'contentId' });
      units.createIndex('examId', 'examId');
      units.createIndex('bankId', 'bankId');
      units.createIndex('packageId', 'packageId');
      units.createIndex('paperKey', 'paperKey');
      units.createIndex('unitKey', 'unitKey');
      const questions = db.createObjectStore('examQuestions', { keyPath: 'contentId' });
      questions.createIndex('examId', 'examId');
      questions.createIndex('bankId', 'bankId');
      questions.createIndex('packageId', 'packageId');
      questions.createIndex('paperKey', 'paperKey');
      questions.createIndex('unitKey', 'unitKey');
      questions.createIndex('questionKey', 'questionKey');
      questions.createIndex('questionHashUnique', 'contentHash', { unique: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

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

test('installs idempotently and upgrades with stable record keys', async () => {
  globalThis.indexedDB = indexedDB;
  const module = await loadDatabaseModule();
  module.DB.DB_NAME = `EnglishReaderExamInstaller-${process.pid}-${sequence++}`;
  const db = await module.DB.open();
  const openDb = () => Promise.resolve(db);
  const repository = new ExamRepository({ openDb });
  const markdown = await readFile(fixtureUrl, 'utf8');
  const pack = await buildExamPackFromMarkdown(markdown, { generatedAt, displayName: 'Synthetic' });

  const installed = await installExamPack(openDb, pack);
  assert.equal(installed.status, 'installed');
  assert.equal(installed.packageId, 'synthetic.kaoyan.en1');
  assert.equal((await repository.listPapers({ examId: 'kaoyan_en1' })).length, 1);
  assert.equal((await repository.listUnits({ examId: 'kaoyan_en1' })).length, 1);
  assert.equal((await repository.listQuestions({ examId: 'kaoyan_en1' })).length, 2);

  const unchanged = await installExamPack(openDb, pack);
  assert.equal(unchanged.status, 'unchanged');
  assert.equal((await repository.listQuestions({ examId: 'kaoyan_en1' })).length, 2);

  const paper = structuredClone(parseExamMarkdown(markdown));
  paper.units[0].questions[0].explanation = 'Upgraded explanation';
  const upgradedPack = await createExamPack({
    meta: {
      packageId: 'synthetic.kaoyan.en1',
      packageVersion: '1.1.0',
      examId: 'kaoyan_en1',
      bankId: 'synthetic_kaoyan_bank',
      displayName: 'Synthetic'
    },
    papers: [paper],
    generatedAt
  });
  const upgraded = await installExamPack(openDb, upgradedPack);
  assert.equal(upgraded.status, 'upgraded');

  const question = await repository.getQuestion({
    examId: 'kaoyan_en1',
    bankId: 'synthetic_kaoyan_bank',
    questionKey: 'synthetic_kaoyan_2026_q21'
  });
  assert.equal(question.contentId, 'synthetic_kaoyan_bank:synthetic_kaoyan_2026_q21');
  assert.equal(question.questionKey, 'synthetic_kaoyan_2026_q21');
  assert.equal(question.packageVersion, '1.1.0');
  assert.equal((await repository.listQuestions({ examId: 'kaoyan_en1' })).length, 2);

  db.close();
});

test('failed pack upgrade rolls back content and pack metadata atomically', async () => {
  globalThis.indexedDB = indexedDB;
  const name = `EnglishReaderExamAtomic-${process.pid}-${sequence++}`;
  const db = await openCustomV14(name);
  const openDb = () => Promise.resolve(db);
  const repository = new ExamRepository({ openDb });
  const markdown = await readFile(fixtureUrl, 'utf8');
  const original = await buildExamPackFromMarkdown(markdown, { generatedAt, displayName: 'Synthetic' });
  await installExamPack(openDb, original);

  const paper = structuredClone(parseExamMarkdown(markdown));
  paper.units[0].questions.push(structuredClone(paper.units[0].questions[0]));
  paper.units[0].questions[2].questionKey = 'synthetic_kaoyan_2026_q23';
  const failingPack = await createExamPack({
    meta: {
      packageId: 'synthetic.kaoyan.en1',
      packageVersion: '1.1.0',
      examId: 'kaoyan_en1',
      bankId: 'synthetic_kaoyan_bank',
      displayName: 'Synthetic'
    },
    papers: [paper],
    generatedAt
  });

  await assert.rejects(installExamPack(openDb, failingPack));
  const meta = await repository.getPackMeta({ examId: 'kaoyan_en1', packageId: 'synthetic.kaoyan.en1' });
  assert.equal(meta.packageVersion, '1.0.0');
  assert.equal(
    await repository.getQuestion({
      examId: 'kaoyan_en1',
      bankId: 'synthetic_kaoyan_bank',
      questionKey: 'synthetic_kaoyan_2026_q23'
    }),
    null
  );
  assert.equal((await repository.listQuestions({ examId: 'kaoyan_en1' })).length, 2);

  db.close();
});

test('rejects reusing the same bankId for a different exam', async () => {
  globalThis.indexedDB = indexedDB;
  const module = await loadDatabaseModule();
  module.DB.DB_NAME = `EnglishReaderExamBankId-${process.pid}-${sequence++}`;
  const db = await module.DB.open();
  const openDb = () => Promise.resolve(db);
  const markdown = await readFile(fixtureUrl, 'utf8');
  await installExamPack(openDb, await buildExamPackFromMarkdown(markdown, { generatedAt, displayName: 'Synthetic' }));

  const otherExamMarkdown = markdown
    .replace('"examId": "kaoyan_en1"', '"examId": "cet4"')
    .replace('"packageId": "synthetic.kaoyan.en1"', '"packageId": "synthetic.cet4"');
  const otherPack = await buildExamPackFromMarkdown(otherExamMarkdown, { generatedAt, displayName: 'Synthetic CET4' });
  await assert.rejects(installExamPack(openDb, otherPack), /bankId 必须全局唯一/);
  db.close();
});

test('a known contaminated pack hash can reset only that bank test state during upgrade', async () => {
  globalThis.indexedDB = indexedDB;
  const module = await loadDatabaseModule();
  module.DB.DB_NAME = `EnglishReaderExamStateReset-${process.pid}-${sequence++}`;
  const db = await module.DB.open();
  const openDb = () => Promise.resolve(db);
  const markdown = await readFile(fixtureUrl, 'utf8');
  const original = await buildExamPackFromMarkdown(markdown, { generatedAt, displayName: 'Synthetic' });
  await installExamPack(openDb, original);

  const affected = {
    examAttempts: { attemptId: 'affected-attempt', examId: 'kaoyan_en1', bankId: 'synthetic_kaoyan_bank', packageId: original.manifest.packageId },
    examResponses: { responseId: 'affected-response', attemptId: 'affected-attempt', examId: 'kaoyan_en1', bankId: 'synthetic_kaoyan_bank', packageId: original.manifest.packageId },
    examWrongStates: { key: 'synthetic_kaoyan_bank:q21', examId: 'kaoyan_en1', bankId: 'synthetic_kaoyan_bank', questionKey: 'q21' },
    examBookmarks: { key: 'synthetic_kaoyan_bank:q21', examId: 'kaoyan_en1', bankId: 'synthetic_kaoyan_bank', questionKey: 'q21' },
    examTranslationReviews: { key: 'synthetic_kaoyan_bank:q46', examId: 'kaoyan_en1', bankId: 'synthetic_kaoyan_bank', questionKey: 'q46' }
  };
  const unrelated = {
    examAttempts: { attemptId: 'unrelated-attempt', examId: 'kaoyan_en1', bankId: 'other_bank', packageId: 'other.package' },
    examResponses: { responseId: 'unrelated-response', attemptId: 'unrelated-attempt', examId: 'kaoyan_en1', bankId: 'other_bank', packageId: 'other.package' },
    examWrongStates: { key: 'other_bank:q21', examId: 'kaoyan_en1', bankId: 'other_bank', questionKey: 'q21' },
    examBookmarks: { key: 'other_bank:q21', examId: 'kaoyan_en1', bankId: 'other_bank', questionKey: 'q21' },
    examTranslationReviews: { key: 'other_bank:q46', examId: 'kaoyan_en1', bankId: 'other_bank', questionKey: 'q46' }
  };
  const stateStores = Object.keys(affected);
  const tx = db.transaction(stateStores, 'readwrite');
  for (const storeName of stateStores) {
    tx.objectStore(storeName).put(affected[storeName]);
    tx.objectStore(storeName).put(unrelated[storeName]);
  }
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  const paper = structuredClone(parseExamMarkdown(markdown));
  paper.units[0].questions[0].explanation = 'Clean replacement';
  const upgradedPack = await createExamPack({
    meta: {
      packageId: original.manifest.packageId,
      packageVersion: '1.0.1',
      examId: original.manifest.examId,
      bankId: original.manifest.bankId,
      displayName: original.manifest.displayName
    },
    papers: [paper],
    generatedAt
  });

  const result = await installExamPack(openDb, upgradedPack, {
    resetStateForContentHashes: [original.manifest.contentHash]
  });
  assert.equal(result.stateReset, true);
  for (const storeName of stateStores) {
    const rows = await getAll(db, storeName);
    assert.equal(rows.length, 1, `${storeName} should retain only unrelated state`);
    assert.equal(rows[0].bankId, 'other_bank');
  }
  db.close();
});

test('only the known contaminated private English I pack opts into state reset', () => {
  assert.deepEqual(getExamPackInstallOptions({ manifest: { packageId: 'local.kaoyan.en1' } }), {
    resetStateForContentHashes: ['sha256:752e40ea4ed8c853da2aeea135e92f60e4b9c9b5f76707b5612ee93fd3d12a44']
  });
  assert.deepEqual(getExamPackInstallOptions({ manifest: { packageId: 'synthetic.kaoyan.en1' } }), {
    resetStateForContentHashes: []
  });
});
