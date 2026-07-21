import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('article AI uses article-keyed sessions and cleans up article state', async () => {
  const source = await readFile(new URL('../src/components/ai-analysis.js', import.meta.url), 'utf8');
  assert.match(source, /reading:/);
  assert.match(source, /clearArticleContext\(\)/);
});
