import { ActivityType, Completeness, normalizeLemma } from './learning-activity.mjs';
import { localDayBounds, localDayKey } from './learning-day.mjs';
import { examDisplayName, resolveExamIdForBank, unitLabel } from './exam/exam-context.mjs';

export const DAILY_REPORT_SCHEMA_VERSION = 1;

const DAY_MS = 24 * 60 * 60 * 1000;
const REVIEW_ORIGINS = new Set(['review_center_due', 'review_center_manual']);
const SOURCE_PRIORITY = new Map([['pdf', 0], ['reading', 1], ['other', 2]]);

const asArray = value => Array.isArray(value) ? value : [];
const numberOrZero = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const positiveNumber = value => Math.max(0, numberOrZero(value));
const text = value => String(value ?? '').trim();
const COMPLETENESS_VALUES = new Set([
  Completeness.AVAILABLE,
  Completeness.EMPTY,
  Completeness.PARTIAL,
  Completeness.UNAVAILABLE
]);
const compareText = (left, right) => {
  const a = text(left);
  const b = text(right);
  return a < b ? -1 : a > b ? 1 : 0;
};

function firstTimestamp(value = {}) {
  for (const key of ['occurredAt', 'endedAt', 'submittedAt', 'reviewedAt', 'createdAt', 'updatedAt', 'startedAt', 'finishedAt', 'lastWrongAt', 'masteredAt']) {
    const timestamp = Number(value?.[key]);
    if (Number.isFinite(timestamp) && timestamp > 0) return timestamp;
  }
  return 0;
}

function validDayKey(value) {
  const candidate = text(value);
  if (!candidate) return '';
  try {
    localDayBounds(candidate);
    return candidate;
  } catch {
    return '';
  }
}

function dayKeyOf(value = {}) {
  const explicit = validDayKey(value.dayKey);
  if (explicit) return explicit;
  const timestamp = firstTimestamp(value);
  if (!timestamp) return '';
  try {
    return localDayKey(timestamp);
  } catch {
    return '';
  }
}

function occurredAtOf(value = {}) {
  return firstTimestamp(value);
}

function belongsToDay(value, dateKey) {
  return dayKeyOf(value) === dateKey;
}

function sortByTimeAndLemma(left, right) {
  const timeDiff = occurredAtOf(left) - occurredAtOf(right);
  if (timeDiff) return timeDiff;
  return compareText(left.lemma || left.word, right.lemma || right.word);
}

function normalizeSource(value) {
  const source = text(value).toLowerCase();
  if (!source) return 'other';
  if (/pdf|file|import|上传|导入/.test(source)) return 'pdf';
  if (/read|article|reading|阅读/.test(source)) return 'reading';
  return source;
}

function sourceOf(value = {}, fallback = 'other') {
  const payload = value.payload || value.provenance || {};
  return normalizeSource(
    value.source
    || value.createdSource
    || value.origin
    || payload.source
    || payload.createdSource
    || fallback
  );
}

function lemmaOf(value = {}, learnWordById = new Map()) {
  const payload = value.payload || {};
  const fromId = learnWordById.get(value.wordId);
  return normalizeLemma(
    value.lemma
    || value.word
    || payload.lemma
    || payload.word
    || fromId?.word
    || ''
  );
}

function activityPayload(activity) {
  return activity?.payload && typeof activity.payload === 'object' ? activity.payload : {};
}

function activityKey(activity) {
  return text(activity?.dedupeKey || activity?.id || activity?.sessionId);
}

function latestByKey(records, keyOf = activityKey) {
  const map = new Map();
  for (const [index, record] of records.entries()) {
    const key = keyOf(record) || `record:${index}`;
    const previous = map.get(key);
    if (!previous || occurredAtOf(record) >= occurredAtOf(previous)) map.set(key, record);
  }
  return [...map.values()].sort(sortByTimeAndLemma);
}

function paperContent(record = {}) {
  const content = record.content && typeof record.content === 'object' ? record.content : record;
  return {
    ...content,
    bankId: record.bankId || content.bankId || '',
    paperKey: record.paperKey || content.paperKey || '',
    examId: record.examId || content.examId || resolveExamIdForBank(record.bankId || content.bankId) || '',
    year: Number(record.year || content.year) || null,
    title: record.title || content.title || '',
    units: asArray(content.units)
  };
}

function paperIdentity(value = {}) {
  return `${text(value.bankId)}:${text(value.paperKey)}`;
}

function explicitSourceStatus(input, key) {
  const candidate = text(input?.sourceStatus?.[key]).toLowerCase();
  if (candidate === 'complete') return Completeness.AVAILABLE;
  return COMPLETENESS_VALUES.has(candidate) ? candidate : null;
}

function inferredSourceStatus(input, key, value) {
  const explicit = explicitSourceStatus(input, key);
  if (explicit) return explicit;
  if (!Object.prototype.hasOwnProperty.call(input, key)) return Completeness.UNAVAILABLE;
  return asArray(value).length ? Completeness.AVAILABLE : Completeness.EMPTY;
}

function completenessForSources(statuses, hasData) {
  const values = statuses.filter(Boolean);
  if (values.includes(Completeness.UNAVAILABLE)) {
    return hasData ? Completeness.PARTIAL : Completeness.UNAVAILABLE;
  }
  if (values.includes(Completeness.PARTIAL)) {
    return hasData ? Completeness.PARTIAL : Completeness.UNAVAILABLE;
  }
  return hasData ? Completeness.AVAILABLE : Completeness.EMPTY;
}

