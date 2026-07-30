import assert from 'node:assert/strict';
import test from 'node:test';

import {
  renderExamCorpusDetail,
  selectExamCorpusPresentation
} from '../src/components/exam-corpus-presentation.mjs';

const record = {
  priorityScore: 72,
  priorityTier: 'frequent',
  priorityLabel: '真题常考',
  syllabusStatus: 'in_syllabus',
  counts: { sentenceTotal: 244, passage: 43, questionStem: 201, other: 0, papers: 59, years: 11 }
};

test('selects the current CET record and distinguishes passage from question frequency', () => {
  const presentation = selectExamCorpusPresentation({ cet4: record }, 'cet4');
  assert.equal(presentation.trackLabel, '四级');
  assert.equal(presentation.badgeLabel, '四级 · 真题常考');
  assert.equal(presentation.isGraduateShared, false);

  const markup = renderExamCorpusDetail(presentation, value => String(value));
  assert.match(markup, /考试频度/);
  assert.match(markup, /正文 43 次/);
  assert.match(markup, /题干 201 次/);
  assert.match(markup, /覆盖 59 套/);
  assert.match(markup, /11 个年份/);
});

test('labels the shared graduate score honestly while English I examples remain separately filterable', () => {
  const presentation = selectExamCorpusPresentation({ 'kaoyan-general': record }, 'kaoyan1');
  assert.equal(presentation.trackLabel, '考研通用');
  assert.equal(presentation.badgeLabel, '考研通用 · 真题常考');
  assert.equal(presentation.isGraduateShared, true);
  assert.match(renderExamCorpusDetail(presentation, value => String(value)), /英语一、英语二合并口径/);
});

test('does not manufacture a score when the selected track has no corpus record', () => {
  assert.equal(selectExamCorpusPresentation({ cet4: record }, 'cet6'), null);
  assert.equal(renderExamCorpusDetail(null), '');
});

test('presents a syllabus-only record as membership instead of claiming it never appeared absolutely', () => {
  const presentation = selectExamCorpusPresentation({
    'kaoyan-general': {
      ...record,
      priorityTier: 'uncovered',
      priorityLabel: '考纲未见',
      syllabusStatus: 'uncovered',
      counts: { sentenceTotal: 0, passage: 0, questionStem: 0, other: 0, papers: 0, years: 0 }
    }
  }, 'kaoyan2');

  assert.equal(presentation.badgeLabel, '考研词表');
  assert.match(renderExamCorpusDetail(presentation, value => String(value)), /当前收录真题语料未见/);
  assert.doesNotMatch(renderExamCorpusDetail(presentation, value => String(value)), /绝对未考/);
});
