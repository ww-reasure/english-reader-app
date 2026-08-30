import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = name => readFile(new URL(`../src/views/${name}`, import.meta.url), 'utf8');

test('history and statistics expose cache-first preload hooks used by route warmup', async () => {
  const [history, stats] = await Promise.all([read('history.js'), read('stats.js')]);

  assert.match(history, /async preloadData\(\)/);
  assert.match(history, /this\._preloadedArticles\s*\|\|\s*await DB\.getAllArticles\(\)/);
  const deleteArticle = history.slice(history.indexOf('async deleteArticle('));
  assert.doesNotMatch(deleteArticle, /DB\.getAllArticles\(\)/, 'deleting one card must not rescan the complete article store');
  assert.match(stats, /async preloadData\(\)/);
  assert.match(stats, /this\._preloadedModel\s*\|\|\s*await this\._loadDashboardModel\(\)/);
});

test('exam home preloads once and never paints a page-level loading screen', async () => {
  const source = await read('exam-home.js');

  assert.match(source, /async preloadData\(\)/);
  assert.match(source, /privatePackInstallPromise/);
  assert.doesNotMatch(source, /exam-loading-state/);
  assert.match(source, /this\._preloadedDashboard\s*\|\|\s*await this\._loadDashboard\(/);
});
