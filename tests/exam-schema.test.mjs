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