function typeKeyOf(unit = {}) {
  return `${text(unit.type) || 'unknown'}${unit.matchingVariant ? `:${text(unit.matchingVariant)}` : ''}`;
}

function typeLabelOf(unit = {}, paper = {}) {
  const examId = paper.examId || resolveExamIdForBank(paper.bankId) || '';
  if (unit.type === 'reading_mcq' && examId === 'cet4') return '仔细阅读';
  return unitLabel(unit, { examId, bankId: paper.bankId });
}

function paperDateForAttempt(attempt) {
  return dayKeyOf({
    dayKey: attempt?.dayKey,
    submittedAt: attempt?.submittedAt,
    updatedAt: attempt?.updatedAt,
    createdAt: attempt?.createdAt
  });
}

function responseRows(responsesByAttempt, attemptId) {
  if (responsesByAttempt instanceof Map) return asArray(responsesByAttempt.get(attemptId));
  return asArray(responsesByAttempt?.[attemptId]);
}

function hasAnswer(response = {}) {
  if (response.unanswered === true || response.answerPresent === false) return false;
  if (response.answerPresent === true) return true;
  for (const candidate of [response.answer, response.selectedAnswer, response.selected, response.choice, response.option, response.value?.choice]) {
    if (candidate !== null && candidate !== undefined && text(candidate)) return true;
  }
  return false;
}

function translationTextOf(response = {}) {
  return text(response.value?.text || response.text || response.answer || '');
}

function getPaperMaps(papers) {
  const paperMap = new Map();
  const unitMap = new Map();
  for (const record of asArray(papers)) {
    const paper = paperContent(record);
    const paperKey = paperIdentity(paper);
    if (!paperKey || paperKey === ':') continue;
    paperMap.set(paperKey, paper);
    for (const unit of paper.units) {
      const key = `${paperKey}:${text(unit.unitKey)}`;
      unitMap.set(key, { ...unit, bankId: paper.bankId, paperKey: paper.paperKey });
    }
  }
  return { paperMap, unitMap };
}

