import assert from 'node:assert/strict';
import test from 'node:test';
import { renderDailyReportCard } from '../src/components/daily-report-card.mjs';

const report = {
  dateKey: '2026-08-24',
  facts: {
    coreStudyDurationMs: 3_600_000,
    vocabulary: { newUnique: 3, externalReviewed: 2 },
    reading: { completedCount: 2 },
    exam: { objectiveAnswered: 10, objectiveCorrect: 8, objectiveAccuracy: 80 }
  },
  analysis: { summary: '今天的学习节奏稳定，可以继续保持。' },
  markdown: '# 英语学习日报\n\n## 今日概览\n\n学习保持稳定。'
};

test('collapsed card exposes summary and an accessible expand control', () => {
  const html = renderDailyReportCard(report);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /学习总时长/);
  assert.match(html, /2026-08-24/);
  assert.match(html, /阅读/);
  assert.match(html, /客观题/);
  assert.match(html, /新增词/);
  assert.doesNotMatch(html, /完整试卷正文/);
});

test('card output escapes user-controlled report text', () => {
  const html = renderDailyReportCard({
    ...report,
    analysis: { summary: '<script>alert(1)</script>' },
    markdown: '<img src=x onerror=alert(1)>'
  });
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /onerror=/);
  assert.match(html, /aria-controls=/);
});
