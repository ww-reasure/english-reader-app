import { examDisplayName } from './exam-context.mjs';

const copyKeyTextItems = items => Array.isArray(items)
  ? items.map(item => ({ key: item?.key ?? null, text: item?.text ?? '' }))
  : [];

const copyAttemptSnapshot = attempt => ({
  attemptId: attempt?.attemptId ?? null,
  examId: attempt?.examId ?? null,
  examLabel: examDisplayName(attempt?.examId, attempt?.bankId),
  bankId: attempt?.bankId ?? null,
  packageId: attempt?.packageId ?? null,
  paperKey: attempt?.paperKey ?? null,
  unitKey: attempt?.unitKey ?? null,
  packageVersionAtStart: attempt?.packageVersionAtStart ?? null,
  paperHashAtStart: attempt?.paperHashAtStart ?? null,
  submittedAt: attempt?.submittedAt ?? null
});

const copyQuestionContext = question => {
  const context = {
    questionKey: question?.questionKey ?? null,
    stem: question?.stem ?? '',
    options: copyKeyTextItems(question?.options)
  };
  [
    'questionTranslation',
    'questionType',
    'stemAnalysis',
    'location',
    'evidence',
    'evidenceTranslation',
    'explanation'
  ].forEach(field => {
    if (question?.[field] !== undefined) context[field] = question[field];
  });
  if (question?.optionTranslations !== undefined) context.optionTranslations = copyKeyTextItems(question.optionTranslations);
  if (question?.optionAnalysis !== undefined) context.optionAnalysis = copyKeyTextItems(question.optionAnalysis);
  return context;
};

const copyPassageContext = unit => {
  const context = {
    unitKey: unit?.unitKey ?? null,
    type: unit?.type ?? null,
    paragraphs: copyKeyTextItems(unit?.passage),
    translations: copyKeyTextItems(unit?.translation)
  };
  if (unit?.directions !== undefined) context.directions = unit.directions;
  return context;
};

const addOptionalText = (target, source, field) => {
  if (typeof source?.[field] === 'string' && source[field].trim()) target[field] = source[field];
};

const copyTranslationContext = ({ response, question, translationReviewStatus }) => {
  const context = {
    segmentKey: question?.segmentKey ?? null,
    sourceText: question?.sourceText ?? '',
    userTranslationAtSubmit: String(response?.value?.text ?? '')
  };
  addOptionalText(context, question, 'referenceTranslation');
  addOptionalText(context, question, 'localAnalysis');
  addOptionalText(context, question, 'location');
  if (typeof translationReviewStatus === 'string' && translationReviewStatus.trim()) {
    context.translationReviewStatus = translationReviewStatus;
  }
  return context;
};

export function buildExamTutorConversationKey(attemptId, questionKey) {
  return `exam:${attemptId}:question:${questionKey}`;
}

export class ExamTutorContextBuilder {
  build({ attempt, response, question, unit, quote = null, translationReviewStatus = null }) {
    if (unit?.type === 'translation' || question?.type === 'translation_segment') {
      const exam = {
        attempt: copyAttemptSnapshot(attempt),
        translation: copyTranslationContext({ response, question, translationReviewStatus }),
        passage: copyPassageContext(unit)
      };
      if (quote?.selectedText) exam.quote = {
        selectedText: String(quote.selectedText),
        selectedSource: String(quote.selectedSource || 'translation_source')
      };
      return {
        conversationKey: buildExamTutorConversationKey(attempt?.attemptId, question?.questionKey),
        kind: 'translation',
        pageContext: { exam }
      };
    }
    const exam = {
      attempt: copyAttemptSnapshot(attempt),
      answer: {
        selectedOptionKey: response?.answer ?? null,
        uncertain: Boolean(response?.uncertain),
        correct: response?.correct ?? null,
        pointsEarned: response?.pointsEarned ?? null,
        correctOptionKey: response?.correctOptionKeyAtSubmit ?? question?.answer ?? null,
        questionHashAtSubmit: response?.questionHashAtSubmit ?? null
      },
      question: copyQuestionContext(question),
      passage: copyPassageContext(unit)
    };
    if (quote?.selectedText) exam.quote = {
      selectedText: String(quote.selectedText),
      selectedSource: String(quote.selectedSource || 'question')
    };
    return {
      conversationKey: buildExamTutorConversationKey(attempt?.attemptId, question?.questionKey),
      kind: 'exam',
      pageContext: { exam }
    };
  }
}