function buildVocabulary({ dateKey, activities, learnWords, reviewEvents, sourceStatus = {} }) {
  const dayActivities = asArray(activities).filter(item => belongsToDay(item, dateKey));
  const dayImports = dayActivities.filter(item => item.type === ActivityType.WORD_IMPORT_DAILY || item.type === ActivityType.WORD_IMPORT_BATCH);
  const daySaves = latestByKey(dayActivities.filter(item => item.type === ActivityType.READING_WORD_SAVED));
  const learnWordById = new Map(asArray(learnWords).map(word => [word.id, word]));

  const newCandidates = [];
  for (const activity of dayImports) {
    const payload = activityPayload(activity);
    if (activity.type === ActivityType.WORD_IMPORT_BATCH) {
      for (const lemma of asArray(payload.categories?.new)) {
        newCandidates.push({ lemma: normalizeLemma(lemma), source: normalizeSource(payload.source || 'pdf'), occurredAt: occurredAtOf(activity), id: activity.id });
      }
    } else if (payload.status === 'new' || payload.status === 'created') {
      newCandidates.push({ lemma: lemmaOf(payload), source: sourceOf(payload, 'pdf'), occurredAt: occurredAtOf(activity), id: activity.id });
    }
  }
  for (const activity of daySaves) {
    const payload = activityPayload(activity);
    if (payload.createdLearnWord === false) continue;
    newCandidates.push({ lemma: lemmaOf(payload), source: sourceOf(payload, 'reading'), occurredAt: occurredAtOf(activity), id: activity.id });
  }
  for (const word of asArray(learnWords)) {
    if (!belongsToDay(word, dateKey)) continue;
    newCandidates.push({
      lemma: lemmaOf(word),
      source: sourceOf(word),
      occurredAt: occurredAtOf(word),
      id: word.id
    });
  }

  const newByLemma = new Map();
  for (const candidate of newCandidates.filter(item => item.lemma)) {
    const previous = newByLemma.get(candidate.lemma);
    const candidatePriority = SOURCE_PRIORITY.get(candidate.source) ?? 3;
    const previousPriority = SOURCE_PRIORITY.get(previous?.source) ?? 3;
    if (!previous || occurredAtOf(candidate) < occurredAtOf(previous) || (occurredAtOf(candidate) === occurredAtOf(previous) && candidatePriority < previousPriority)) {
      newByLemma.set(candidate.lemma, candidate);
    }
  }
  const newDetails = [...newByLemma.values()].sort(sortByTimeAndLemma);
  const newBySource = {};
  for (const item of newDetails) newBySource[item.source] = (newBySource[item.source] || 0) + 1;

  const externalCandidates = [];
  for (const activity of dayImports) {
    const payload = activityPayload(activity);
    if (activity.type !== ActivityType.WORD_IMPORT_DAILY || payload.status !== 'external_review') continue;
    externalCandidates.push({
      lemma: lemmaOf(payload, learnWordById),
      occurredAt: occurredAtOf(activity),
      scheduleChanged: Boolean(payload.scheduleChanged),
      reason: text(payload.reason),
      id: activity.id,
      dedupeKey: text(activity.dedupeKey)
    });
  }
  for (const event of asArray(reviewEvents)) {
    if (!belongsToDay(event, dateKey) || event.source !== 'external-import') continue;
    const eventTime = occurredAtOf(event);
    const matchingActivity = externalCandidates.find(candidate => candidate.lemma && Math.abs(occurredAtOf(candidate) - eventTime) <= 1000);
    externalCandidates.push({
      lemma: lemmaOf(event, learnWordById) || matchingActivity?.lemma || '',
      occurredAt: eventTime,
      scheduleChanged: Boolean(event.scheduleChanged),
      reason: text(event.reason),
      id: event.id,
      dedupeKey: ''
    });
  }
  const externalByKey = new Map();
  for (const item of externalCandidates) {
    const key = item.lemma ? `${dateKey}:${item.lemma}` : `${dateKey}:event:${item.id}`;
    const previous = externalByKey.get(key);
    if (!previous || occurredAtOf(item) < occurredAtOf(previous)) externalByKey.set(key, item);
  }
  const externalDetails = [...externalByKey.values()].sort(sortByTimeAndLemma);

  const ignoredDetails = dayImports
    .filter(activity => activity.type === ActivityType.WORD_IMPORT_DAILY && activityPayload(activity).status === 'today_ignored')
    .map(activity => ({ lemma: lemmaOf(activityPayload(activity)), occurredAt: occurredAtOf(activity), id: activity.id }))
    .filter(item => item.lemma)
    .sort(sortByTimeAndLemma);

  const lookups = latestByKey(dayActivities.filter(activity => activity.type === ActivityType.READING_WORD_LOOKUP))
    .map(activity => ({
      lemma: lemmaOf(activityPayload(activity)),
      occurredAt: occurredAtOf(activity),
      articleId: activityPayload(activity).articleId ?? null,
      articleTitle: text(activityPayload(activity).articleTitle),
      id: activity.id
    }))
    .filter(item => item.lemma)
    .sort(sortByTimeAndLemma);
  const lookupCounts = new Map();
  for (const lookup of lookups) lookupCounts.set(lookup.lemma, (lookupCounts.get(lookup.lemma) || 0) + 1);
  const repeatedLookups = [...lookupCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([lemma, count]) => ({ lemma, count }))
    .sort((left, right) => compareText(left.lemma, right.lemma));

  const formalReviewEvents = asArray(reviewEvents).filter(event => belongsToDay(event, dateKey) && event.source !== 'external-import');
  const hasData = Boolean(
    newDetails.length
    || externalDetails.length
    || ignoredDetails.length
    || lookups.length
    || daySaves.length
    || formalReviewEvents.length
  );
  const completeness = completenessForSources([
    sourceStatus.activities,
    sourceStatus.learnWords,
    sourceStatus.reviewEvents
  ], hasData);

  return {
    completeness,
    newUnique: newDetails.length,
    newBySource,
    newWords: newDetails.map(item => item.lemma),
    newWordDetails: newDetails,
    externalReviewed: externalDetails.length,
    externalReviewWords: externalDetails.map(item => item.lemma),
    externalReviewDetails: externalDetails,
    scheduleAdjusted: externalDetails.filter(item => item.scheduleChanged).length,
    scheduleAlreadyLater: externalDetails.filter(item => item.reason === 'existing_schedule_later' || !item.scheduleChanged).length,
    recoveryContacts: externalDetails.filter(item => item.reason === 'recovery').length,
    stubbornContacts: externalDetails.filter(item => item.reason === 'stubborn').length,
    ignoredDuplicateCount: ignoredDetails.length,
    ignoredWords: ignoredDetails.map(item => item.lemma),
    lookupCount: lookups.length,
    distinctLookups: lookupCounts.size,
    lookupWords: [...lookupCounts.keys()].sort(compareText),
    repeatedLookups,
    lookupDetails: lookups,
    savedWordCount: daySaves.length,
    formalReviewEventCount: formalReviewEvents.length
  };
}

function buildReading({ dateKey, articles, readingStats, sourceStatus = {}, activities }) {
  const articleMap = new Map(asArray(articles).map(article => [article.id, article]));
  const dayReadings = asArray(readingStats).filter(item => belongsToDay(item, dateKey));
  const effective = dayReadings.filter(item => Number(item.qualificationVersion) >= 2 && item.completed === true);
  const incomplete = dayReadings.filter(item => !effective.includes(item));
  const readingRows = dayReadings.map(item => {
    const article = articleMap.get(item.articleId);
    const snapshot = item.articleSnapshot || {};
    return {
      articleId: item.articleId ?? null,
      title: text(snapshot.title || article?.title || '未命名文章'),
      difficulty: text(snapshot.targetTrack || snapshot.difficulty || article?.targetTrack || article?.difficulty),
      completed: effective.includes(item),
      seconds: Math.max(0, Math.round(numberOrZero(item.activeSeconds || item.elapsed))),
      wordCount: Math.max(0, Math.round(numberOrZero(item.wordCount || snapshot.wordCount))),
      wpm: Math.max(0, Math.round(numberOrZero(item.wpm))),
      occurredAt: occurredAtOf(item)
    };
  }).sort(sortByTimeAndLemma);
  const totalSeconds = effective.reduce((sum, item) => sum + Math.max(0, Math.round(numberOrZero(item.activeSeconds || item.elapsed))), 0);
  const totalWords = effective.reduce((sum, item) => sum + Math.max(0, Math.round(numberOrZero(item.wordCount || item.articleSnapshot?.wordCount))), 0);
  const totalWpm = effective.reduce((sum, item) => sum + Math.max(0, numberOrZero(item.wpm)), 0);
  const dayActivities = asArray(activities).filter(item => belongsToDay(item, dateKey));
  const lookupCount = latestByKey(dayActivities.filter(item => item.type === ActivityType.READING_WORD_LOOKUP)).length;
  const savedWordCount = latestByKey(dayActivities.filter(item => item.type === ActivityType.READING_WORD_SAVED)).length;
  const hasData = Boolean(dayReadings.length || lookupCount || savedWordCount);
  const completeness = completenessForSources([
    sourceStatus.readingStats,
    sourceStatus.activities
  ], hasData);
  return {
    completeness,
    completedCount: effective.length,
    incompleteCount: incomplete.length,
    totalSeconds,
    totalDurationMs: totalSeconds * 1000,
    totalWords,
    averageWpm: effective.length ? Math.round(totalWpm / effective.length) : 0,
    lookupCount,
    savedWordCount,
    readings: readingRows,
    incompleteReadings: readingRows.filter(item => !item.completed)
  };
}

