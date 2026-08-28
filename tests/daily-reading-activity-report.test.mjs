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
const NEXT_DATE_KEY = '2026-08-29';
const NEXT_NOW = new Date(2026, 7, 29, 22).getTime();

const activity = ({ dateKey = DATE_KEY, occurredAt = NOW, completionId = 'reading:article-1:cycle-1', durationMs = 17 * 60_000, completedToday = false, guideVisitedCount = 12, maxContentProgress = 0.47 } = {}) => ({
  id: `reading-active:${dateKey}:${completionId}`,
  type: ActivityType.READING_ACTIVE_SLICE,
  occurredAt,
  dayKey: dateKey,
  sessionId: completionId,
  dedupeKey: `reading-active:${dateKey}:${completionId}`,
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

test('a later completion does not erase an earlier day in-progress reading', () => {
  const completionId = 'reading:article-1:cross-day-cycle';
  const dayOneActivity = activity({
    dateKey: DATE_KEY,
    occurredAt: NOW,
    completionId,
    durationMs: 15 * 60_000
  });
  const dayOneBeforeCompletion = buildDailyLearningReport(baseInput({ activities: [dayOneActivity] }));
  const dayOneAfterCompletion = buildDailyLearningReport(baseInput({
    activities: [dayOneActivity],
    readingStats: [{
      articleId: 'article-1',
      completionId,
      qualificationVersion: 2,
      activityAccountingVersion: 1,
      completed: true,
      activeSeconds: 10 * 60,
      wordCount: 1200,
      wpm: 120,
      createdAt: NEXT_NOW
    }]
  }));

  assert.equal(dayOneBeforeCompletion.reading.totalDurationMs, 15 * 60_000);
  assert.equal(dayOneBeforeCompletion.reading.completedCount, 0);
  assert.equal(dayOneBeforeCompletion.reading.inProgressCount, 1);
  assert.deepEqual(dayOneAfterCompletion.reading, dayOneBeforeCompletion.reading);
});

test('a cross-day completion is counted only on the completion day', () => {
  const completionId = 'reading:article-1:cross-day-cycle-2';
  const report = buildDailyLearningReport(baseInput({
    activities: [activity({
      dateKey: NEXT_DATE_KEY,
      occurredAt: NEXT_NOW,
      completionId,
      durationMs: 10 * 60_000,
      completedToday: true
    })],
    readingStats: [{
      articleId: 'article-1',
      completionId,
      qualificationVersion: 2,
      activityAccountingVersion: 1,
      completed: true,
      activeSeconds: 25 * 60,
      wordCount: 1200,
      wpm: 120,
      createdAt: NEXT_NOW
    }]
  }));

  assert.equal(report.reading.totalDurationMs, 0);
  assert.equal(report.reading.completedCount, 0);
  assert.equal(report.reading.inProgressCount, 0);

  const nextDayReport = buildDailyLearningReport(baseInput({
    dateKey: NEXT_DATE_KEY,
    activities: [activity({
      dateKey: NEXT_DATE_KEY,
      occurredAt: NEXT_NOW,
      completionId,
      durationMs: 10 * 60_000,
      completedToday: true
    })],
    readingStats: [{
      articleId: 'article-1',
      completionId,
      qualificationVersion: 2,
      activityAccountingVersion: 1,
      completed: true,
      activeSeconds: 25 * 60,
      wordCount: 1200,
      wpm: 120,
      createdAt: NEXT_NOW
    }]
  }));
  assert.equal(nextDayReport.reading.totalDurationMs, 10 * 60_000);
  assert.equal(nextDayReport.reading.completedCount, 1);
  assert.equal(nextDayReport.reading.inProgressCount, 0);
});

test('a completed old cycle and a new active cycle remain separate on one day', () => {
  const oldCompletionId = 'reading:article-1:old-cycle';
  const newCompletionId = 'reading:article-1:new-cycle';
  const report = buildDailyLearningReport(baseInput({
    activities: [
      activity({
        dateKey: DATE_KEY,
        occurredAt: NOW - 60_000,
        completionId: oldCompletionId,
        durationMs: 12 * 60_000,
        completedToday: true
      }),
      activity({
        dateKey: DATE_KEY,
        occurredAt: NOW,
        completionId: newCompletionId,
        durationMs: 4 * 60_000
      })
    ],
    readingStats: [{
      articleId: 'article-1',
      completionId: oldCompletionId,
      qualificationVersion: 2,
      activityAccountingVersion: 1,
      completed: true,
      activeSeconds: 12 * 60,
      wordCount: 600,
      wpm: 50,
      createdAt: NOW - 60_000
    }]
  }));

  assert.equal(report.reading.completedCount, 1);
  assert.equal(report.reading.inProgressCount, 1);
  assert.equal(report.reading.totalDurationMs, 16 * 60_000);
  assert.deepEqual(report.reading.readings.map(item => item.status).sort(), ['completed', 'in_progress']);
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
