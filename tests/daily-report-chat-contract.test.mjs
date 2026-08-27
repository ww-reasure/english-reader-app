import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readCopyText } from '../src/components/message-actions.mjs';
import * as dailyReport from '../src/daily-learning-report.mjs';

async function loadStore() {
  const source = await readFile(new URL('../src/components/conversation-store.js', import.meta.url), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

function memory(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
}

function nodeWithCopyValue(value) {
  return {
    dataset: { copyValue: value },
    getAttribute(name) {
      return name === 'data-copy-value' ? value : null;
    },
    querySelector() {
      return { innerText: '折叠卡片中的可见摘要', textContent: '折叠卡片中的可见摘要' };
    }
  };
}

test('copy action prefers explicit full Markdown over collapsed text', () => {
  const root = nodeWithCopyValue('# 英语学习日报\n\n## 今日概览');
  assert.equal(readCopyText(root), '# 英语学习日报\n\n## 今日概览');
});

test('conversation stores only report reference fields', async () => {
  const { ConversationStore } = await loadStore();
  const store = new ConversationStore(memory(), () => 1000);
  store.append('home', {
    role: 'assistant',
    kind: 'daily_report',
    reportId: 'daily:2026-08-24',
    dateKey: '2026-08-24',
    markdown: '# 不应持久化',
    report: { facts: { secret: '不应持久化' } }
  });
  const saved = store.getSession('home').messages.at(-1);
  assert.deepEqual(
    Object.keys(saved).filter(key => !['createdAt', 'role', 'kind'].includes(key)),
    ['reportId', 'dateKey']
  );
  assert.equal(saved.markdown, undefined);
  assert.equal(saved.report, undefined);
});

test('home exposes the daily report quick action through the main agent composer', async () => {
  const source = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');
  assert.match(source, /data-action="daily-report"/);
  assert.match(source, /DailyLearningReportService/);
  const start = source.indexOf('  async handleDailyReport()');
  const end = source.indexOf('  async executeHomeTool', start);
  assert.ok(start >= 0 && end > start);
  const handler = source.slice(start, end);
  assert.match(handler, /submitComposer\s*\(/);
  assert.doesNotMatch(handler, /getOrCreate|publishDailyReport|dailyReportAnalyzer/);
});

test('today report tool result is bounded, structured, and keeps category data status', () => {
  const result = dailyReport.toDailyReportToolResult({
    dataFingerprint: 'sha256:test',
    facts: {
      dateKey: '2026-08-24',
      completeness: {
        vocabulary: 'available',
        reading: 'empty',
        wordReview: 'partial',
        exam: 'unavailable',
        trends: 'available'
      },
      vocabulary: { newUnique: 2, newWords: ['alpha', 'beta'] },
      reading: { completedCount: 1 },
      wordReview: { sessionCount: 1 },
      exam: { objectiveAnswered: 3 },
      trends7d: { availableDays: 2 }
    }
  });

  assert.equal(result.source, 'daily_learning_report');
  assert.equal(result.dateKey, '2026-08-24');
  assert.equal(result.dataFingerprint, 'sha256:test');
  assert.deepEqual(result.dataStatus, {
    vocabulary: 'available',
    reading: 'empty',
    wordReview: 'partial',
    exam: 'unavailable',
    trends: 'available'
  });
  for (const key of ['reading', 'vocabulary', 'wordReview', 'exam', 'trends7d']) assert.ok(result[key]);
  assert.equal(JSON.stringify(result).length < 8000, true);
});

test('home tool path handles today reports through the existing daily artifact flow', async () => {
  const source = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');
  assert.match(source, /name === 'get_today_learning_report'/);
  assert.match(source, /toDailyReportToolResult\(report\)/);
  assert.match(source, /dailyReportArtifactOf\(report\)/);
});
