import { examDisplayName, resolveExamIdForBank, unitLabel } from './exam-context.mjs';

const examIdOf = bankId => resolveExamIdForBank(bankId) || 'kaoyan_en1';

function typeLabelFor(unit, examId) {
  if (unit?.type === 'cloze_choice') return '完形填空';
  if (unit?.type === 'reading_mcq') return examId === 'cet4' ? '仔细阅读' : '阅读理解';
  if (unit?.type === 'paragraph_ordering') return 'Part B 段落排序';
  if (unit?.type === 'matching') {
    if (unit?.matchingVariant === 'banked_cloze') return '选词填空';
    if (unit?.matchingVariant === 'long_reading') return '长篇阅读';
    return 'Part B 匹配';
  }
  return unitLabel(unit, { examId });
}

function typeRowFor(unit) {
  const examId = examIdOf(unit?.bankId);
  return {
    key: unit?.type + (unit?.matchingVariant ? ':' + unit.matchingVariant : ''),
    type: unit?.type || '',
    variant: unit?.matchingVariant || null,
    label: typeLabelFor(unit, examId),
    answered: 0,
    correct: 0,
    accuracy: null
  };
}

const responseRows = (responsesByAttempt, attemptId) => {
  if (responsesByAttempt instanceof Map) return responsesByAttempt.get(attemptId) || [];
  return responsesByAttempt?.[attemptId] || [];
};

const paperContent = record => record?.content || record || {};
const paperIdentity = value => `${value?.bankId || ''}:${value?.paperKey || ''}`;
const unitIdentity = (bankId, unitKey) => `${bankId || ''}:${unitKey || ''}`;

function buildContentIndex(papers) {
  const paperByKey = new Map();
  const unitByKey = new Map();
  const questionByKey = new Map();
  for (const record of Array.isArray(papers) ? papers : []) {
    const content = paperContent(record);
    const paper = {
      ...content,
      bankId: record?.bankId || content.bankId,
      paperKey: record?.paperKey || content.paperKey,
      year: Number(record?.year || content.year) || null,
      title: record?.title || content.title || ''
    };
    paperByKey.set(paperIdentity(paper), paper);
    for (const unit of paper.units || []) {
      const indexedUnit = { ...unit, bankId: paper.bankId, paperKey: paper.paperKey, year: paper.year };
      unitByKey.set(unitIdentity(paper.bankId, unit.unitKey), indexedUnit);
      for (const question of unit.questions || []) {
        questionByKey.set(`${paper.bankId}:${question.questionKey}`, { ...question, unit: indexedUnit, paper });
      }
    }
  }
  return { paperByKey, unitByKey, questionByKey };
}

const percent = (correct, answered) => answered > 0 ? Math.round(correct / answered * 100) : null;
const activityTime = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const eventTime = value => Number(
  value?.submittedAt
  || value?.updatedAt
  || value?.lastWrongAt
  || value?.lastReviewedAt
  || value?.masteredAt
  || value?.startedAt
  || value?.createdAt
) || 0;
const dayKey = value => new Date(value).toISOString().slice(0, 10);

function questionNumberFor(questionKey, indexedQuestion) {
  const explicit = indexedQuestion?.blankNumber ?? indexedQuestion?.slotNumber ?? indexedQuestion?.segmentKey;
  if (explicit !== null && explicit !== undefined && String(explicit).trim()) return String(explicit);
  const digits = String(questionKey || '').match(/(\d+)(?!.*\d)/)?.[1];
  return digits || String(questionKey || '').slice(0, 24);
}

function emptyTotals() {
  return {
    completedAttempts: 0,
    inProgressAttempts: 0,
    objectiveAnswered: 0,
    objectiveCorrect: 0,
    objectiveAccuracy: null,
    translationSegments: 0,
    activeDurationMs: 0
  };
}

function emptyReview() {
  return {
    activeWrong: 0,
    longestUnreviewedMs: 0,
    completedReviewCount: 0,
    masteredWrong: 0,
    translationNeedsReview: 0,
    translationMostlyMastered: 0,
    translationMastered: 0
  };
}

