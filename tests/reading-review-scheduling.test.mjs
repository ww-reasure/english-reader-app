import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('reading review never upgrades untouched words as known', async () => {
  const source = await readFile(new URL('../src/views/reading.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /User didn't click - they recognized it/);
  assert.doesNotMatch(source, /quality\s*=\s*5;/);
  assert.match(source, /DB\.recordLearnWordReview\(word\.id, srsData, \{/);
  assert.match(source, /source:\s*'reading'/);
  assert.match(source, /contextExposure/);
});
