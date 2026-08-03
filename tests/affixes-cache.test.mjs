import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('affix cache accessor checks versioned and legacy keys synchronously', async () => {
  const source = await read('../src/affixes.js');
  assert.match(source, /getCachedAnalysis\(word\)/);
  assert.match(source, /root_v3_\$\{key\}.*root_v2_\$\{key\}/s);
  assert.match(source, /normalizeAnalysis\(JSON\.parse\(cached\)\)/);
});