function buildReview({ dateKey, activities, reviewEvents, sourceStatus = {} }) {
  const summaries = latestByKey(
    asArray(activities).filter(item => belongsToDay(item, dateKey) && item.type === ActivityType.REVIEW_SESSION_SUMMARY),
    item => text(item.dedupeKey || item.sessionId || item.id)
  );
  const durationByMode = {};
  const counts = { known: 0, uncertain: 0, unknown: 0, skipped: 0 };
  const recovery = { fragile: 0, relearning: 0, difficult: 0, reducedStages: 0, stubborn: 0 };
  let completedWordCount = 0;
  let durationMs = 0;
  for (const summary of summaries) {
    const payload = activityPayload(summary);
    const mode = text(payload.mode || 'unknown') || 'unknown';
    const duration = positiveNumber(payload.durationMs);
    durationByMode[mode] = (durationByMode[mode] || 0) + duration;
    durationMs += duration;
    completedWordCount += asArray(payload.completedWordIds).length;
    for (const key of Object.keys(counts)) counts[key] += Math.max(0, Math.trunc(numberOrZero(payload.counts?.[key])));
    for (const key of Object.keys(recovery)) recovery[key] += Math.max(0, Math.trunc(numberOrZero(payload.recovery?.[key])));
  }
  const ratings = asArray(reviewEvents)
    .filter(event => belongsToDay(event, dateKey) && event.source !== 'external-import')
    .reduce((result, event) => {
      const rating = text(event.rating);
      if (rating) result[rating] = (result[rating] || 0) + 1;
      return result;
    }, {});
  const hasData = Boolean(summaries.length || Object.keys(ratings).length);
  const completeness = completenessForSources([
    sourceStatus.activities,
    sourceStatus.reviewEvents
  ], hasData);
  return {
    completeness,
    sessionCount: summaries.length,
    durationMs,
    durationByMode,
    completedWordCount,
    counts,
    ratings,
    recovery,
    sessions: summaries.map(item => ({
      sessionId: text(item.sessionId || activityPayload(item).sessionId),
      mode: text(activityPayload(item).mode || 'unknown'),
      scope: text(activityPayload(item).scope || 'scheduled'),
      status: text(activityPayload(item).status || 'partial'),
      durationMs: positiveNumber(activityPayload(item).durationMs),
      completedWordCount: asArray(activityPayload(item).completedWordIds).length
    }))
  };
}

