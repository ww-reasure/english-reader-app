import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';



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
