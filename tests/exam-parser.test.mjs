import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseExamMarkdown } from '../src/exam/parser.mjs';
import { assertCanonicalPaper } from '../src/exam/schema.mjs';

const fixtureUrl = new URL('./fixtures/exam-md-minimal.md', import.meta.url);

test('parses the synthetic fixture into a canonical paper', async () => {
  const markdown = await readFile(fixtureUrl, 'utf8');
  const paper = parseExamMarkdown(markdown);

  assert.equal(paper.schemaVersion, 1);
  assert.equal(paper.examId, 'kaoyan_en1');
  assert.equal(paper.bankId, 'synthetic_kaoyan_bank');
  assert.equal(paper.packageId, 'synthetic.kaoyan.en1');
  assert.equal(paper.paperKey, 'synthetic_kaoyan_2026');
  assert.equal(paper.year, 2026);
  assert.equal(paper.units.length, 1);
  assert.equal(paper.units[0].unitKey, 'synthetic_kaoyan_2026_text_1');
  assert.equal(paper.units[0].passage.length, 2);
  assert.equal(paper.units[0].translation.length, 2);
  assert.equal(paper.units[0].questions.length, 2);
  assert.equal(paper.units[0].questions[0].answer, 'B');
  assert.equal(paper.units[0].questions[1].answer, 'A');
});

test('parses optional directions and reading explanation layers without changing old fields', async () => {
  const source = await readFile(fixtureUrl, 'utf8');
  const markdown = source
    .replace(
      '#### Passage',
      '#### Directions\nRead the passage and answer the questions.\n\n#### Passage'
    )
    .replace(
      '##### Question Translation',
      '##### Stem Analysis\nWhat is the question asking about?\n\n##### Evidence Translation\n该定位句的中文翻译。\n\n##### Option Translations\n- A: 选项 A 的中文\n- C: 选项 C 的中文\n\n##### Question Translation'
    );
  const paper = parseExamMarkdown(markdown);
  const unit = paper.units[0];
  const question = unit.questions[0];

  assert.equal(unit.directions, 'Read the passage and answer the questions.');
  assert.equal(question.stemAnalysis, 'What is the question asking about?');
  assert.equal(question.evidenceTranslation, '该定位句的中文翻译。');
  assert.deepEqual(question.optionTranslations, [
    { key: 'A', text: '选项 A 的中文' },
    { key: 'C', text: '选项 C 的中文' }
  ]);
  assert.doesNotThrow(() => assertCanonicalPaper(paper));
});

test('validator rejects unknown or duplicate optional option translation keys', async () => {
  const paper = parseExamMarkdown(await readFile(fixtureUrl, 'utf8'));
  const question = paper.units[0].questions[0];

  question.optionTranslations = [{ key: 'Z', text: '未知选项' }];
  assert.throws(() => assertCanonicalPaper(paper), /optionTranslations\.key 不在 options 中/);

  question.optionTranslations = [
    { key: 'A', text: '第一份翻译' },
    { key: 'A', text: '重复翻译' }
  ];
  assert.throws(() => assertCanonicalPaper(paper), /optionTranslations\.key 重复/);
});

test('rejects markdown without exam-meta', () => {
  const markdown = [
    '# Broken',
    '### Text 1',
    '```exam-item',
    '{ "unitKey": "u1", "type": "reading_mcq" }',
    '```'
  ].join('\n');

  assert.throws(() => parseExamMarkdown(markdown), /exam-meta 缺失/);
});

test('rejects a unit without exam-item metadata', () => {
  const markdown = [
    '# Broken',
    '```exam-meta',
    '{ "schema": "exam-md-v1", "examId": "kaoyan_en1", "bankId": "b1", "packageId": "p1", "packageVersion": "1.0.0", "paperKey": "p2026", "year": 2026, "sourceType": "synthetic" }',
    '```',
    '### Text 1',
    '#### Passage',
    '##### P1',
    'Missing unit metadata.'
  ].join('\n');

  assert.throws(() => parseExamMarkdown(markdown), /unit 缺少 exam-item 元数据/);
});

test('rejects duplicate question keys', async () => {
  const markdown = (await readFile(fixtureUrl, 'utf8'))
    .replace('"questionKey": "synthetic_kaoyan_2026_q22"', '"questionKey": "synthetic_kaoyan_2026_q21"');

  assert.throws(() => parseExamMarkdown(markdown), /questionKey 重复/);
});

test('rejects an answer that is not one of the options', async () => {
  const markdown = (await readFile(fixtureUrl, 'utf8'))
    .replace('"answer": "B"', '"answer": "Z"');

  assert.throws(() => parseExamMarkdown(markdown), /answer 不在 options 中/);
});
