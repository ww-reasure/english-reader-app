import assert from 'node:assert/strict';
import test from 'node:test';
import { ExamTutorContextBuilder } from '../src/exam/exam-tutor-context.mjs';

function completeInput({
  attemptId = 'attempt-2026-001',
  submittedAnswer = 'B',
  correctOptionKeyAtSubmit = 'D',
  currentQuestionAnswer = 'A'
} = {}) {
  return {
    attempt: {
      attemptId,
      examId: 'kaoyan_en1',
      bankId: 'builtin_kaoyan_en1',
      packageId: 'local.kaoyan.en1',
      paperKey: 'kaoyan_en1_2026',
      unitKey: 'kaoyan_en1_2026_part_a_text_1',
      packageVersionAtStart: '2026.08.07',
      paperHashAtStart: 'paper-hash-at-start',
      submittedAt: 1_786_000_000_000
    },
    response: {
      responseId: `${attemptId}:kaoyan_en1_2026_q22`,
      questionKey: 'kaoyan_en1_2026_q22',
      answer: submittedAnswer,
      uncertain: true,
      correct: false,
      pointsEarned: 0,
      correctOptionKeyAtSubmit,
      questionHashAtSubmit: 'question-hash-at-submit'
    },
    question: {
      questionKey: 'kaoyan_en1_2026_q22',
      stem: 'What does the passage suggest?',
      options: [
        { key: 'A', text: 'Option A' },
        { key: 'B', text: 'Option B' },
        { key: 'C', text: 'Option C' },
        { key: 'D', text: 'Option D' }
      ],
      answer: currentQuestionAnswer,
      questionTranslation: '文章暗示了什么？',
      optionTranslations: [{ key: 'B', text: '选项 B 译文。' }],
      questionType: '推断题',
      stemAnalysis: '判型：推断题\n拆句：What does…',
      location: 'P2',
      evidence: 'Evidence sentence.',
      evidenceTranslation: '定位句中文翻译。',
      optionAnalysis: [
        { key: 'B', text: '与原文相反。' },
        { key: 'D', text: '✓ 正确。' }
      ],
      explanation: '来源解析。'
    },
    unit: {
      unitKey: 'kaoyan_en1_2026_part_a_text_1',
      type: 'reading_mcq',
      directions: 'Read the following text and answer Questions 21 to 25.',
      passage: [
        { key: 'P1', text: 'Passage paragraph one.' },
        { key: 'P2', text: 'Passage paragraph two.' }
      ],
      translation: [
        { key: 'P1', text: '第一段译文。' },
        { key: 'P2', text: '第二段译文。' }
      ]
    }
  };
}

test('ExamTutorContextBuilder builds a complete serializable submitted-question context', () => {
  const input = completeInput();
  const context = new ExamTutorContextBuilder().build(input);

  assert.equal(context.conversationKey, 'exam:attempt-2026-001:question:kaoyan_en1_2026_q22');
  assert.equal(context.kind, 'exam');
  assert.deepEqual(context.pageContext.exam.attempt, {
    attemptId: 'attempt-2026-001',
    examId: 'kaoyan_en1',
    bankId: 'builtin_kaoyan_en1',
    packageId: 'local.kaoyan.en1',
    paperKey: 'kaoyan_en1_2026',
    unitKey: 'kaoyan_en1_2026_part_a_text_1',
    packageVersionAtStart: '2026.08.07',
    paperHashAtStart: 'paper-hash-at-start',
    submittedAt: 1_786_000_000_000
  });
  assert.deepEqual(context.pageContext.exam.answer, {
    selectedOptionKey: 'B',
    uncertain: true,
    correct: false,
    pointsEarned: 0,
    correctOptionKey: 'D',
    questionHashAtSubmit: 'question-hash-at-submit'
  });
  assert.deepEqual(context.pageContext.exam.question, {
    questionKey: 'kaoyan_en1_2026_q22',
    stem: 'What does the passage suggest?',
    options: [
      { key: 'A', text: 'Option A' },
      { key: 'B', text: 'Option B' },
      { key: 'C', text: 'Option C' },
      { key: 'D', text: 'Option D' }
    ],
    questionTranslation: '文章暗示了什么？',
    optionTranslations: [{ key: 'B', text: '选项 B 译文。' }],
    questionType: '推断题',
    stemAnalysis: '判型：推断题\n拆句：What does…',
    location: 'P2',
    evidence: 'Evidence sentence.',
    evidenceTranslation: '定位句中文翻译。',
    optionAnalysis: [
      { key: 'B', text: '与原文相反。' },
      { key: 'D', text: '✓ 正确。' }
    ],
    explanation: '来源解析。'
  });
  assert.deepEqual(context.pageContext.exam.passage, {
    unitKey: 'kaoyan_en1_2026_part_a_text_1',
    type: 'reading_mcq',
    directions: 'Read the following text and answer Questions 21 to 25.',
    paragraphs: [
      { key: 'P1', text: 'Passage paragraph one.' },
      { key: 'P2', text: 'Passage paragraph two.' }
    ],
    translations: [
      { key: 'P1', text: '第一段译文。' },
      { key: 'P2', text: '第二段译文。' }
    ]
  });
  assert.doesNotThrow(() => JSON.stringify(context));
});

