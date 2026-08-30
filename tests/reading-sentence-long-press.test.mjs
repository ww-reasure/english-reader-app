import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('reading sentence analysis reuses the shared pointer long-press controller', async () => {
  const source = await readFile(new URL('../src/components/ai-analysis.js', import.meta.url), 'utf8');
  assert.match(source, /import \{ bindSentenceLongPress \} from '\.\/sentence-long-press\.mjs'/);
  assert.match(source, /this\._longPressCleanup = bindSentenceLongPress/);
  assert.match(source, /this\._longPressCleanup\?\.\(\)/);
  assert.doesNotMatch(source, /articleBody\.addEventListener\('touchstart'/);
});
