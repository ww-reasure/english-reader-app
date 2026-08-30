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
  assert.match(lookup, /if \(!shown \|\| disposed(?: \|\| !(?:Tooltip|tooltipApi)\.isCurrent\(lookupId\))?\) return/);
  assert.match(tooltip, /DB\.saveVocabularyWord\(/);
  assert.doesNotMatch(tooltip, /DB\.saveWord\(/);
  assert.doesNotMatch(tooltip, /DB\.saveLearnWord\(/);
  assert.match(tooltip, /createdLearnWord/);
  assert.match(tooltip, /learnWordId/);
  assert.match(tooltip, /onWordSaved/);
  assert.match(reading, /ActivityType\.READING_WORD_LOOKUP/);
  assert.match(reading, /ActivityType\.READING_WORD_SAVED/);
  assert.match(reading, /createReadingActivityTracker/);
  assert.match(reading, /readingActivityTracker\?\.record/);
  assert.match(reading, /_flushReadingActivity/);
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

test('reading activity keeps active time and completion facts in separate durable stages', async () => {
  const [reading, activity] = await Promise.all([
    readFile(new URL('../src/views/reading.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/reading-activity.mjs', import.meta.url), 'utf8')
  ]);
  assert.match(activity, /reading-active:/);
  assert.match(activity, /lastAccountedTimerElapsed/);
  assert.match(activity, /guideVisitedIndexes/);
  assert.match(activity, /saveIntervalMs/);
  assert.match(reading, /_flushReadingActivity\(\);[\s\S]*DB\.saveReadingStat/);
  assert.match(reading, /activityAccountingVersion:\s*1/);
  assert.match(reading, /_flushReadingActivity\(\{ markCompleted: true \}\)/);
});
