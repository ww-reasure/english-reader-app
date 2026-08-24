import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseExamMarkdown } from '../src/exam/parser.mjs';
import { assertCanonicalPaper } from '../src/exam/schema.mjs';

const fixtureUrl = new URL('./fixtures/exam-md-minimal.md', import.meta.url);

async function loadPaper() {
  const markdown = await readFile(fixtureUrl, 'utf8');
  return parseExamMarkdown(markdown);
}

test('accepts the canonical synthetic paper', async () => {
  const paper = await loadPaper();
  assert.equal(assertCanonicalPaper(paper), paper);
});

test('rejects a missing paperKey', async () => {
  const paper = structuredClone(await loadPaper());
  delete paper.paperKey;
  assert.throws(() => assertCanonicalPaper(paper), /paperKey/);
});

test('rejects duplicate unit keys', async () => {
  const paper = structuredClone(await loadPaper());
  paper.units.push(structuredClone(paper.units[0]));
  assert.throws(() => assertCanonicalPaper(paper), /unitKey 重复/);
});

test('rejects duplicate question keys', async () => {
  const paper = structuredClone(await loadPaper());
  paper.units[0].questions[1].questionKey = paper.units[0].questions[0].questionKey;
  assert.throws(() => assertCanonicalPaper(paper), /questionKey 重复/);
});

test('rejects invalid points and empty stems', async () => {
  const paper = structuredClone(await loadPaper());
  paper.units[0].questions[0].points = 0;
  assert.throws(() => assertCanonicalPaper(paper), /points 必须是正数/);

  paper.units[0].questions[0].points = 2;
  paper.units[0].questions[0].stem = '';
  assert.throws(() => assertCanonicalPaper(paper), /stem 必须是非空字符串/);
});

test('rejects reading option analysis that contains a teaching appendix marker', async () => {
  const paper = structuredClone(await loadPaper());
  const question = paper.units[0].questions[0];
  question.optionAnalysis[0].text += ' S E N T E N C E I N S I G H T S · 句子精讲';
  assert.throws(() => assertCanonicalPaper(paper), /optionAnalysis.*教学附录/u);
});

test('keeps CET4 legacy reading explanations valid when they contain a teaching appendix', async () => {
  const paper = structuredClone(await loadPaper());
  paper.examId = 'cet4';
  paper.units[0].questions[0].explanation += ' S E N T E N C E I N S I G H T S · 句子精讲';

  assert.equal(assertCanonicalPaper(paper), paper);
});

