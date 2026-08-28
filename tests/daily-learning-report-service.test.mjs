import assert from 'node:assert/strict';
import test from 'node:test';
import { ActivityType } from '../src/learning-activity.mjs';
import { DailyLearningReportService } from '../src/daily-learning-report-service.mjs';

const DATE_KEY = '2026-08-24';
const NOW = new Date(2026, 7, 24, 12).getTime();
const at = (hour, minute = 0) => new Date(2026, 7, 24, hour, minute).getTime();

function createFixture({ analyze = null, learnWords = [], reviewEvents = [], activities: activityRecords = null } = {}) {
  const activities = activityRecords || [{
    id: 'lookup-1',
    type: ActivityType.READING_WORD_LOOKUP,
    occurredAt: at(9),
    dayKey: DATE_KEY,
    payload: { lemma: 'stable' }
  }];
  const reports = new Map();
  const pruneCalls = [];
  const learnWordReadOptions = [];
  const db = {
    async getAllArticles() { return []; },
    async getAllReadingStats() { return []; },
    async getAllLearnWords(options = {}) {
      learnWordReadOptions.push(structuredClone(options));
      return options.includeArchived
        ? structuredClone(learnWords)
        : structuredClone(learnWords.filter(word => word.archivedAt == null));
    },
    async getAllReviewEvents() { return structuredClone(reviewEvents); },
    async listLearningActivities() { return activities.slice(); },
    async listDailyLearningReports() { return [...reports.values()]; },
    async getDailyLearningReport(dateKey) { return reports.get(dateKey) || null; },
    async saveDailyLearningReport(report) {
      reports.set(report.dateKey, structuredClone(report));
      return structuredClone(report);
    },
    async deleteExpiredLearningTelemetry(args) {
      pruneCalls.push(args);
      return { reportsDeleted: 1, activitiesDeleted: 2 };
    }
  };
  const examProvider = {
    async getDailyFacts() {
      return {
        papers: [],
        attempts: [],
        responsesByAttempt: {},
        wrongStates: [],
        translationReviews: []
      };
    }
  };
  const service = new DailyLearningReportService({ db, examProvider, analyze, now: () => NOW });
  return { service, activities, reports, pruneCalls, learnWordReadOptions };
}

const savedAnalysis = {
  summary: '今天完成了稳定的学习。',
  observations: ['查词记录清晰。', '学习节奏稳定。'],
  nextActions: ['明天完成一次复习。', '继续记录阅读时长。']
};

test('history tool result includes only a bounded saved analysis when present', async () => {
  const { toDailyReportHistoryToolResult } = await import('../src/daily-learning-report.mjs');
  const result = toDailyReportHistoryToolResult({
    dateKey: DATE_KEY,
    dataFingerprint: 'sha256:history',
    facts: {
      dateKey: DATE_KEY,
      completeness: { vocabulary: 'available' },
      vocabulary: {},
      reading: {},
      wordReview: {},
      exam: {},
      trends7d: {}
    },
    aiAnalysis: {
      summary: '今天完成了稳定的学习。',
      observations: ['查词记录清晰。', '学习节奏稳定。', '第三条观察。', '第四条观察。', '不应返回第五条。'],
      nextActions: ['明天完成一次复习。', '继续记录阅读时长。', '第三条建议。', '第四条建议。', '不应返回第五条。'],
      text: '不应把完整 Markdown 文本返回给模型。'
    }
  });

  assert.deepEqual(result.aiAnalysis, {
    summary: '今天完成了稳定的学习。',
    observations: ['查词记录清晰。', '学习节奏稳定。', '第三条观察。', '第四条观察。'],
    nextActions: ['明天完成一次复习。', '继续记录阅读时长。', '第三条建议。', '第四条建议。']
  });
  assert.equal(result.aiAnalysisAvailable, true);
  assert.equal(result.markdown, undefined);
});

test('history tool result omits analysis when no saved analysis exists', async () => {
  const { toDailyReportHistoryToolResult } = await import('../src/daily-learning-report.mjs');
  const result = toDailyReportHistoryToolResult({
    dateKey: DATE_KEY,
    facts: {
      dateKey: DATE_KEY,
      completeness: { vocabulary: 'empty' },
      vocabulary: {},
      reading: {},
      wordReview: {},
      exam: {},
      trends7d: {}
    }
  });

  assert.equal(result.aiAnalysis, undefined);
  assert.equal(result.aiAnalysisAvailable, false);
});

test('same fingerprint reuses a saved analysis without calling an analyzer', async () => {
  let aiCalls = 0;
  const { service, reports } = createFixture({ analyze: async () => {
    aiCalls += 1;
    return savedAnalysis;
  } });

  const first = await service.getOrCreate(DATE_KEY);
  reports.set(DATE_KEY, {
    ...first,
    analysisStatus: 'available',
    aiAnalysis: savedAnalysis
  });
  const second = await service.getOrCreate(DATE_KEY);

  assert.equal(aiCalls, 0);
  assert.equal(second.analysisStatus, 'available');
  assert.deepEqual(second.aiAnalysis, savedAnalysis);
});

