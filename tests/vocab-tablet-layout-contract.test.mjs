import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('vocabulary page renders one flat list instead of nesting a second vocab grid', async () => {
  const source = await read('../src/views/vocabulary.js');
  const listMarkers = source.match(/class="vocab-list"/g) || [];

  assert.equal(listMarkers.length, 1);
  assert.match(source, /data-vocab-grid="vocab"/);
});

test('learn words cards expose compact metadata without forcing letter-level wrapping', async () => {
  const [source, css] = await Promise.all([
    read('../src/views/learn-words.js'),
    read('../css/style.css')
  ]);

  assert.match(source, /class="learn-words-grid" data-vocab-grid="learn-words"/);
  assert.match(source, /learn-word-phonetic/);
  assert.match(source, /learn-word-definition/);
  assert.match(css, /\.learn-words-grid\s*\{[^}]*align-items:stretch/s);
  assert.match(css, /\.learn-word-text\s*\{[^}]*white-space:nowrap/s);
});