export function buildExamLearningAnalytics({
  papers = [],
  attempts = [],
  responsesByAttempt = {},
  wrongStates = [],
  translationReviews = [],
  now = Date.now(),
  year = null,
  examIds = ['kaoyan_en1'],
  recentLimit = 5,
  wrongLimit = 5
} = {}) {
  const { paperByKey, unitByKey, questionByKey } = buildContentIndex(papers);
  const availableYears = [...new Set([...paperByKey.values()].map(paper => paper.year).filter(Number.isFinite))]
    .sort((left, right) => right - left);
  const requestedYear = year === null || year === undefined || year === '' ? null : Number(year);
  const hasRequestedYear = Number.isInteger(requestedYear);
  const status = !availableYears.length
    ? 'unavailable'
    : hasRequestedYear && !availableYears.includes(requestedYear)
      ? 'year_unavailable'
      : 'available';
  const matchesYear = value => {
    if (!hasRequestedYear) return true;
    return paperByKey.get(paperIdentity(value))?.year === requestedYear;
  };
  const ordinaryAttempts = (Array.isArray(attempts) ? attempts : [])
    .filter(attempt => !['review_center_due', 'review_center_manual'].includes(attempt?.practiceOrigin))
    .filter(attempt => paperByKey.has(paperIdentity(attempt)))
    .filter(matchesYear);
  const submittedAttempts = ordinaryAttempts.filter(attempt => attempt.status === 'submitted');
  const totals = emptyTotals();
  totals.completedAttempts = submittedAttempts.length;
  totals.inProgressAttempts = ordinaryAttempts.filter(attempt => attempt.status === 'in_progress').length;
  totals.activeDurationMs = submittedAttempts.reduce((sum, attempt) => sum + activityTime(attempt.activeDurationMs), 0);

  const typeRows = new Map();
  const attemptMetrics = new Map();
  for (const attempt of ordinaryAttempts) {
    const metric = { objectiveAnswered: 0, objectiveCorrect: 0, translationSegments: 0 };
    if (attempt.status === 'submitted') {
      for (const response of responseRows(responsesByAttempt, attempt.attemptId)) {
        const unit = unitByKey.get(unitIdentity(attempt.bankId, response.unitKey || attempt.currentUnitKey || attempt.unitKey));
        if (typeof response.correct === 'boolean') {
          metric.objectiveAnswered += 1;
          metric.objectiveCorrect += Number(response.correct);
          if (unit?.type) {
            const key = unit.type + (unit.matchingVariant ? ':' + unit.matchingVariant : '');
            let type = typeRows.get(key);
            if (!type) {
              type = typeRowFor(unit);
              typeRows.set(key, type);
            }
            type.answered += 1;
            type.correct += Number(response.correct);
          }
        } else if (unit?.type === 'translation' && String(response?.value?.text || '').trim()) {
          metric.translationSegments += 1;
        }
      }
      totals.objectiveAnswered += metric.objectiveAnswered;
      totals.objectiveCorrect += metric.objectiveCorrect;
      totals.translationSegments += metric.translationSegments;
    }
    attemptMetrics.set(attempt.attemptId, metric);
  }
  for (const indexedUnit of unitByKey.values()) {
    if (!indexedUnit?.type) continue;
    const key = indexedUnit.type + (indexedUnit.matchingVariant ? ':' + indexedUnit.matchingVariant : '');
    if (!typeRows.has(key)) typeRows.set(key, typeRowFor(indexedUnit));
  }
  totals.objectiveAccuracy = percent(totals.objectiveCorrect, totals.objectiveAnswered);
  const byType = [...typeRows.values()].map(item => ({ ...item, accuracy: percent(item.correct, item.answered) }));

  const trendByDay = new Map();
  for (const attempt of submittedAttempts) {
    const timestamp = eventTime(attempt);
    if (!timestamp) continue;
    const key = dayKey(timestamp);
    const row = trendByDay.get(key) || { date: key, attempts: 0, objectiveAnswered: 0, objectiveCorrect: 0, accuracy: null, activeDurationMs: 0 };
    const metric = attemptMetrics.get(attempt.attemptId) || {};
    row.attempts += 1;
    row.objectiveAnswered += metric.objectiveAnswered || 0;
    row.objectiveCorrect += metric.objectiveCorrect || 0;
    row.activeDurationMs += activityTime(attempt.activeDurationMs);
    trendByDay.set(key, row);
  }
  const trend = [...trendByDay.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-30)
    .map(item => ({ ...item, accuracy: percent(item.objectiveCorrect, item.objectiveAnswered) }));

  const recentAttempts = ordinaryAttempts
    .filter(attempt => attempt.status === 'submitted' || attempt.status === 'in_progress')
    .sort((left, right) => eventTime(right) - eventTime(left))
    .slice(0, Math.max(0, Number(recentLimit) || 0))
    .map(attempt => {
      const paper = paperByKey.get(paperIdentity(attempt));
      const unit = unitByKey.get(unitIdentity(attempt.bankId, attempt.currentUnitKey || attempt.unitKey));
      const metric = attemptMetrics.get(attempt.attemptId) || {};
      return {
        attemptId: attempt.attemptId,
        bankId: attempt.bankId || null,
        examLabel: examDisplayName(examIdOf(attempt.bankId), attempt.bankId),
        year: paper?.year || null,
        paperTitle: paper?.title || '',
        unitType: attempt.practiceKind === 'full_paper' ? 'full_paper' : unit?.type || null,
        unitTitle: attempt.practiceKind === 'full_paper' ? '整卷练习' : unit ? unitLabel(unit, { examId: examIdOf(attempt.bankId) }) : '真题练习',
        practiceKind: attempt.practiceKind || 'unit',
        status: attempt.status,
        updatedAt: eventTime(attempt),
        activeDurationMs: activityTime(attempt.activeDurationMs),
        objectiveAnswered: metric.objectiveAnswered || 0,
        objectiveAccuracy: percent(metric.objectiveCorrect || 0, metric.objectiveAnswered || 0)
      };
    });

  const scopedWrongStates = (Array.isArray(wrongStates) ? wrongStates : []).filter(matchesYear);
  const scopedTranslationReviews = (Array.isArray(translationReviews) ? translationReviews : []).filter(matchesYear);
  const review = emptyReview();
  review.activeWrong = scopedWrongStates.filter(item => item.status === 'active').length;
  const activeWrongStates = scopedWrongStates.filter(item => item.status === 'active');
  review.longestUnreviewedMs = activeWrongStates.reduce((longest, item) => {
    const baseline = Number(item.lastReviewedAt || item.firstAddedAt || item.createdAt || item.updatedAt || now);
    return Math.max(longest, Math.max(0, now - baseline));
  }, 0);
  review.completedReviewCount = scopedWrongStates.reduce((sum, item) => sum + (Number(item.reviewCount) || 0), 0);
  review.masteredWrong = scopedWrongStates.filter(item => item.status === 'mastered').length;
  review.translationNeedsReview = scopedTranslationReviews.filter(item => item.status === 'needs_review').length;
  review.translationMostlyMastered = scopedTranslationReviews.filter(item => item.status === 'mostly_mastered').length;
  review.translationMastered = scopedTranslationReviews.filter(item => item.status === 'mastered').length;

  const wrongSummary = scopedWrongStates
    .filter(item => item.status === 'active')
    .sort((left, right) => eventTime(right) - eventTime(left))
    .slice(0, Math.max(0, Number(wrongLimit) || 0))
    .map(item => {
      const paper = paperByKey.get(paperIdentity(item));
      const unit = unitByKey.get(unitIdentity(item.bankId, item.unitKey));
      const question = questionByKey.get(`${item.bankId}:${item.questionKey}`);
      return {
        bankId: item.bankId || null,
        examLabel: examDisplayName(examIdOf(item.bankId), item.bankId),
        year: paper?.year || null,
        type: unit?.type || null,
        typeLabel: unit ? typeLabelFor(unit, examIdOf(item.bankId)) : '真题',
        questionNumber: questionNumberFor(item.questionKey, question),
        status: item.status,
        reviewCount: Number(item.reviewCount) || 0,
        unreviewedMs: Math.max(0, now - Number(item.lastReviewedAt || item.firstAddedAt || item.createdAt || item.updatedAt || now)),
        updatedAt: eventTime(item)
      };
    });

  return {
    source: 'exam_learning_overview',
    status,
    scope: { examIds: [...examIds], year: hasRequestedYear ? requestedYear : null },
    availableYears,
    totals,
    byType,
    trend,
    review,
    recentAttempts,
    wrongSummary
  };
}
