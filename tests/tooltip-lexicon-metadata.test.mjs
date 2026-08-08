import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('tooltip imports compact metadata badges for the four learning tracks', async () => {
  const source = await readFile(new URL('../src/components/tooltip.js', import.meta.url), 'utf8');

  assert.match(source, /renderTooltipWordBadges/);
  assert.match(source, /renderTooltipWordBadges\(data, esc, targetTrack\)/);
  assert.match(source, /word\.length < 2 && word\.toLowerCase\(\) !== 'a'/);
});

test('tooltip keeps definition quality out of the compact word card', async () => {
  const source = await readFile(new URL('../src/components/tooltip.js', import.meta.url), 'utf8');

  assert.match(source, /renderTooltipWordBadges/);
  assert.doesNotMatch(source, /tooltip-definition-trust/);
  assert.doesNotMatch(source, /definitionTrustLabel/);
});

test('shared word-point lookup falls back to DOM Range hit testing when caret APIs are unavailable', async () => {
  const source = await readFile(new URL('../src/components/word-point.js', import.meta.url), 'utf8');

  assert.match(source, /elementFromPoint/);
  assert.match(source, /createTreeWalker/);
  assert.match(source, /getClientRects/);
  assert.match(source, /caretRangeFromPoint/);
  assert.match(source, /caretPositionFromPoint/);
});