function buildExam({ dateKey, papers, attempts, responsesByAttempt, wrongStates, translationReviews, activities, sourceStatus = {} }) {
  const { paperMap, unitMap } = getPaperMaps(papers);
  const daySlices = latestByKey(
    asArray(activities).filter(item => belongsToDay(item, dateKey) && item.type === ActivityType.EXAM_ACTIVE_SLICE),
    item => text(item.dedupeKey || item.id)
  );
  const sliceAttemptIds = new Set(daySlices.map(item => text(activityPayload(item).attemptId)).filter(Boolean));
  const allAttempts = asArray(attempts);
  const dayAttempts = allAttempts.filter(attempt => {
    const paperKey = paperIdentity(attempt);
    return paperMap.has(paperKey) && (paperDateForAttempt(attempt) === dateKey || sliceAttemptIds.has(text(attempt.attemptId)));
  });
  const ordinaryAttempts = dayAttempts.filter(attempt => !REVIEW_ORIGINS.has(text(attempt.practiceOrigin)));
  const reviewAttempts = dayAttempts.filter(attempt => REVIEW_ORIGINS.has(text(attempt.practiceOrigin)));
  const grouped = new Map();
  const ensurePaper = attemptOrSlice => {
    const paperKey = paperIdentity(attemptOrSlice);
    const paper = paperMap.get(paperKey);
    if (!paper) return null;
    let group = grouped.get(paperKey);
    if (!group) {
      group = {
        bankId: paper.bankId,
        paperKey: paper.paperKey,
        year: paper.year,
        title: paper.title,
        examId: paper.examId || resolveExamIdForBank(paper.bankId) || '',
        examLabel: examDisplayName(paper.examId, paper.bankId),
        order: grouped.size,
        types: new Map(),
        practiceKinds: new Set(),
        attemptCount: 0,
        completedAttemptCount: 0,
        inProgressAttemptCount: 0
      };
      grouped.set(paperKey, group);
    }
    return group;
  };
  const ensureType = (group, unit, paper, fallback = {}) => {
    const resolvedUnit = unit || fallback;
    const key = typeKeyOf(resolvedUnit);
    let row = group.types.get(key);
    if (!row) {
      row = {
        key,
        type: text(resolvedUnit.type) || 'unknown',
        variant: resolvedUnit.matchingVariant || null,
        label: typeLabelOf(resolvedUnit, paper),
        answered: 0,
        correct: 0,
        accuracy: null,
        translationSegments: 0,
        translationCompleted: 0,
        translationReviewStatuses: [],
        activeDurationMs: 0,
        attempts: 0,
        newAttempts: 0,
        redoAttempts: 0,
        manualAttempts: 0,
        questionNumbers: [],
        order: group.types.size
      };
      group.types.set(key, row);
    }
    return row;
  };
  const typeForResponse = (paper, attempt, response) => {
    const paperKey = paperIdentity(paper);
    const unitKey = text(response.unitKey || attempt.unitKey || attempt.currentUnitKey);
    const unit = unitMap.get(`${paperKey}:${unitKey}`) || {
      unitKey,
      type: response.type || attempt.type || 'unknown',
      matchingVariant: response.matchingVariant || attempt.matchingVariant || ''
    };
    return { unit, paper };
  };

  for (const attempt of ordinaryAttempts) {
    const group = ensurePaper(attempt);
    if (!group) continue;
    group.attemptCount += 1;
    group.practiceKinds.add(text(attempt.practiceKind || 'unit'));
    if (attempt.status === 'submitted') group.completedAttemptCount += 1;
    else group.inProgressAttemptCount += 1;
    const origin = text(attempt.practiceOrigin || 'normal');
    const attemptClass = /manual/.test(origin) ? 'manualAttempts' : /wrong|redo|retry/.test(origin) ? 'redoAttempts' : 'newAttempts';
    if (attempt.status !== 'submitted') continue;
    const paper = paperMap.get(paperIdentity(attempt));
    for (const response of responseRows(responsesByAttempt, attempt.attemptId)) {
      const { unit } = typeForResponse(paper, attempt, response);
      const row = ensureType(group, unit, paper);
      row.attempts += 1;
      row[attemptClass] += 1;
      const questionNumber = response.questionNumber || response.questionNo || response.questionKey;
      if (questionNumber !== null && questionNumber !== undefined && text(questionNumber)) row.questionNumbers.push(text(questionNumber));
      if (unit.type === 'translation') {
        if (translationTextOf(response)) {
          row.translationSegments += 1;
          if (response.unanswered !== true) row.translationCompleted += 1;
        }
      } else if (typeof response.correct === 'boolean' && hasAnswer(response)) {
        row.answered += 1;
        row.correct += Number(response.correct);
      }
    }
  }

  for (const slice of daySlices) {
    const payload = activityPayload(slice);
    const group = ensurePaper(payload);
    if (!group) continue;
    const paper = paperMap.get(paperIdentity(payload));
    const unit = unitMap.get(`${paperIdentity(payload)}:${text(payload.unitKey)}`) || {
      unitKey: payload.unitKey,
      type: payload.type || text(payload.contextKey).split(':')[0] || 'unknown',
      matchingVariant: payload.matchingVariant || (text(payload.contextKey).includes(':') ? text(payload.contextKey).split(':').slice(1).join(':') : '')
    };
    const row = ensureType(group, unit, paper);
    row.activeDurationMs += positiveNumber(payload.durationMs);
  }

  for (const group of grouped.values()) {
    for (const row of group.types.values()) {
      row.accuracy = row.answered ? Math.round(row.correct / row.answered * 100) : null;
      row.questionNumbers = [...new Set(row.questionNumbers)];
      const reviewStatuses = asArray(translationReviews)
        .filter(item => belongsToDay(item, dateKey) && paperIdentity(item) === `${group.bankId}:${group.paperKey}` && typeKeyOf({ type: item.type || 'translation', matchingVariant: item.matchingVariant }) === row.key)
        .map(item => text(item.status))
        .filter(Boolean);
      row.translationReviewStatuses = [...new Set(reviewStatuses)].sort(compareText);
    }
  }

  const paperRows = [...grouped.values()]
    .sort((left, right) => left.order - right.order)
    .map(group => ({
      bankId: group.bankId,
      paperKey: group.paperKey,
      year: group.year,
      title: group.title,
      examId: group.examId,
      examLabel: group.examLabel,
      practiceKinds: [...group.practiceKinds].sort(),
      attemptCount: group.attemptCount,
      completedAttemptCount: group.completedAttemptCount,
      inProgressAttemptCount: group.inProgressAttemptCount,
      types: [...group.types.values()].sort((left, right) => left.order - right.order).map(({ order, ...row }) => row)
    }));
  const objectiveAnswered = paperRows.flatMap(paper => paper.types).reduce((sum, row) => sum + row.answered, 0);
  const objectiveCorrect = paperRows.flatMap(paper => paper.types).reduce((sum, row) => sum + row.correct, 0);
  const activeDurationMs = daySlices.reduce((sum, item) => sum + positiveNumber(activityPayload(item).durationMs), 0);
  const hasData = Boolean(paperRows.length || daySlices.length);
  const completeness = completenessForSources([
    sourceStatus.examFacts,
    sourceStatus.activities
  ], hasData);
  return {
    completeness,
    objectiveAnswered,
    objectiveCorrect,
    objectiveAccuracy: objectiveAnswered ? Math.round(objectiveCorrect / objectiveAnswered * 100) : null,
    activeDurationMs,
    papers: paperRows,
    reviewAttempts: reviewAttempts.map(attempt => ({
      attemptId: text(attempt.attemptId),
      practiceKind: text(attempt.practiceKind || 'unit'),
      practiceOrigin: text(attempt.practiceOrigin),
      bankId: text(attempt.bankId),
      paperKey: text(attempt.paperKey)
    })),
    wrongCount: asArray(wrongStates).filter(item => text(item.status) === 'active').length,
    translationReviewCount: asArray(translationReviews).filter(item => belongsToDay(item, dateKey)).length
  };
}

