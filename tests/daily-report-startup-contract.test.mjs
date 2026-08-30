import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('startup schedules telemetry pruning without blocking router initialization', async () => {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const routerIndex = source.indexOf('Router.init()');
  const scheduleIndex = source.indexOf('scheduleDailyReportPrune();');
  const routerStartedBeforePruneResolved = routerIndex >= 0 && scheduleIndex > routerIndex;
  const pruneCalls = (source.match(/dailyLearningReportMaintenance\.prune\(\)/g) || []).length;

  assert.ok(routerStartedBeforePruneResolved);
  assert.equal(pruneCalls, 1);
  assert.doesNotMatch(source, /await\s+dailyLearningReportMaintenance\.prune\(\)/);
  assert.match(source, /\.catch\(.*\)/s);
});
