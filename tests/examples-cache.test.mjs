import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { readExampleCache } from '../src/examples-cache.mjs';

const createStorage = values => ({
  getItem(key) {
    return Object.hasOwn(values, key) ? values[key] : null;
  }
});

test('example cache returns a synchronous hit without requiring an AI request', () => {
  const cache = readExampleCache('Claim', createStorage({
    examples_claim: JSON.stringify(['A claim needs evidence.'])
  }));

  assert.deepEqual(cache, {
    hit: true,
    examples: ['A claim needs evidence.']
  });
});

test('example cache treats an intentionally cached empty result as a hit', () => {
  const cache = readExampleCache('claim', createStorage({
    examples_claim: '[]'
  }));

  assert.deepEqual(cache, { hit: true, examples: [] });
});

test('example cache safely falls through for missing or malformed values', () => {
  assert.deepEqual(readExampleCache('claim', createStorage({})), { hit: false, examples: [] });
  assert.deepEqual(readExampleCache('claim', createStorage({ examples_claim: '{not json' })), {
    hit: false,
    examples: []
  });
});

test('examples exposes its synchronous cached examples to progressive callers', async () => {
  const source = await readFile(new URL('../src/examples.js', import.meta.url), 'utf8');

  assert.match(source, /getCachedExamples\(word\)/);
  assert.match(source, /readExampleCache\(word\)/);
});