test('getOrCreate ignores the legacy analysis option and never calls an analyzer', async () => {
  let aiCalls = 0;
  const { service } = createFixture({ analyze: async () => {
    aiCalls += 1;
    return savedAnalysis;
  } });

  const result = await service.getOrCreate(DATE_KEY, { withAnalysis: true });

  assert.equal(aiCalls, 0);
  assert.equal('analyze' in service, false);
  assert.equal(result.analysisStatus, 'unavailable');
});

test('changed facts invalidate a saved analysis instead of reusing or regenerating it', async () => {
  let aiCalls = 0;
  const { service, activities, reports } = createFixture({ analyze: async () => {
    aiCalls += 1;
    return savedAnalysis;
  } });

  const first = await service.getOrCreate(DATE_KEY);
  reports.set(DATE_KEY, {
    ...first,
    analysisStatus: 'available',
    aiAnalysis: savedAnalysis
  });
  activities.push({
    id: 'lookup-2',
    type: ActivityType.READING_WORD_LOOKUP,
    occurredAt: at(10),
    dayKey: DATE_KEY,
    payload: { lemma: 'changed' }
  });
  const second = await service.getOrCreate(DATE_KEY, { withAnalysis: true });

  assert.equal(first.dateKey, second.dateKey);
  assert.notEqual(first.dataFingerprint, second.dataFingerprint);
  assert.equal(aiCalls, 0);
  assert.equal(second.analysisStatus, 'unavailable');
  assert.equal(second.aiAnalysis, null);
});

test('expired date is rejected and pruning touches only report telemetry', async () => {
  const { service, pruneCalls } = createFixture();

  await assert.rejects(() => service.getOrCreate('2026-07-25'), /已过期/);
  const result = await service.prune();

  assert.deepEqual(result, { reportsDeleted: 1, activitiesDeleted: 2 });
  assert.equal(pruneCalls.length, 1);
  assert.ok(pruneCalls[0].reportBefore > pruneCalls[0].activityBefore);
});

test('activity details are category bounded and recent reports are capped', async () => {
  const { service } = createFixture();
  const detail = await service.getActivityDetail({ dateKey: DATE_KEY, category: 'lookup', limit: 20 });
  assert.deepEqual(detail.items.map(item => item.lemma), ['stable']);
  assert.equal(detail.items[0].payload, undefined);

  const recent = await service.listRecent(100);
  assert.equal(recent.status, 'empty');
  assert.equal(recent.reports.length <= 30, true);
});

test('reading activity detail exposes bounded daily progress metadata without guide index arrays', async () => {
  const { service } = createFixture({ activities: [{
    id: 'reading-active-1',
    type: ActivityType.READING_ACTIVE_SLICE,
    occurredAt: at(10),
    dayKey: DATE_KEY,
    sessionId: 'reading:article-1:cycle-1',
    dedupeKey: 'reading-active:2026-08-24:reading:article-1:cycle-1',
    payload: {
      articleId: 'article-1',
      articleTitle: '长文章',
      completionId: 'reading:article-1:cycle-1',
      durationMs: 900_000,
      maxContentProgress: 0.47,
      guideVisitedIndexes: [1, 2, 3],
      guideVisitedCount: 3,
      lastMode: 'guide',
      completedToday: false
    }
  }] });
  const detail = await service.getActivityDetail({ dateKey: DATE_KEY, category: 'reading', limit: 20 });
  assert.equal(detail.completeness, 'available');
  assert.equal(detail.items[0].completionId, 'reading:article-1:cycle-1');
  assert.equal(detail.items[0].guideVisitedCount, 3);
  assert.equal(detail.items[0].maxContentProgress, 0.47);
  assert.equal(detail.items[0].lastMode, 'guide');
  assert.equal(detail.items[0].completedToday, false);
  assert.equal(detail.items[0].guideVisitedIndexes, undefined);
});

test('daily report resolves an archived word referenced by a historical review event', async () => {
  const { service, learnWordReadOptions } = createFixture({
    learnWords: [{ id: 4, word: 'derive', archivedAt: at(11), createdAt: at(8) }],
    reviewEvents: [{ id: 8, wordId: 4, source: 'external-import', reviewedAt: at(9), scheduleChanged: true }]
  });
  const report = await service.getOrCreate(DATE_KEY);
  assert.deepEqual(report.facts.vocabulary.externalReviewWords, ['derive']);
  assert.equal(learnWordReadOptions.some(options => options.includeArchived === true), true);
});
