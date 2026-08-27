import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { toDailyReportAgentSummary } from '../src/daily-learning-report.mjs';

const report = {
  dateKey: '2026-08-24',
  dataFingerprint: 'sha256:test',
  facts: {
    dateKey: '2026-08-24',
    schemaVersion: 1,
    timezoneOffset: -480,
    coreStudyDurationMs: 3_600_000,
    completeness: { vocabulary: 'complete', reading: 'partial', wordReview: 'complete', exam: 'unavailable', trends: 'partial' },
    vocabulary: { newUnique: 1, newWords: ['bounded'], newBySource: { reading: 1 }, externalReviewed: 0, externalReviewWords: [], lookupCount: 1, distinctLookups: 1, repeatedLookups: [] },
    reading: { completedCount: 1, incompleteCount: 0, totalSeconds: 600, totalWords: 1200, averageWpm: 120, savedWordCount: 0, lookupCount: 1 },
    wordReview: { sessionCount: 1, durationMs: 600000, completedWordCount: 2, counts: { known: 2, uncertain: 0, unknown: 0, skipped: 0 }, recovery: {} },
    exam: { objectiveAnswered: 0, objectiveCorrect: 0, objectiveAccuracy: null, activeDurationMs: 0, papers: [] },
    trends7d: { availableDays: 1, missingDays: [], averageCoreStudyDurationMs: 3_600_000 }
  }
};

async function loadAgent() {
  const [source, analytics, learningDay] = await Promise.all([
    readFile(new URL('../src/components/learning-agent.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/reading-analytics.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/learning-day.mjs', import.meta.url), 'utf8')
  ]);
  const metadataUrl = new URL('../src/cloud-article-metadata.mjs', import.meta.url).href;
  const adapted = source.replace(
    "import { buildReadingAnalytics } from '../reading-analytics.mjs';",
    analytics
      .replace("from './cloud-article-metadata.mjs'", `from '${metadataUrl}'`)
      .replace(/^export /gm, '')
  ).replace(
    "import { localDayKey } from '../learning-day.mjs';",
    learningDay.replace(/^export /gm, '')
  );
  return import('data:text/javascript;base64,' + Buffer.from(adapted).toString('base64'));
}

function createAgent(LearningAgent, provider = {}) {
  return new LearningAgent({ db: {}, srs: {}, dailyReportProvider: provider });
}

test('declares bounded read-only daily learning tools', () => {
  return loadAgent().then(({ LEARNING_TOOLS }) => {
  const names = LEARNING_TOOLS.map(tool => tool.function.name);
  assert.ok(names.includes('get_daily_learning_report'));
  assert.ok(names.includes('list_recent_learning_reports'));
  assert.ok(names.includes('get_learning_activity_detail'));
  const listTool = LEARNING_TOOLS.find(tool => tool.function.name === 'list_recent_learning_reports');
  assert.equal(listTool.function.parameters.properties.limit.maximum, 30);
  const detailTool = LEARNING_TOOLS.find(tool => tool.function.name === 'get_learning_activity_detail');
  assert.deepEqual(detailTool.function.parameters.properties.category.enum, ['vocabulary', 'lookup', 'reading', 'review', 'exam']);
  const todayTool = LEARNING_TOOLS.find(tool => tool.function.name === 'get_today_learning_report');
  assert.ok(todayTool);
  assert.deepEqual(todayTool.function.parameters, { type: 'object', properties: {}, additionalProperties: false });
  });
});

test('daily report execution returns bounded facts and an artifact reference contract', async () => {
  const { LearningAgent } = await loadAgent();
  const agent = createAgent(LearningAgent, { getOrCreate: async () => report });
  const handled = await agent.execute('get_daily_learning_report', { date: '2026-08-24' });
  const result = { source: 'daily_learning_report', dataFingerprint: handled.dataFingerprint, ...toDailyReportAgentSummary(handled.facts) };
  const artifact = { type: 'daily_learning_report', reportId: `daily:${handled.dateKey}`, dateKey: handled.dateKey, dataFingerprint: handled.dataFingerprint };
  assert.equal(result.source, 'daily_learning_report');
  assert.equal(artifact.type, 'daily_learning_report');
  assert.equal(artifact.reportId, 'daily:2026-08-24');
  assert.equal(JSON.stringify(result).length < 8000, true);
});

test('tools reject out-of-range dates, categories, and limits', async () => {
  const { LearningAgent } = await loadAgent();
  const agent = createAgent(LearningAgent, {
    getActivityDetail: async ({ dateKey }) => {
      if (dateKey === '2020-01-01') throw new Error('日报日期已过期');
      return { items: [] };
    },
    listRecent: async () => []
  });
  await assert.rejects(() => agent.execute('get_learning_activity_detail', { date: '2020-01-01', category: 'database', limit: 999 }));
  assert.deepEqual(await agent.execute('list_recent_learning_reports', { limit: 999 }), { source: 'recent_learning_reports', status: 'empty', reports: [] });
});

test('today report ignores model date arguments and asks the service for the local day without analysis', async () => {
  const { LearningAgent } = await loadAgent();
  const now = new Date(2026, 7, 24, 23, 30).getTime();
  const calls = [];
  const agent = createAgent(LearningAgent, {
    getOrCreate: async (dateKey, options) => {
      calls.push({ dateKey, options });
      return { dateKey, facts: { dateKey } };
    }
  });
  agent.now = () => now;

  await agent.execute('get_today_learning_report', { date: '1999-01-01', withAnalysis: true });

  assert.deepEqual(calls, [{ dateKey: '2026-08-24', options: { withAnalysis: false } }]);
});

test('historical daily report tool keeps the explicit date and analysis option', async () => {
  const { LearningAgent } = await loadAgent();
  const calls = [];
  const report = { dateKey: '2026-08-23', facts: { dateKey: '2026-08-23' } };
  const agent = createAgent(LearningAgent, {
    getOrCreate: async (dateKey, options) => {
      calls.push({ dateKey, options });
      return report;
    }
  });

  assert.equal(await agent.execute('get_daily_learning_report', { date: '2026-08-23', withAnalysis: true }), report);
  assert.deepEqual(calls, [{ dateKey: '2026-08-23', options: { withAnalysis: true } }]);
});

test('recent report tool forwards available, empty, and unavailable provider statuses', async () => {
  const { LearningAgent } = await loadAgent();
  const cases = [
    { status: 'available', reports: [{ dateKey: '2026-08-24' }] },
    { status: 'empty', reports: [] },
    { status: 'unavailable', reports: [] }
  ];

  for (const expected of cases) {
    const agent = createAgent(LearningAgent, {
      listRecent: async () => expected
    });

    assert.deepEqual(
      await agent.execute('list_recent_learning_reports', { limit: 30 }),
      { source: 'recent_learning_reports', ...expected }
    );
  }
});

test('chat tool path keeps only the bounded summary and daily artifact metadata', async () => {
  const source = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');
  assert.match(source, /source:\s*'daily_learning_report'/);
  assert.match(source, /reportId:\s*`daily:\$\{dateKey\}`/);
  assert.match(source, /toDailyReportAgentSummary\(facts\)/);
  assert.doesNotMatch(source, /result:\s*report\s*,\s*artifact:\s*report/);
});