function dateShift(dateKey, offset) {
  const bounds = localDayBounds(dateKey);
  const date = new Date(bounds.start);
  date.setDate(date.getDate() + offset);
  return localDayKey(date.getTime());
}

function trendMetric(report = {}) {
  const types = asArray(report.exam?.papers).flatMap(paper => asArray(paper.types));
  const answered = types.reduce((sum, row) => sum + positiveNumber(row.answered), 0);
  const correct = types.reduce((sum, row) => sum + positiveNumber(row.correct), 0);
  return {
    coreStudyDurationMs: positiveNumber(report.coreStudyDurationMs ?? report.coreStudyDuration),
    readingCompletedCount: positiveNumber(report.reading?.completedCount),
    examAccuracy: answered ? Math.round(correct / answered * 100) : null
  };
}

export function buildDailyLearningTrends(reports = [], { todayKey } = {}) {
  const anchor = validDayKey(todayKey) || '1970-01-01';
  const byDate = new Map();
  for (const report of asArray(reports)) {
    const dateKey = validDayKey(report?.dateKey);
    if (dateKey) byDate.set(dateKey, report);
  }
  const sevenDays = Array.from({ length: 7 }, (_, index) => dateShift(anchor, index - 6));
  const sevenEntries = sevenDays.map(dateKey => {
    const report = byDate.get(dateKey);
    return report ? { dateKey, available: true, ...trendMetric(report) } : { dateKey, available: false };
  });
  const availableSeven = sevenEntries.filter(item => item.available);
  const average = key => {
    const values = availableSeven.map(item => item[key]).filter(value => Number.isFinite(value));
    return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  };
  const sevenDay = {
    availableDays: availableSeven.length,
    missingDays: sevenEntries.filter(item => !item.available).map(item => item.dateKey),
    averageCoreStudyDurationMs: average('coreStudyDurationMs'),
    averageReadingCompletedCount: average('readingCompletedCount'),
    averageExamAccuracy: average('examAccuracy'),
    days: sevenEntries
  };
  const thirtyDay = Array.from({ length: 30 }, (_, index) => dateShift(anchor, index - 29)).map(dateKey => {
    const report = byDate.get(dateKey);
    return report ? { dateKey, available: true, ...trendMetric(report) } : { dateKey, available: false };
  });
  return {
    sevenDay,
    thirtyDay,
    trends7d: sevenDay,
    trends30d: thirtyDay
  };
}

export function buildDailyLearningReport(input = {}) {
  const dateKey = validDayKey(input.dateKey);
  if (!dateKey) throw new TypeError('日报日期必须为 YYYY-MM-DD');
  const now = Number.isFinite(Number(input.now)) ? Number(input.now) : 0;
  const activities = asArray(input.activities);
  const learnWords = asArray(input.learnWords);
  const reviewEvents = asArray(input.reviewEvents);
  const readingStats = asArray(input.readingStats);
  const sourceStatus = {
    articles: inferredSourceStatus(input, 'articles', input.articles),
    readingStats: inferredSourceStatus(input, 'readingStats', input.readingStats),
    learnWords: inferredSourceStatus(input, 'learnWords', input.learnWords),
    activities: inferredSourceStatus(input, 'activities', input.activities),
    reviewEvents: inferredSourceStatus(input, 'reviewEvents', input.reviewEvents),
    examFacts: explicitSourceStatus(input, 'examFacts')
      || (['papers', 'attempts', 'responsesByAttempt', 'wrongStates', 'translationReviews']
        .some(key => Object.prototype.hasOwnProperty.call(input, key))
        ? Completeness.AVAILABLE
        : Completeness.UNAVAILABLE),
    recentReports: inferredSourceStatus(input, 'recentReports', input.recentReports)
  };
  const vocabulary = buildVocabulary({
    dateKey,
    activities,
    learnWords,
    reviewEvents,
    sourceStatus
  });
  const reading = buildReading({
    dateKey,
    articles: input.articles,
    readingStats,
    sourceStatus,
    activities
  });
  const wordReview = buildReview({
    dateKey,
    activities,
    reviewEvents,
    sourceStatus
  });
  const exam = buildExam({
    dateKey,
    papers: input.papers,
    attempts: input.attempts,
    responsesByAttempt: input.responsesByAttempt,
    wrongStates: input.wrongStates,
    translationReviews: input.translationReviews,
    activities,
    sourceStatus
  });
  const coreDurationBreakdown = {
    readingMs: reading.totalDurationMs,
    examMs: exam.activeDurationMs,
    flashcardMs: positiveNumber(wordReview.durationByMode.flashcard),
    contextMs: positiveNumber(wordReview.durationByMode.context),
    practiceMs: positiveNumber(wordReview.durationByMode.practice)
  };
  const coreStudyDurationMs = Object.values(coreDurationBreakdown).reduce((sum, value) => sum + value, 0);
  const trends = buildDailyLearningTrends([
    ...asArray(input.recentReports),
    {
      dateKey,
      coreStudyDurationMs,
      reading,
      exam
    }
  ], { todayKey: dateKey });
  const hasCurrentTrendData = [vocabulary, reading, wordReview, exam]
    .some(item => item.completeness === Completeness.AVAILABLE || item.completeness === Completeness.PARTIAL);
  const trendsCompleteness = completenessForSources(
    [sourceStatus.recentReports],
    Boolean(asArray(input.recentReports).length || hasCurrentTrendData)
  );
  const completeness = {
    vocabulary: vocabulary.completeness,
    reading: reading.completeness,
    wordReview: wordReview.completeness,
    exam: exam.completeness,
    trends: trendsCompleteness
  };
  return {
    dateKey,
    timezoneOffset: new Date(localDayBounds(dateKey).start).getTimezoneOffset(),
    schemaVersion: DAILY_REPORT_SCHEMA_VERSION,
    completeness,
    coreStudyDurationMs,
    coreStudyDuration: coreStudyDurationMs,
    coreDurationBreakdown,
    vocabulary,
    reading,
    wordReview,
    exam,
    trends7d: trends.sevenDay,
    trends30d: trends.thirtyDay,
    aiAnalysis: input.aiAnalysis || null,
    generatedAt: now
  };
}

