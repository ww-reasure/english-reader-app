import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readSource(path) {
  return (await readFile(new URL(path, import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
}

test('learning profile renders effective reading analytics separately from the saved article inventory', async () => {
  const source = await readSource('../src/views/stats.js');
  assert.match(source, /import\s+\{[^}]*\bbuildReadingAnalytics\b[^}]*\}\s+from '\.\.\/reading-analytics\.mjs';/s);
  assert.match(source, /const reading = buildReadingAnalytics\(\{\s*articles,\s*readingStats\s*\}\);/s);
  assert.match(source, /资料库文章数/);
  assert.match(source, /有效阅读次数/);
  assert.match(source, /读过文章数/);
  assert.match(source, /最近 30 天有效阅读/);
  assert.doesNotMatch(source, /calculateStreak\(articles\)/);
});

test('weekly report groups articles, words and time from qualified reading records rather than article creation', async () => {
  const source = await readSource('../src/views/report.js');
  assert.match(source, /import\s+\{[^}]*\bsummarizeReadingPeriod\b[^}]*\}\s+from '\.\.\/reading-analytics\.mjs';/s);
  assert.match(source, /const weekReading = summarizeReadingPeriod\(readingStats, weekStart\.getTime\(\)\);/);
  assert.match(source, /const monthReading = summarizeReadingPeriod\(readingStats, monthStart\.getTime\(\)\);/);
  assert.doesNotMatch(source, /articles\.filter\(a => a\.createdAt >= weekStart/);
  assert.doesNotMatch(source, /articles\.filter\(a => a\.createdAt >= monthStart/);
});
