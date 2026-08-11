import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveExamIdForBank, unitLabel, sectionLabelOf, examDisplayName } from '../src/exam/exam-context.mjs';

test('resolves exam id from bank identity', () => {
  assert.equal(resolveExamIdForBank('builtin_cet4'), 'cet4');
  assert.equal(resolveExamIdForBank('builtin_kaoyan_en1'), 'kaoyan_en1');
  assert.equal(resolveExamIdForBank(''), null);
});

test('labels CET4 units without touching kaoyan wording', () => {
  const cet4 = { examId: 'cet4' };
  const kaoyan = { examId: 'kaoyan_en1' };
  assert.equal(unitLabel({ type: 'matching', matchingVariant: 'banked_cloze' }, cet4), '选词填空');
  assert.equal(unitLabel({ type: 'matching', matchingVariant: 'long_reading' }, cet4), '长篇阅读');
  assert.equal(unitLabel({ type: 'reading_mcq', displayTitle: 'Passage One' }, cet4), '仔细阅读 · Passage One');
  assert.equal(unitLabel({ type: 'reading_mcq', displayTitle: 'Text 1' }, kaoyan), '阅读理解 · Text 1');
  assert.equal(unitLabel({ type: 'translation' }, cet4), '汉译英');
  assert.equal(unitLabel({ type: 'translation' }, kaoyan), '翻译');
});

test('section labels prefer explicit sectionLabel and fall back per exam', () => {
  const cet4 = { examId: 'cet4' };
  const kaoyan = { examId: 'kaoyan_en1' };
  assert.equal(sectionLabelOf({ sectionLabel: 'Section B · 长篇阅读' }), 'Section B · 长篇阅读');
  assert.equal(sectionLabelOf({ type: 'matching', matchingVariant: 'banked_cloze' }, cet4), 'Section A');
  assert.equal(sectionLabelOf({ type: 'matching' }, cet4), 'Section B');
  assert.equal(sectionLabelOf({ type: 'matching' }, kaoyan), 'Section II Part B');
  assert.equal(sectionLabelOf({ type: 'translation' }, cet4), 'Part IV');
  assert.equal(examDisplayName('cet4'), '英语四级');
  assert.equal(examDisplayName('kaoyan_en1'), '考研英语一');
});
