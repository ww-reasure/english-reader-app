import assert from 'node:assert/strict';
import test from 'node:test';
import { ActivityType } from '../src/learning-activity.mjs';
import { DailyLearningReportService } from '../src/daily-learning-report-service.mjs';

const DATE_KEY = '2026-08-24';
const NOW = new Date(2026, 7, 24, 12).getTime();
const at = (hour, minute = 0) => new Date(2026, 7, 24, hour, minute).getTime();

function createFixture({ analyze = null, learnWords = [], reviewEvents = [] } = {}) {
  const activities = [{
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

const successfulAnalysis = async () => ({
  summary: '今天完成了稳定的学习。',
  observations: ['查词记录清晰。', '学习节奏稳定。'],
  nextActions: ['明天完成一次复习。', '继续记录阅读时长。']
});

test('same fingerprint reuses the stored analysis without another AI request', async () => {
  let aiCalls = 0;
  const { service } = createFixture({ analyze: async (...args) => {
    aiCalls += 1;
    return successfulAnalysis(...args);
  } });

  await service.getOrCreate(DATE_KEY, { withAnalysis: true });
  const second = await service.getOrCreate(DATE_KEY, { withAnalysis: true });

  assert.equal(aiCalls, 1);
  assert.equal(second.analysisStatus, 'available');
});

test('changed facts update the same dateKey and request a new analysis', async () => {
  let aiCalls = 0;
  const { service, activities } = createFixture({ analyze: async () => {
    aiCalls += 1;
    return successfulAnalysis();
  } });

  const first = await service.getOrCreate(DATE_KEY, { withAnalysis: true });
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
  assert.equal(aiCalls, 2);
});

test('AI failure preserves deterministic Markdown and is retryable', async () => {
  let aiCalls = 0;
  const { service } = createFixture({ analyze: async () => {
    aiCalls += 1;
    throw new Error('network down');
  } });

  const report = await service.getOrCreate(DATE_KEY, { withAnalysis: true });
  const retry = await service.getOrCreate(DATE_KEY, { withAnalysis: true });

  assert.equal(report.analysisStatus, 'unavailable');
  assert.match(report.markdown, /本地学习记录/);
  assert.equal(retry.analysisStatus, 'unavailable');
  assert.equal(aiCalls, 2);
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
  assert.equal(recent.length <= 30, true);
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