function displayWords(words) {
  return asArray(words).map(item => typeof item === 'string' ? item : text(item?.lemma || item?.word)).filter(Boolean);
}

function durationLabel(durationMs) {
  const minutes = Math.round(positiveNumber(durationMs) / 60_000);
  return `${minutes} 分钟`;
}

function formatCompleteness(value) {
  if (value === Completeness.AVAILABLE || value === 'complete') return '有记录';
  if (value === Completeness.EMPTY) return '暂无记录';
  if (value === Completeness.PARTIAL) return '部分可用';
  return '数据不可用';
}

export function formatDailyLearningReportMarkdown(report = {}) {
  const vocabulary = report.vocabulary || {};
  const reading = report.reading || {};
  const wordReview = report.wordReview || {};
  const exam = report.exam || {};
  const trends7d = report.trends7d || {};
  const words = displayWords(vocabulary.newWords);
  const visibleWords = words.slice(0, 100);
  const remainder = Math.max(0, words.length - visibleWords.length);
  const lines = [
    `# 英语学习日报｜${text(report.dateKey)}`,
    '',
    '## 今日概览',
    `- 核心学习时长：${durationLabel(report.coreStudyDurationMs)}`,
    `- 数据完整性：${Object.entries(report.completeness || {}).map(([key, value]) => `${key} ${formatCompleteness(value)}`).join('；') || '不可用'}`,
    '',
    '## 词汇',
    `- 今日新增唯一词：${numberOrZero(vocabulary.newUnique)} 个`,
    `- 外部复习：${numberOrZero(vocabulary.externalReviewed)} 个；查词：${numberOrZero(vocabulary.lookupCount)} 次（${numberOrZero(vocabulary.distinctLookups)} 个不同词）`,
    `- 新增词：${visibleWords.length ? visibleWords.join('、') : '无'}`,
    ...(remainder ? [`- 其余 ${remainder} 个词未展开`] : []),
    '',
    '## 阅读',
    `- 有效完成：${numberOrZero(reading.completedCount)} 篇；未完成：${numberOrZero(reading.incompleteCount)} 篇`,
    `- 有效阅读时长：${durationLabel(reading.totalDurationMs)}；总词数：${numberOrZero(reading.totalWords)}；平均 WPM：${numberOrZero(reading.averageWpm)}`,
    '',
    '## 单词复习',
    `- 会话：${numberOrZero(wordReview.sessionCount)} 次；完成词数：${numberOrZero(wordReview.completedWordCount)}；时长：${durationLabel(wordReview.durationMs)}`,
    `- 认识 ${numberOrZero(wordReview.counts?.known)}，模糊 ${numberOrZero(wordReview.counts?.uncertain)}，忘记 ${numberOrZero(wordReview.counts?.unknown)}`,
    '',
    '## 真题训练',
    `- 客观题：${numberOrZero(exam.objectiveAnswered)} 题；正确率：${exam.objectiveAccuracy === null || exam.objectiveAccuracy === undefined ? '—' : `${exam.objectiveAccuracy}%`}`,
    `- 有效时长：${durationLabel(exam.activeDurationMs)}；翻译复核：${numberOrZero(exam.translationReviewCount)} 项`,
    ...asArray(exam.papers).flatMap(paper => [
      `- ${text(paper.examLabel || paper.examId)}｜${text(paper.title || paper.paperKey)}`,
      ...asArray(paper.types).map(type => `  - ${text(type.label || type.key)}：${type.accuracy === null || type.accuracy === undefined ? `翻译 ${numberOrZero(type.translationSegments)} 段` : `${numberOrZero(type.correct)}/${numberOrZero(type.answered)}（${type.accuracy}%）`}，${durationLabel(type.activeDurationMs)}`)
    ]),
    '',
    '## 近期趋势',
    `- 最近 7 天有记录 ${numberOrZero(trends7d.availableDays)} 天，日均核心时长：${trends7d.averageCoreStudyDurationMs === null || trends7d.averageCoreStudyDurationMs === undefined ? '—' : durationLabel(trends7d.averageCoreStudyDurationMs)}`,
    `- 缺失日期：${asArray(trends7d.missingDays).join('、') || '无'}`,
    '',
    '## 总结与明日建议'
  ];
  const aiText = text(report.aiAnalysis?.text || report.aiAnalysis?.summary);
  if (aiText) lines.push(aiText);
  else lines.push('智能分析暂不可用；以上数据由本地学习记录生成。');
  return lines.join('\n');
}

