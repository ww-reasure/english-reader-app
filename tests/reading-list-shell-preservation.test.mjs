import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('bookshelf filters rerender only the mounted page outlet', async () => {
  const source = (await readFile(new URL('../src/views/reading-list.js', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');

  assert.match(source, /_container:\s*null/);
  assert.match(source, /this\._container\s*=\s*container/);
  assert.match(source, /this\._renderArticles\(this\._container,\s*this\._articles\)/);
  assert.doesNotMatch(source, /document\.getElementById\('app'\)/);
});

test('bookshelf invalidates a late fetch after its view has cleaned up', async () => {
  const source = await readFile(new URL('../src/views/reading-list.js', import.meta.url), 'utf8');

  assert.match(source, /_renderSession/);
  assert.match(source, /cleanup\(\)\s*\{[\s\S]*_renderSession/s);
  assert.match(source, /if\s*\([^)]*renderSession[^)]*!==[^)]*this\._renderSession[^)]*\)\s*return/);
});

test('bookshelf requests the complete cloud catalog and renders auditable exam metadata', async () => {
  const source = await readFile(new URL('../src/views/reading-list.js', import.meta.url), 'utf8');
  const catalogSource = await readFile(new URL('../src/components/article-catalog.js', import.meta.url), 'utf8');

  assert.match(source, /ArticleCatalog/);
  assert.match(catalogSource, /api\/articles\?limit=500/);
  assert.match(source, /matchesShelfDifficulty/);
  assert.match(source, /formatPastExamLabel/);
  assert.match(source, /sourceLabelForArticle/);
  assert.match(source, /kaoyan-general/);
  assert.match(source, /const showSourceLabel = sourceLabel && !pastExamLabel/);
});

test('bookshelf keeps pull refresh while hiding the redundant refresh button', async () => {
  const source = await readFile(new URL('../src/views/reading-list.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /class="shelf-refresh-button"/);
  assert.doesNotMatch(source, /source:\s*['"]manual['"]/);
  assert.match(source, /class="shelf-pull-status"/);
  assert.match(source, /touchstart/);
  assert.match(source, /distance\s*>=\s*72/);
  assert.match(source, /source:\s*['"]pull['"]/);
  assert.doesNotMatch(source, /document\.getElementById\(['"]app['"]\)/);
});

test('a stale shelf article refreshes the catalog and resolves its current id by source url once', async () => {
  const source = await readFile(new URL('../src/views/reading-list.js', import.meta.url), 'utf8');

  assert.match(source, /resp\.status\s*===\s*404\s*\|\|\s*resp\.status\s*===\s*410/);
  assert.match(source, /source:\s*['"]detail-retry['"]/);
  assert.match(source, /ArticleCatalog\.findCurrentArticle\(\{/);
  assert.match(source, /sourceUrl:\s*currentArticle\.sourceUrl\s*\|\|\s*currentArticle\.url/);
  assert.match(source, /let retriedStaleId = false/);
  assert.match(source, /retriedStaleId = true/);
  assert.match(source, /这篇文章已更新或下架/);
});
