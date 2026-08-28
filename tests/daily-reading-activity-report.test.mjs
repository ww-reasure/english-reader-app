import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDailyLearningReport,
  formatDailyLearningReportMarkdown,
  toDailyReportAgentSummary
} from '../src/daily-learning-report.mjs';
import { ActivityType } from '../src/learning-activity.mjs';

const DATE_KEY = '2026-08-28';
const NOW = new Date(2026, 7, 28, 22).getTime();

const activity = ({ completionId = 'reading:article-1:cycle-1', durationMs = 17 * 60_000, completedToday = false, guideVisitedCount = 12, maxContentProgress = 0.47 } = {}) => ({
  id: `reading-active:${DATE_KEY}:${completionId}`,
  type: ActivityType.READING_ACTIVE_SLICE,
  occurredAt: NOW,
  dayKey: DATE_KEY,
  sessionId: completionId,
  dedupeKey: `reading-active:${DATE_KEY}:${completionId}`,
  payload: {
    articleId: 'article-1',
    articleTitle: 'A long article',
    completionId,
    durationMs,
    maxContentProgress,
    guideVisitedIndexes: Array.from({ length: guideVisitedCount }, (_, index) => index),
    guideVisitedCount,
    lastMode: 'guide',
    completedToday
  }
});

function baseInput(overrides = {}) {
  return {
    dateKey: DATE_KEY,
    now: NOW,
    articles: [{ id: 'article-1', title: 'A long article', targetTrack: 'cet4' }],
    readingStats: [],
    activities: [],
    learnWords: [],
    reviewEvents: [],
    papers: [],
    attempts: [],
    responsesByAttempt: {},
    wrongStates: [],
    translationReviews: [],
    recentReports: [],
    ...overrides
  };
}

test('active reading slice contributes time and in-progress count without inflating completion metrics', () => {
  const report = buildDailyLearningReport(baseInput({ activities: [activity()] }));
  assert.equal(report.reading.totalDurationMs, 17 * 60_000);
  assert.equal(report.reading.activeDurationMs, 17 * 60_000);
  assert.equal(report.reading.completedCount, 0);
  assert.equal(report.reading.inProgressCount, 1);
  assert.equal(report.reading.guideVisitedCount, 12);
  assert.equal(report.reading.totalWords, 0);
  assert.equal(report.coreDurationBreakdown.readingMs, 17 * 60_000);
  assert.equal(report.reading.readings[0].status, 'in_progress');
});

test('qualified v1 completion uses activity duration, not cumulative readingStats seconds', () => {
  const report = buildDailyLearningReport(baseInput({
    activities: [activity({ completedToday: true, durationMs: 10 * 60_000 })],
    readingStats: [{
      articleId: 'article-1',
      completionId: 'reading:article-1:cycle-1',
      qualificationVersion: 2,
      completed: true,
      activityAccountingVersion: 1,
      activeSeconds: 25 * 60,
      wordCount: 1200,
      wpm: 180,
      createdAt: NOW
    }]
  }));
  assert.equal(report.reading.totalDurationMs, 10 * 60_000);
  assert.equal(report.reading.completedCount, 1);
  assert.equal(report.reading.inProgressCount, 0);
  assert.equal(report.reading.totalWords, 1200);
  assert.equal(report.reading.averageWpm, 180);
  assert.equal(report.reading.readings.length, 1);
  assert.equal(report.reading.readings[0].status, 'completed');
});

test('legacy qualified reading stats remain visible in historical duration totals', () => {
  const report = buildDailyLearningReport(baseInput({
    readingStats: [{
      articleId: 'article-1',
      qualificationVersion: 2,
      completed: true,
      activeSeconds: 900,
      wordCount: 300,
      wpm: 20,
      createdAt: NOW
    }]
  }));
  assert.equal(report.reading.totalDurationMs, 900_000);
  assert.equal(report.reading.completedCount, 1);
});

test('preview-only reading remains empty and does not create an in-progress row', () => {
  const report = buildDailyLearningReport(baseInput());
  assert.equal(report.reading.totalDurationMs, 0);
  assert.equal(report.reading.inProgressCount, 0);
  assert.equal(report.reading.completedCount, 0);
});

test('reading markdown and agent summary use actual duration, in-progress count, and guide count', () => {
  const report = buildDailyLearningReport(baseInput({ activities: [activity()] }));
  const markdown = formatDailyLearningReportMarkdown(report);
  const summary = toDailyReportAgentSummary(report);
  assert.match(markdown, /今日实际阅读：17 分钟/);
  assert.match(markdown, /有效完成：0 篇；进行中：1 篇/);
  assert.match(markdown, /逐句导读：12 句/);
  assert.match(markdown, /平均 WPM：—/);
  assert.equal(summary.reading.activeDurationMs, 17 * 60_000);
  assert.equal(summary.reading.inProgressCount, 1);
  assert.equal(summary.reading.guideVisitedCount, 12);
  assert.doesNotMatch(JSON.stringify(summary), /guideVisitedIndexes/);
});
