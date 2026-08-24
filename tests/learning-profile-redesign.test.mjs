import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('learning profile exposes accessible reading and exam tabs with a year filter', async () => {
  const source = await readFile(new URL('../src/views/stats.js', import.meta.url), 'utf8');
  assert.match(source, /role="tablist"/);
  assert.match(source, /role="tab"[^>]+data-profile-tab="reading"/);
  assert.match(source, /role="tab"[^>]+data-profile-tab="exam"/);
  assert.match(source, /role="tabpanel"[^>]+data-profile-panel="reading"/);
  assert.match(source, /role="tabpanel"[^>]+data-profile-panel="exam"/);
  assert.match(source, /data-exam-year-filter/);
  assert.match(source, /createExamLearningOverviewProvider/);
  assert.match(source, /aria-selected/);
  assert.match(source, /ArrowLeft|ArrowRight/);
});

test('learning profile keeps translation separate from objective accuracy and links recent attempts', async () => {
  const source = await readFile(new URL('../src/views/stats.js', import.meta.url), 'utf8');
  assert.match(source, /objectiveAccuracy/);
  assert.match(source, /translationSegments/);
  assert.match(source, /翻译完成/);
  assert.match(source, /#\/exam\/result\//);
  assert.match(source, /#\/exam\/practice\//);
  assert.doesNotMatch(source, /<h2>[^<]*[⏱📚📊📅]/);
});

test('learning profile counts active canonical learn words as the vocabulary total', async () => {
  const source = await readFile(new URL('../src/views/stats.js', import.meta.url), 'utf8');
  assert.match(source, /vocabularyCount:\s*learnWords\.length/);
  assert.match(source, /词汇总数/);
  assert.doesNotMatch(source, /DB\.getAllWords\(\)/);
});

test('weekly report separates active vocabulary from lifetime history', async () => {
  const source = await readFile(new URL('../src/views/report.js', import.meta.url), 'utf8');
  assert.match(source, /getAllLearnWords\(\)/);
  assert.match(source, /getAllLearnWords\(\{\s*includeArchived:\s*true\s*\}\)/);
  assert.match(source, /activeLearnWords/);
  assert.match(source, /allLearnWords/);
});

test('profile styling provides editorial tabs, exam performance cards and tablet columns', async () => {
  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.profile-section-tabs\s*\{/);
  assert.match(css, /\.profile-tab\[aria-selected="true"\]/);
  assert.match(css, /\.profile-exam-performance\s*\{/);
  assert.match(css, /@media \(min-width:\s*600px\)[\s\S]*\.profile-dashboard-grid/s);
  assert.match(css, /@media \(min-width:\s*840px\)[\s\S]*\.profile-dashboard-grid/s);
});
