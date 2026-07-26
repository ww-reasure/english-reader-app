function asTrimmedText(value) {
  return String(value ?? '').trim();
}

export function normalizeAnswer(value, optionCount = 4) {
  const text = asTrimmedText(value);
  if (!text) return null;

  const letterMatch = /^[A-Za-z]$/.test(text);
  const numericMatch = /^\d+$/.test(text);
  const answer = letterMatch
    ? text.toUpperCase().charCodeAt(0) - 65
    : numericMatch
      ? Number.parseInt(text, 10)
      : null;

  return Number.isInteger(answer) && answer >= 0 && answer < optionCount ? answer : null;
}

export function normalizeQuestionSet(rawQuestions) {
  if (!Array.isArray(rawQuestions) || rawQuestions.length !== 3) {
    return { valid: false, questions: [], reason: 'expected_three_questions' };
  }

  const questions = [];
  for (const rawQuestion of rawQuestions) {
    const question = asTrimmedText(rawQuestion?.question);
    const options = Array.isArray(rawQuestion?.options) && rawQuestion.options.length === 4
      ? rawQuestion.options.map(asTrimmedText)
      : [];
    const answer = normalizeAnswer(rawQuestion?.answer, options.length);

    if (!question || options.some(option => !option) || answer === null) {
      return { valid: false, questions: [], reason: 'invalid_question' };
    }

    questions.push({ question, options, answer });
  }

  return { valid: true, questions, reason: '' };
}

export function hasCompleteAnswers(questions, answers) {
  const normalized = normalizeQuestionSet(questions);
  if (!normalized.valid) return false;

  return normalized.questions.every((question, index) =>
    normalizeAnswer(answers?.[index], question.options.length) !== null
  );
}
