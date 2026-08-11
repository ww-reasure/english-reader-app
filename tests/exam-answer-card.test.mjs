import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAnswerCardModel, renderAnswerCardHtml } from '../src/exam/practice-answer-card.mjs';

const units = [
  {
    unitKey: 'cloze',
    type: 'cloze_choice',
    displayTitle: '完形填空',
    questions: [
      { questionKey: 'paper_q1', blankNumber: 1 },
      { questionKey: 'paper_q2', blankNumber: 2 }
    ]
  },
  {
    unitKey: 'reading_text_1',
    type: 'reading_mcq',
    displayTitle: '阅读 Text 1',
    questions: [
      { questionKey: 'paper_q21' },
      { questionKey: 'paper_q22' }
    ]
  },
  {
    unitKey: 'translation',
    type: 'translation',
    displayTitle: '翻译',
    questions: [{ questionKey: 'paper_q46', segmentKey: 'S1' }]
  }
];

test('full-paper answer card follows questionOrder and reports answer states across units', () => {
  const model = buildAnswerCardModel({
    attempt: {
      practiceKind: 'full_paper',
      questionOrder: ['paper_q1', 'paper_q2', 'paper_q21', 'paper_q22', 'paper_q46']
    },
    units,
    responses: new Map([
      ['paper_q1', { answer: 'A' }],
      ['paper_q21', { answer: 'C', uncertain: true }],
      ['paper_q46', { value: { text: '我的译文' } }]
    ]),
    currentQuestionKey: 'paper_q21'
  });

  assert.equal(model.total, 5);
  assert.equal(model.answered, 3);
  assert.equal(model.unanswered, 2);
  assert.equal(model.uncertain, 1);
  assert.equal(model.currentPosition, 3);
  assert.deepEqual(model.groups.map(group => group.label), ['完形填空', '阅读 Text 1', '翻译']);
  assert.deepEqual(model.groups.flatMap(group => group.questions.map(question => question.label)), ['1', '2', '21', '22', '46']);
  assert.equal(model.groups[1].questions[0].current, true);
  assert.equal(model.groups[1].questions[0].uncertain, true);
  assert.equal(model.groups[2].questions[0].answered, true);
});

test('unit answer card only exposes the current unit and preserves local positions', () => {
  const model = buildAnswerCardModel({
    attempt: {
      practiceKind: 'unit',
      currentUnitKey: 'reading_text_1',
      questionOrder: ['paper_q21', 'paper_q22']
    },
    units,
    responses: new Map(),
    currentQuestionKey: 'paper_q22'
  });

  assert.equal(model.total, 2);
  assert.equal(model.currentPosition, 2);
  assert.equal(model.groups.length, 1);
  assert.equal(model.groups[0].unitKey, 'reading_text_1');
  assert.deepEqual(model.groups[0].questions.map(question => question.questionIndex), [0, 1]);
});

test('answer card markup exposes accessible navigation, states, and submit action', () => {
  const html = renderAnswerCardHtml({
    total: 2,
    answered: 1,
    unanswered: 1,
    uncertain: 1,
    groups: [{
      unitKey: 'reading_text_1',
      label: '阅读 Text 1',
      questions: [
        { questionKey: 'paper_q21', label: '21', answered: true, uncertain: true, current: true },
        { questionKey: 'paper_q22', label: '22', answered: false, uncertain: false, current: false }
      ]
    }]
  });

  assert.match(html, /role="dialog"/);
  assert.match(html, /<b>1<\/b>已答/);
  assert.match(html, /<b>1<\/b>未答/);
  assert.match(html, /data-answer-question="paper_q21"/);
  assert.match(html, /is-answered/);
  assert.match(html, /is-current/);
  assert.match(html, /is-uncertain/);
  assert.match(html, /id="examAnswerCardSubmit"/);
});

test('answer card can render read-only navigation for submitted explanations', () => {
  const html = renderAnswerCardHtml({
    total: 2,
    answered: 2,
    unanswered: 0,
    uncertain: 0,
    groups: [{
      unitKey: 'reading_text_1',
      label: '阅读 Text 1',
      questions: [
        { questionKey: 'paper_q21', label: '21', answered: true, uncertain: false, current: true },
        { questionKey: 'paper_q22', label: '22', answered: true, uncertain: false, current: false }
      ]
    }]
  }, { readOnly: true });
  assert.match(html, /data-answer-question="paper_q22"/);
  assert.match(html, /解析模式/);
  assert.doesNotMatch(html, /id="examAnswerCardSubmit"/);
});

test('full-paper labels fall back to global exam positions for translation segments', () => {
  const translationOnly = [{
    unitKey: 'translation',
    type: 'translation',
    displayTitle: '翻译',
    questions: [
      { questionKey: 'paper_translation_s1', segmentKey: 'S1' },
      { questionKey: 'paper_translation_s2', segmentKey: 'S2' }
    ]
  }];
  const questionOrder = Array.from({ length: 45 }, (_, index) => `paper_q${index + 1}`)
    .concat(['paper_translation_s1', 'paper_translation_s2']);
  const model = buildAnswerCardModel({
    attempt: { practiceKind: 'full_paper', questionOrder },
    units: translationOnly,
    currentQuestionKey: 'paper_translation_s1'
  });
  assert.deepEqual(model.groups[0].questions.map(question => question.label), ['46', '47']);
});

test('full-paper groups follow the persisted unitOrder instead of repository order', () => {
  const model = buildAnswerCardModel({
    attempt: {
      practiceKind: 'full_paper',
      unitOrder: ['reading_text_1', 'cloze'],
      questionOrder: ['paper_q21', 'paper_q22', 'paper_q1', 'paper_q2']
    },
    units,
    currentQuestionKey: 'paper_q21'
  });

  assert.deepEqual(model.groups.map(group => group.unitKey), ['reading_text_1', 'cloze']);
});
