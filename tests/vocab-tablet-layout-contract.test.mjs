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
