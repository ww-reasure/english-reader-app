import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('reading activity records only successful lookups and preserves save provenance', async () => {
  const [lookup, tooltip, reading] = await Promise.all([
    readFile(new URL('../src/components/reading-word-lookup.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/tooltip.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/reading.js', import.meta.url), 'utf8')
  ]);
  assert.match(lookup, /(?:Tooltip|tooltipApi)\.show\(lookupId/);
  assert.match(lookup, /onLookupResolved/);
  assert.match(lookup, /if \(!shown \|\| disposed\) return/);
  assert.match(tooltip, /DB\.findLearnWord\(/);
  assert.match(tooltip, /createdLearnWord/);
  assert.match(tooltip, /learnWordId/);
  assert.match(tooltip, /onWordSaved/);
  assert.match(reading, /ActivityType\.READING_WORD_LOOKUP/);
  assert.match(reading, /ActivityType\.READING_WORD_SAVED/);
  assert.match(reading, /lookup:\$\{sessionId\}/);
  assert.match(reading, /console\.warn/);
});

test('reading save activity keeps the source article and distinguishes reencounters', async () => {
  const [tooltip, reading] = await Promise.all([
    readFile(new URL('../src/components/tooltip.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/reading.js', import.meta.url), 'utf8')
  ]);
  assert.match(tooltip, /source: lookupContext\?\.source \|\| 'unknown'/);
  assert.match(tooltip, /articleTitle: lookupContext\?\.articleTitle \|\| ''/);
  assert.match(reading, /createdLearnWord/);
  assert.match(reading, /articleTitle/);
});