test('ExamTutorContextBuilder isolates historical attempts and prefers their submit snapshots', () => {
  const builder = new ExamTutorContextBuilder();
  const oldContext = builder.build(completeInput({
    attemptId: 'attempt-old',
    submittedAnswer: 'B',
    correctOptionKeyAtSubmit: 'D',
    currentQuestionAnswer: 'A'
  }));
  const revisedContext = builder.build(completeInput({
    attemptId: 'attempt-revised',
    submittedAnswer: 'A',
    correctOptionKeyAtSubmit: 'A',
    currentQuestionAnswer: 'A'
  }));

  assert.equal(oldContext.conversationKey, 'exam:attempt-old:question:kaoyan_en1_2026_q22');
  assert.equal(revisedContext.conversationKey, 'exam:attempt-revised:question:kaoyan_en1_2026_q22');
  assert.equal(oldContext.pageContext.exam.answer.selectedOptionKey, 'B');
  assert.equal(oldContext.pageContext.exam.answer.correctOptionKey, 'D');
  assert.equal(revisedContext.pageContext.exam.answer.selectedOptionKey, 'A');
  assert.equal(revisedContext.pageContext.exam.answer.correctOptionKey, 'A');
  assert.equal('answer' in oldContext.pageContext.exam.question, false);
});

test('ExamTutorContextBuilder returns detached context data without services or persistence', () => {
  const input = completeInput();
  const context = new ExamTutorContextBuilder().build(input);

  context.pageContext.exam.question.options[0].text = 'Changed only in context';
  context.pageContext.exam.question.optionAnalysis[0].text = 'Changed analysis only in context';
  context.pageContext.exam.passage.paragraphs[0].text = 'Changed passage only in context';

  assert.equal(input.question.options[0].text, 'Option A');
  assert.equal(input.question.optionAnalysis[0].text, '与原文相反。');
  assert.equal(input.unit.passage[0].text, 'Passage paragraph one.');
});

test('ExamTutorContextBuilder uses submitted translation text and omits unavailable translation fields', () => {
  const input = {
    attempt: {
      attemptId: 'translation-attempt-46',
      examId: 'kaoyan_en1',
      paperKey: 'kaoyan_en1_2026',
      unitKey: 'kaoyan_en1_2026_part_c',
      submittedAt: 1_786_000_000_000
    },
    response: {
      questionKey: 'kaoyan_en1_2026_part_c_q46',
      value: { text: '这是提交时保存的用户译文。' }
    },
    question: {
      questionKey: 'kaoyan_en1_2026_part_c_q46',
      type: 'translation_segment',
      segmentKey: 'S46',
      sourceText: 'Tracing the roots of the debate, the team found a pattern.',
      referenceTranslation: '追溯争论的根源，该团队发现了一种模式。',
      localAnalysis: '注意现在分词短语作状语。',
      location: 'P3'
    },
    unit: {
      unitKey: 'kaoyan_en1_2026_part_c',
      type: 'translation',
      directions: 'Translate the underlined parts.',
      passage: [{ key: 'P1', text: 'Full passage context.' }],
      translation: [{ key: 'P1', text: '全文参考译文。' }]
    },
    translationReviewStatus: 'needs_review',
    quote: { selectedText: 'Tracing the roots', selectedSource: 'translation_source' }
  };

  const context = new ExamTutorContextBuilder().build(input);

  assert.equal(context.kind, 'translation');
  assert.equal(context.conversationKey, 'exam:translation-attempt-46:question:kaoyan_en1_2026_part_c_q46');
  assert.deepEqual(context.pageContext.exam.translation, {
    segmentKey: 'S46',
    sourceText: 'Tracing the roots of the debate, the team found a pattern.',
    userTranslationAtSubmit: '这是提交时保存的用户译文。',
    referenceTranslation: '追溯争论的根源，该团队发现了一种模式。',
    localAnalysis: '注意现在分词短语作状语。',
    location: 'P3',
    translationReviewStatus: 'needs_review'
  });
  assert.deepEqual(context.pageContext.exam.passage, {
    unitKey: 'kaoyan_en1_2026_part_c',
    type: 'translation',
    paragraphs: [{ key: 'P1', text: 'Full passage context.' }],
    translations: [{ key: 'P1', text: '全文参考译文。' }],
    directions: 'Translate the underlined parts.'
  });
  assert.deepEqual(context.pageContext.exam.quote, {
    selectedText: 'Tracing the roots',
    selectedSource: 'translation_source'
  });
  assert.equal('options' in context.pageContext.exam.translation, false);

  const optionalInput = structuredClone(input);
  delete optionalInput.question.referenceTranslation;
  delete optionalInput.question.localAnalysis;
  delete optionalInput.question.location;
  delete optionalInput.translationReviewStatus;
  const optionalContext = new ExamTutorContextBuilder().build(optionalInput);
  assert.equal('referenceTranslation' in optionalContext.pageContext.exam.translation, false);
  assert.equal('localAnalysis' in optionalContext.pageContext.exam.translation, false);
  assert.equal('location' in optionalContext.pageContext.exam.translation, false);
  assert.equal('translationReviewStatus' in optionalContext.pageContext.exam.translation, false);
});
