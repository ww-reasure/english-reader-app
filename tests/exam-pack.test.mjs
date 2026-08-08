import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseExamMarkdown } from '../src/exam/parser.mjs';
import { assertExamPack, buildExamPackFromMarkdown, createExamPack, hashPaper, hashQuestion } from '../src/exam/pack.mjs';

const fixtureUrl = new URL('./fixtures/exam-md-minimal.md', import.meta.url);
const generatedAt = '2026-08-07T00:00:00.000Z';

test('builds a deterministic pack with matching content hashes', async () => {
  const markdown = await readFile(fixtureUrl, 'utf8');
  const first = await buildExamPackFromMarkdown(markdown, { generatedAt, displayName: 'Synthetic' });
  const second = await buildExamPackFromMarkdown(markdown, { generatedAt, displayName: 'Synthetic' });

  assert.deepEqual(first, second);
  assert.match(first.manifest.contentHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first.manifest.papers.length, 1);
  assert.equal(first.manifest.papers[0].unitCount, 1);
  assert.equal(first.manifest.papers[0].questionCount, 2);
  assert.equal(first.manifest.papers[0].contentHash, await hashPaper(first.papers[0]));
  assert.equal(await assertExamPack(first), first);
});

test('content hash changes on an explanation update while stable keys stay unchanged', async () => {
  const markdown = await readFile(fixtureUrl, 'utf8');
  const original = await buildExamPackFromMarkdown(markdown, { generatedAt, displayName: 'Synthetic' });
  const paper = structuredClone(parseExamMarkdown(markdown));
  paper.units[0].questions[0].explanation = 'Updated explanation';

  const updated = await createExamPack({
    meta: {
      packageId: paper.packageId,
      packageVersion: '1.1.0',
      examId: paper.examId,
      bankId: paper.bankId,
      displayName: 'Synthetic'
    },
    papers: [paper],
    generatedAt
  });

  assert.notEqual(updated.manifest.papers[0].contentHash, original.manifest.papers[0].contentHash);
  assert.equal(updated.manifest.papers[0].paperKey, original.manifest.papers[0].paperKey);
  assert.equal(updated.manifest.packageVersion, '1.1.0');
});

test('question and paper hashes change when optional explanation layers change', async () => {
  const markdown = await readFile(fixtureUrl, 'utf8');
  const original = await buildExamPackFromMarkdown(markdown, { generatedAt, displayName: 'Synthetic' });
  const paper = structuredClone(parseExamMarkdown(markdown));
  const question = paper.units[0].questions[0];
  const originalQuestionHash = await hashQuestion(question);
  question.stemAnalysis = 'Updated stem analysis';
  question.evidenceTranslation = '更新后的定位句翻译';
  question.optionTranslations = [{ key: 'A', text: '选项 A 翻译' }];
  paper.units[0].directions = 'Updated directions';

  const updated = await createExamPack({
    meta: {
      packageId: paper.packageId,
      packageVersion: paper.packageVersion,
      examId: paper.examId,
      bankId: paper.bankId,
      displayName: 'Synthetic'
    },
    papers: [paper],
    generatedAt
  });

  assert.notEqual(await hashQuestion(question), originalQuestionHash);
  assert.notEqual(updated.manifest.papers[0].contentHash, original.manifest.papers[0].contentHash);
});

test('paper hash changes when candidate translations change', async () => {
  const markdown = await readFile(new URL('./fixtures/exam-md-ordering-minimal.md', import.meta.url), 'utf8');
  const original = await buildExamPackFromMarkdown(markdown, { generatedAt, displayName: 'Synthetic' });
  const paper = structuredClone(parseExamMarkdown(markdown));
  paper.units[0].candidateTranslations = [{ key: 'A', text: '候选段 A 的中文译文' }];
  const updated = await createExamPack({
    meta: {
      packageId: paper.packageId,
      packageVersion: paper.packageVersion,
      examId: paper.examId,
      bankId: paper.bankId,
      displayName: 'Synthetic'
    },
    papers: [paper],
    generatedAt
  });
  assert.notEqual(updated.manifest.papers[0].contentHash, original.manifest.papers[0].contentHash);
});

test('rejects a tampered manifest content hash', async () => {
  const markdown = await readFile(fixtureUrl, 'utf8');
  const pack = await buildExamPackFromMarkdown(markdown, { generatedAt, displayName: 'Synthetic' });
  const tampered = structuredClone(pack);
  tampered.manifest.contentHash = `sha256:${'0'.repeat(64)}`;

  await assert.rejects(assertExamPack(tampered), /contentHash 不匹配/);
});

test('rejects duplicate question keys across papers in the same bank', async () => {
  const markdown = await readFile(fixtureUrl, 'utf8');
  const paper = parseExamMarkdown(markdown);
  const secondPaper = structuredClone(paper);
  secondPaper.paperKey = 'synthetic_kaoyan_2025';
  secondPaper.year = 2025;
  secondPaper.units[0].questions[0].questionKey = paper.units[0].questions[0].questionKey;

  await assert.rejects(createExamPack({
    meta: {
      packageId: paper.packageId,
      packageVersion: paper.packageVersion,
      examId: paper.examId,
      bankId: paper.bankId,
      displayName: 'Synthetic'
    },
    papers: [paper, secondPaper],
    generatedAt
  }), /questionKey 必须全局唯一/);
});