function summaryExam(exam = {}) {
  return {
    objectiveAttempted: numberOrZero(exam.objectiveAnswered),
    objectiveCorrect: numberOrZero(exam.objectiveCorrect),
    objectiveAccuracy: exam.objectiveAccuracy ?? null,
    activeDurationMs: positiveNumber(exam.activeDurationMs),
    papers: asArray(exam.papers).map(paper => ({
      examId: text(paper.examId),
      year: paper.year ?? null,
      paperKey: text(paper.paperKey),
      types: asArray(paper.types).map(type => ({
        key: text(type.key),
        label: text(type.label),
        attempted: numberOrZero(type.answered),
        correct: numberOrZero(type.correct),
        accuracy: type.accuracy ?? null,
        translationSegments: numberOrZero(type.translationSegments),
        activeDurationMs: positiveNumber(type.activeDurationMs)
      }))
    }))
  };
}

export function toDailyReportAgentSummary(report = {}) {
  const vocabulary = report.vocabulary || {};
  const reading = report.reading || {};
  const wordReview = report.wordReview || {};
  const trends7d = report.trends7d || {};
  return {
    schemaVersion: DAILY_REPORT_SCHEMA_VERSION,
    dateKey: text(report.dateKey),
    timezoneOffset: numberOrZero(report.timezoneOffset),
    completeness: { ...(report.completeness || {}) },
    coreStudyDurationMs: positiveNumber(report.coreStudyDurationMs),
    vocabulary: {
      newUnique: numberOrZero(vocabulary.newUnique),
      newBySource: { ...(vocabulary.newBySource || {}) },
      newWords: displayWords(vocabulary.newWords).slice(0, 100),
      externalReviewed: numberOrZero(vocabulary.externalReviewed),
      externalReviewWords: displayWords(vocabulary.externalReviewWords).slice(0, 100),
      lookupCount: numberOrZero(vocabulary.lookupCount),
      distinctLookups: numberOrZero(vocabulary.distinctLookups),
      repeatedLookups: asArray(vocabulary.repeatedLookups).slice(0, 100).map(item => ({ lemma: text(item.lemma), count: numberOrZero(item.count) }))
    },
    reading: {
      completedCount: numberOrZero(reading.completedCount),
      incompleteCount: numberOrZero(reading.incompleteCount),
      totalSeconds: numberOrZero(reading.totalSeconds),
      totalWords: numberOrZero(reading.totalWords),
      averageWpm: numberOrZero(reading.averageWpm),
      savedWordCount: numberOrZero(reading.savedWordCount),
      lookupCount: numberOrZero(reading.lookupCount)
    },
    wordReview: {
      sessionCount: numberOrZero(wordReview.sessionCount),
      durationMs: positiveNumber(wordReview.durationMs),
      completedWordCount: numberOrZero(wordReview.completedWordCount),
      counts: { ...(wordReview.counts || {}) },
      recovery: { ...(wordReview.recovery || {}) }
    },
    exam: summaryExam(report.exam),
    trends7d: {
      availableDays: numberOrZero(trends7d.availableDays),
      missingDays: asArray(trends7d.missingDays).slice(0, 7),
      averageCoreStudyDurationMs: trends7d.averageCoreStudyDurationMs ?? null,
      averageReadingCompletedCount: trends7d.averageReadingCompletedCount ?? null,
      averageExamAccuracy: trends7d.averageExamAccuracy ?? null
    },
    aiAnalysisAvailable: Boolean(text(report.aiAnalysis?.text || report.aiAnalysis?.summary))
  };
}

const DAILY_REPORT_STATUS_KEYS = ['vocabulary', 'reading', 'wordReview', 'exam', 'trends'];
const DAILY_REPORT_STATUSES = new Set(['available', 'empty', 'partial', 'unavailable']);

function normalizeReportStatus(value) {
  const status = text(value).toLowerCase();
  if (status === 'complete') return 'available';
  return DAILY_REPORT_STATUSES.has(status) ? status : null;
}

function reportDataStatus(report, summary) {
  const explicit = report?.dataStatus && typeof report.dataStatus === 'object' ? report.dataStatus : {};
  const completeness = summary.completeness && typeof summary.completeness === 'object'
    ? summary.completeness
    : {};
  const overall = normalizeReportStatus(report?.status)
    || (typeof summary.completeness === 'string' ? normalizeReportStatus(summary.completeness) : null)
    || 'unavailable';
  return Object.fromEntries(DAILY_REPORT_STATUS_KEYS.map(key => [
    key,
    normalizeReportStatus(explicit[key] ?? completeness[key]) || overall
  ]));
}

/**
 * Build the bounded payload exposed to the home Agent for the current-day
 * report. The full saved report remains behind the daily report artifact; the
 * tool result deliberately contains facts and status only.
 */
export function toDailyReportToolResult(report = {}) {
  const source = report && typeof report === 'object' ? report : {};
  const facts = source.facts && typeof source.facts === 'object'
    ? source.facts
    : source.data && typeof source.data === 'object'
      ? source.data
      : source;
  const summary = toDailyReportAgentSummary(facts);
  const dataStatus = reportDataStatus(source, summary);
  const dateKey = summary.dateKey || text(source.dateKey);
  const aiAnalysisAvailable = summary.aiAnalysisAvailable
    || text(source.aiAnalysis?.text || source.aiAnalysis?.summary).length > 0
    || text(source.analysisStatus).toLowerCase() === 'available';
  return {
    source: 'daily_learning_report',
    dataFingerprint: text(source.dataFingerprint).slice(0, 160),
    ...summary,
    dateKey,
    dataStatus,
    aiAnalysisAvailable
  };
}
