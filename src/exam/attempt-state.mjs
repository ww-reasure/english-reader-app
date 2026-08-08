import { gradeSingleChoice } from './grading.mjs';

function createId(prefix) {
  const random = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${random}`;
}

export function createAttemptId() {
  return createId('attempt');
}

export function createResponseId(attemptId, questionKey) {
  return `${attemptId}:${questionKey}`;
}

export function createAttempt({
  examId,
  bankId,
  packageId,
  paperKey,
  unitKey,
  mode = 'normal',
  practiceOrigin = 'normal',
  scopeQuestionKeys = null,
  reviewEligibleQuestionKeys = null,
  questionKeys,
  optionOrders,
  candidateOrder = null,
  practiceKind = 'unit',
  unitKeys = null,
  currentUnitKey = null,
  currentUnitIndex = 0,
  unitOrder = null,
  candidateOrders = null,
  passageScrollAnchors = null,
  optionShuffleSeed = null,
  packVersion,
  contentHashSnapshot
}) {
  const now = Date.now();
  return {
    attemptId: createAttemptId(),
    examId,
    bankId,
    packageId,
    paperKey,
    unitKey,
    practiceKind,
    unitKeys: unitKeys || [unitKey],
    currentUnitKey: currentUnitKey || unitKey,
    currentUnitIndex: Number(currentUnitIndex) || 0,
    unitOrder: unitOrder || unitKeys || [unitKey],
    mode,
    practiceOrigin,
    scopeQuestionKeys: scopeQuestionKeys || null,
    reviewEligibleQuestionKeys: reviewEligibleQuestionKeys || null,
    questionOrder: questionKeys,
    optionOrders,
    candidateOrder,
    candidateOrders: candidateOrders || (candidateOrder ? { [unitKey]: candidateOrder } : {}),
    optionShuffleSeed,
    status: 'in_progress',
    startedAt: now,
    updatedAt: now,
    submittedAt: null,
    activeDurationMs: 0,
    currentQuestionKey: questionKeys[0] || null,
    passageScrollAnchor: 0,
    passageScrollAnchors: passageScrollAnchors || { [currentUnitKey || unitKey]: 0 },
    sheetSnap: 'mid',
    packVersion,
    contentHashSnapshot,
    packageVersionAtStart: packVersion,
    paperHashAtStart: contentHashSnapshot,
    createdAt: now
  };
}

export function createResponse(attempt, questionKey, { answer = null, value = undefined, uncertain = false, unitKey = null } = {}) {
  const response = {
    responseId: createResponseId(attempt.attemptId, questionKey),
    attemptId: attempt.attemptId,
    examId: attempt.examId,
    bankId: attempt.bankId,
    packageId: attempt.packageId,
    paperKey: attempt.paperKey,
    unitKey: unitKey || attempt.currentUnitKey || attempt.unitKey,
    questionKey,
    answer,
    uncertain,
    correct: null,
    pointsEarned: null,
    correctOptionKeyAtSubmit: null,
    questionHashAtSubmit: null,
    answeredAt: answer === null || answer === undefined ? null : Date.now(),
    submittedAt: null
  };
  if (value !== undefined) response.value = value;
  return response;
}

export function submitAttempt({ attempt, responses, questions, submittedAt = Date.now(), activeDurationMs }) {
  if (attempt.status === 'submitted') throw new Error('已提交的 attempt 不可修改');
  const questionByKey = new Map(questions.map(question => [question.questionKey, question]));
  const gradedResponses = responses.map(response => {
    const question = questionByKey.get(response.questionKey);
    if (!question) throw new Error(`提交包含未知 questionKey：${response.questionKey}`);
    if (question.type === 'translation_segment') {
      const text = String(response.value?.text || '');
      const { correctOptionKeyAtSubmit, ...translationResponse } = response;
      return {
        ...translationResponse,
        value: { text },
        correct: null,
        pointsEarned: null,
        unanswered: !text.trim(),
        submittedAt
      };
    }
    const result = gradeSingleChoice(question, response.answer);
    return {
      ...response,
      correct: result.correct,
      pointsEarned: result.pointsEarned,
      unanswered: result.unanswered,
      correctOptionKeyAtSubmit: response.correctOptionKeyAtSubmit || question.answer,
      questionHashAtSubmit: response.questionHashAtSubmit || null,
      submittedAt
    };
  });
  return {
    attempt: {
      ...attempt,
      status: 'submitted',
      submittedAt,
      updatedAt: submittedAt,
      activeDurationMs: Number.isFinite(activeDurationMs) ? activeDurationMs : attempt.activeDurationMs
    },
    responses: gradedResponses
  };
}
