import assert from 'node:assert/strict';
import test from 'node:test';

import { buildExamLearningAnalytics } from '../src/exam/learning-analytics.mjs';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 9, 12);

const papers = [
  {
    bankId: 'builtin_kaoyan_en1', paperKey: 'paper-2026', year: 2026, title: '2026 英语一',
    units: [
      { unitKey: 'cloze-2026', type: 'cloze_choice', displayTitle: '完形填空', questions: [{ questionKey: 'q1', blankNumber: 1 }] },
      { unitKey: 'reading-2026', type: 'reading_mcq', displayTitle: '阅读 Text 1', questions: [{ questionKey: 'q21' }] },
      { unitKey: 'translation-2026', type: 'translation', displayTitle: '翻译', questions: [{ questionKey: 'q46', segmentKey: '46' }] }
    ]
  },
  {
    bankId: 'builtin_kaoyan_en1', paperKey: 'paper-2025', year: 2025, title: '2025 英语一',
    units: [
      { unitKey: 'ordering-2025', type: 'paragraph_ordering', displayTitle: '段落排序', questions: [{ questionKey: 'q41', slotNumber: 41 }] }
    ]
  }
];

const attempts = [
  { attemptId: 'a1', bankId: 'builtin_kaoyan_en1', paperKey: 'paper-2026', unitKey: 'cloze-2026', practiceKind: 'unit', practiceOrigin: 'normal', status: 'submitted', submittedAt: NOW - 3 * DAY, updatedAt: NOW - 3 * DAY, activeDurationMs: 120000 },
  { attemptId: 'a2', bankId: 'builtin_kaoyan_en1', paperKey: 'paper-2026', unitKey: 'translation-2026', practiceKind: 'unit', practiceOrigin: 'normal', status: 'submitted', submittedAt: NOW - 2 * DAY, updatedAt: NOW - 2 * DAY, activeDurationMs: 180000 },
  { attemptId: 'a3', bankId: 'builtin_kaoyan_en1', paperKey: 'paper-2025', unitKey: 'ordering-2025', practiceKind: 'unit', practiceOrigin: 'normal', status: 'in_progress', updatedAt: NOW - DAY, activeDurationMs: 60000 },
  { attemptId: 'review', bankId: 'builtin_kaoyan_en1', paperKey: 'paper-2026', unitKey: 'reading-2026', practiceKind: 'unit', practiceOrigin: 'review_center_due', status: 'submitted', submittedAt: NOW, updatedAt: NOW, activeDurationMs: 90000 }
];

const responsesByAttempt = {
  a1: [
    { questionKey: 'q1', unitKey: 'cloze-2026', correct: true, unanswered: false },
    { questionKey: 'q21', unitKey: 'reading-2026', correct: false, unanswered: false }
  ],
  a2: [{ questionKey: 'q46', unitKey: 'translation-2026', correct: null, value: { text: '译文' }, unanswered: false }],
  a3: [{ questionKey: 'q41', unitKey: 'ordering-2025', correct: null, answer: 'A' }],
  review: [{ questionKey: 'q21', unitKey: 'reading-2026', correct: true, unanswered: false }]
};

const wrongStates = [
  { bankId: 'builtin_kaoyan_en1', paperKey: 'paper-2026', unitKey: 'reading-2026', questionKey: 'q21', status: 'active', nextDueAt: NOW - 1, firstAddedAt: NOW - 4 * DAY, lastReviewedAt: null, reviewCount: 3, lastWrongAt: NOW - DAY },
  { bankId: 'builtin_kaoyan_en1', paperKey: 'paper-2025', unitKey: 'ordering-2025', questionKey: 'q41', status: 'mastered', nextDueAt: null, masteredAt: NOW - DAY }
];

const translationReviews = [
  { bankId: 'builtin_kaoyan_en1', paperKey: 'paper-2026', unitKey: 'translation-2026', questionKey: 'q46', status: 'needs_review', nextDueAt: NOW - 1 }
];

test('separates objective accuracy, translation work and review-center attempts', () => {
  const result = buildExamLearningAnalytics({ papers, attempts, responsesByAttempt, wrongStates, translationReviews, now: NOW });

  assert.deepEqual(result.totals, {
    completedAttempts: 2,
    inProgressAttempts: 1,
    objectiveAnswered: 2,
    objectiveCorrect: 1,
    objectiveAccuracy: 50,
    translationSegments: 1,
    activeDurationMs: 300000
  });
  assert.equal(result.byType.find(item => item.type === 'cloze_choice').accuracy, 100);
  assert.equal(result.byType.find(item => item.type === 'reading_mcq').accuracy, 0);
  assert.equal(result.byType.find(item => item.type === 'paragraph_ordering').answered, 0);
  assert.equal(result.recentAttempts.some(item => item.attemptId === 'review'), false);
  assert.equal(result.trend.reduce((sum, item) => sum + item.objectiveAnswered, 0), 2);
});

test('reports review health and bounded metadata-only wrong summaries', () => {
  const result = buildExamLearningAnalytics({ papers, attempts, responsesByAttempt, wrongStates, translationReviews, now: NOW, wrongLimit: 1 });

  assert.deepEqual(result.review, {
    activeWrong: 1,
    longestUnreviewedMs: 4 * DAY,
    completedReviewCount: 3,
    masteredWrong: 1,
    translationNeedsReview: 1,
    translationMostlyMastered: 0,
    translationMastered: 0
  });
  assert.deepEqual(result.wrongSummary, [{
    year: 2026,
    type: 'reading_mcq',
    typeLabel: '阅读理解',
    questionNumber: '21',
    status: 'active',
    reviewCount: 3,
    unreviewedMs: 4 * DAY,
    updatedAt: NOW - DAY
  }]);
  assert.doesNotMatch(JSON.stringify(result.wrongSummary), /stem|option|answer/i);
});

test('filters by year and returns available years without inventing unavailable data', () => {
  const selected = buildExamLearningAnalytics({ papers, attempts, responsesByAttempt, wrongStates, translationReviews, now: NOW, year: 2025 });
  assert.equal(selected.status, 'available');
  assert.deepEqual(selected.scope, { examId: 'kaoyan_en1', year: 2025 });
  assert.deepEqual(selected.availableYears, [2026, 2025]);
  assert.equal(selected.totals.completedAttempts, 0);
  assert.equal(selected.totals.inProgressAttempts, 1);
  assert.equal(selected.review.masteredWrong, 1);

  const unavailable = buildExamLearningAnalytics({ papers, attempts, responsesByAttempt, wrongStates, translationReviews, now: NOW, year: 2024 });
  assert.equal(unavailable.status, 'year_unavailable');
  assert.deepEqual(unavailable.availableYears, [2026, 2025]);
  assert.equal(unavailable.totals.completedAttempts, 0);
});

test('returns a stable empty contract when no exam pack is installed', () => {
  const result = buildExamLearningAnalytics({ papers: [], attempts: [], responsesByAttempt: {}, now: NOW });
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.availableYears, []);
  assert.equal(result.totals.objectiveAccuracy, null);
  assert.deepEqual(result.recentAttempts, []);
});
