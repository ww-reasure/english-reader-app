import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadSpacedRepetition() {
  const [source, scheduler] = await Promise.all([
    readFile(new URL('../src/spaced-repetition.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/learning-scheduler.mjs', import.meta.url), 'utf8')
  ]);
  const schedulerUrl = `data:text/javascript;base64,${Buffer.from(scheduler).toString('base64')}`;
  const adapted = source.replace("from './learning-scheduler.mjs'", `from '${schedulerUrl}'`);
  return import(`data:text/javascript;base64,${Buffer.from(adapted).toString('base64')}`);
}

test('long-interval and legacy mastered words use the stable SRS status', async () => {
  const { SpacedRepetition } = await loadSpacedRepetition();

  assert.equal(SpacedRepetition.getStatus({ reviewCount: 6, interval: 21 }), 'stable');
  assert.equal(SpacedRepetition.getStatus({ reviewCount: 2, interval: 1, state: 'mastered' }), 'stable');
  assert.equal(SpacedRepetition.isStable({ reviewCount: 6, interval: 21 }), true);
  assert.equal(SpacedRepetition.isStable({ reviewCount: 1, interval: 2 }), false);
});

test('unified vocabulary exposes stable and relearning filters without losing relearning words', async () => {
  const vocabularySource = await readFile(new URL('../src/views/vocabulary.js', import.meta.url), 'utf8');

  assert.match(vocabularySource, /STATUS_FILTERS = Object\.freeze\(\['all', 'new', 'learning', 'review', 'stable'\]\)/);
  assert.match(vocabularySource, /setStatusFilter/);
  assert.match(vocabularySource, /stable: '长期巩固'/);
  assert.match(vocabularySource, /长期巩固/);
  assert.match(vocabularySource, /statusDisplayOf/);
});

test('homepage review preserves due stable words while supplementing only non-stable words', async () => {
  const chatSource = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');

  assert.match(chatSource, /const dueWords = SpacedRepetition\.getDueWords\(allLearnWords\);/);
  assert.match(chatSource, /const nonStable(?:Words)? = allLearnWords\.filter\(w => !SpacedRepetition\.isStable\(w\)\);/);
  assert.match(chatSource, /normalizeTargetWords\(\s*\[\.\.\.dueWords, \.\.\.nonStableWords, \.\.\.stableWords\]\.map\(word => word\.word\)/);
});
