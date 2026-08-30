import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readSource(relativePath) {
  return (await readFile(new URL(relativePath, import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
}

test('reading lookup supplies the full current sentence to a constrained contextual-sense resolver', async () => {
  const [reading, lookup] = await Promise.all([
    readSource('../src/views/reading.js'),
    readSource('../src/components/reading-word-lookup.js')
  ]);

  assert.match(reading, /bindReadingStyleWordLookup/);
  assert.match(reading, /getLookupSentence\(e\)/);
  assert.match(lookup, /ContextualSense\.resolve\(\{/);
  assert.match(lookup, /sentence:\s*contextSentence/);
  assert.match(lookup, /(?:Tooltip|tooltipApi)\.show\(lookupId/);
});

test('tooltip and full study detail display a selected in-sentence meaning without replacing full dictionary senses', async () => {
  const [tooltip, detail] = await Promise.all([
    readSource('../src/components/tooltip.js'),
    readSource('../src/components/word-study-detail.js')
  ]);

  assert.match(tooltip, /本句义/);
  assert.match(tooltip, /contextSentence/);
  assert.match(tooltip, /contextualSenseIndex/);
  assert.match(detail, /本句义/);
  assert.match(detail, /contextualSenseIndex/);
  assert.match(detail, /flashcard-study-definition-list/);
});
