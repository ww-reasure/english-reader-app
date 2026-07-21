import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('shared CSS contains safe areas and no legacy tab bar rule', async () => {
  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.app-shell\s*\{[^}]*min-height:\s*100dvh/s);
  assert.match(css, /env\(safe-area-inset-top/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.doesNotMatch(css, /\.tab-bar\s*\{/);
  assert.match(css, /\.chat-container\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\)/s);
});
