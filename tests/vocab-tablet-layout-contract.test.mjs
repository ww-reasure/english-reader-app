import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('vocabulary page renders one flat list instead of nesting a second vocab grid', async () => {
  const source = await read('../src/views/vocabulary.js');
  const listMarkers = source.match(/class="vocab-unified-list vocab-list"/g) || [];

  assert.equal(listMarkers.length, 1);
  assert.match(source, /data-vocab-grid="vocab"/);
  assert.match(source, /data-vocab-row=/);
});

test('unified vocabulary rows expose compact metadata without forcing letter-level wrapping', async () => {
  const [source, css] = await Promise.all([
    read('../src/views/vocabulary.js'),
    read('../css/style.css')
  ]);

  assert.match(source, /class="vocab-unified-row/);
  assert.match(source, /vocab-unified-phonetic/);
  assert.match(source, /vocab-unified-definition/);
  assert.match(css, /\.vocab-unified-row\s*\{[^}]*overflow-wrap:anywhere/s);
});

test('reference vocabulary styling has a route-specific editorial shell', async () => {
  const css = await read('../css/style.css');

  assert.match(css, /\.app-shell--vocab \.app-header/);
  assert.match(css, /\.vocab-unified-search-icon/);
  assert.match(css, /\.vocab-unified-upload-icon/);
  assert.match(css, /\.vocab-unified-more-trigger/);
});

test('mobile vocabulary styling keeps the selected compact density without an intro block', async () => {
  const css = await read('../css/style.css');

  assert.match(css, /\.app-shell--vocab \.app-menu-button\s*\{[^}]*width:\s*40px;[^}]*height:\s*40px;[^}]*border:\s*0;/s);
  assert.match(css, /\.app-shell--vocab \.app-header-title\s*\{[^}]*font-size:\s*22px;/s);
  assert.doesNotMatch(css, /\.app-shell--vocab \.app-header-description\s*\{/);
  assert.match(css, /\.app-shell--vocab \.vocab-unified-heading\s*\{[^}]*font-size:\s*clamp\(27px,\s*7vw,\s*33px\);/s);
  assert.match(css, /\.app-shell--vocab \.vocab-unified-row\s*\{[^}]*min-height:\s*96px;/s);
  assert.match(css, /\.app-shell--vocab \.vocab-unified-word\s*\{[^}]*font-size:\s*21px;/s);
  assert.match(css, /\.app-shell--vocab \.vocab-unified-today-card\s*\{/s);
});
