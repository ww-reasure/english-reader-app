import assert from 'node:assert/strict';
import test from 'node:test';
import { ActivityType } from '../src/learning-activity.mjs';
import { DailyLearningReportService } from '../src/daily-learning-report-service.mjs';
import { buildDailyLearningReport } from '../src/daily-learning-report.mjs';

const DATE_KEY = '2026-08-24';
const NOW = new Date(2026, 7, 24, 23, 30).getTime();
const at = (hour, minute = 0) => new Date(2026, 7, 24, hour, minute).getTime();

function sourceStatus(overrides = {}) {
  return {
    articles: 'empty',
    readingStats: 'empty',
    learnWords: 'empty',
    activities: 'empty',
    reviewEvents: 'empty',
    examFacts: 'available',
    recentReports: 'empty',
    ...overrides
  };
}

function reportInput(overrides = {}) {
  return {
    dateKey: DATE_KEY,
    now: NOW,
    articles: [],
    readingStats: [],
    learnWords: [],
    reviewEvents: [],
    activities: [],
    papers: [],
    attempts: [],
    responsesByAttempt: {},
    wrongStates: [],
    translationReviews: [],
    recentReports: [],
    sourceStatus: sourceStatus(),
    ...overrides
  };
}

function createService({ db = {}, examProvider = {} } = {}) {
  const baseDb = {
    async getAllArticles() { return []; },
    async getAllReadingStats() { return []; },
    async getAllLearnWords() { return []; },
    async listLearningActivities() { return []; },
    async listDailyLearningReports() { return []; },
    async getAllReviewEvents() { return []; }
  };
  const baseExamProvider = {
    async getDailyFacts() {
      return { papers: [], attempts: [], responsesByAttempt: {}, wrongStates: [], translationReviews: [] };
    }
  };
  return new DailyLearningReportService({
    db: { ...baseDb, ...db },
    examProvider: { ...baseExamProvider, ...examProvider },
    now: () => NOW
  });
}

test('a healthy source with records is available', () => {
  const report = buildDailyLearningReport(reportInput({
    activities: [{
      id: 'import-1',
      type: ActivityType.WORD_IMPORT_DAILY,
      occurredAt: at(8),
      dayKey: DATE_KEY,
      payload: { lemma: 'stable', status: 'new', source: 'pdf' }
    }],
    sourceStatus: sourceStatus({ activities: 'available' })
  }));

  assert.equal(report.completeness.vocabulary, 'available');
});

test('healthy sources with no records are empty rather than unavailable', () => {
  const report = buildDailyLearningReport(reportInput());

  assert.deepEqual(report.completeness, {
    vocabulary: 'empty',
    reading: 'empty',
    wordReview: 'empty',
    exam: 'empty',
    trends: 'empty'
  });
});

test('a healthy exam source with no activity today is empty', () => {
  const report = buildDailyLearningReport(reportInput({
    papers: [{ bankId: 'cet4', paperKey: '2024-1', year: 2024, units: [] }]
  }));

  assert.equal(report.completeness.exam, 'empty');
});

test('a database read failure is unavailable rather than an empty result', async () => {
  const service = createService({
    db: {
      async getAllLearnWords() { throw new Error('IndexedDB unavailable'); }
    }
  });

  const facts = await service.loadFacts(DATE_KEY);
  const report = buildDailyLearningReport(facts);

  assert.equal(report.completeness.vocabulary, 'unavailable');
});

test('a failed source with surviving same-category data is partial', async () => {
  const service = createService({
    db: {
      async getAllLearnWords() { throw new Error('IndexedDB unavailable'); },
      async listLearningActivities() {
        return [{
          id: 'import-1',
          type: ActivityType.WORD_IMPORT_DAILY,
          occurredAt: at(8),
          dayKey: DATE_KEY,
          payload: { lemma: 'stable', status: 'new', source: 'pdf' }
        }];
      }
    }
  });

  const facts = await service.loadFacts(DATE_KEY);
  const report = buildDailyLearningReport(facts);

  assert.equal(report.completeness.vocabulary, 'partial');
});

test('category statuses remain independent', () => {
  const report = buildDailyLearningReport(reportInput({
    activities: [{
      id: 'lookup-1',
      type: ActivityType.READING_WORD_LOOKUP,
      occurredAt: at(9),
      dayKey: DATE_KEY,
      payload: { lemma: 'stable' }
    }, {
      id: 'review-1',
      type: ActivityType.REVIEW_SESSION_SUMMARY,
      occurredAt: at(10),
      dayKey: DATE_KEY,
      payload: { mode: 'flashcard', counts: { known: 1 } }
    }],
    sourceStatus: sourceStatus({
      activities: 'available',
      reviewEvents: 'unavailable'
    })
  }));

  assert.equal(report.completeness.reading, 'available');
  assert.equal(report.completeness.wordReview, 'partial');
  assert.equal(report.completeness.exam, 'empty');
});

test('activity detail distinguishes an empty read from a failed read', async () => {
  const emptyDetail = await createService().getActivityDetail({ dateKey: DATE_KEY, category: 'lookup' });
  assert.equal(emptyDetail.completeness, 'empty');

  const failedDetail = await createService({
    db: {
      async listLearningActivities() { throw new Error('IndexedDB unavailable'); }
    }
  }).getActivityDetail({ dateKey: DATE_KEY, category: 'lookup' });
  assert.equal(failedDetail.completeness, 'unavailable');
});

test('recent reports are available when history is read successfully', async () => {
  const service = createService({
    db: {
      async listDailyLearningReports() {
        return [{ dateKey: DATE_KEY, updatedAt: NOW }];
      }
    }
  });

  const result = await service.listRecent();

  assert.equal(result.status, 'available');
  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0].dateKey, DATE_KEY);
});

test('recent reports are empty when history is read successfully with no rows', async () => {
  const result = await createService().listRecent();

  assert.deepEqual(result, { status: 'empty', reports: [] });
});

test('recent reports are unavailable when history cannot be read', async () => {
  const service = createService({
    db: {
      async listDailyLearningReports() {
        throw new Error('IndexedDB unavailable');
      }
    }
  });

  const result = await service.listRecent();

  assert.deepEqual(result, { status: 'unavailable', reports: [] });
});
