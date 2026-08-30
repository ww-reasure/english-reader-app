import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('practice route never falls through into the scheduled review queue', async () => {
  const source = await read('../src/views/flashcard.js');

  assert.match(source, /requestedScope && \(!session \|\| session\.scope !== requestedScope\)/);
  assert.match(source, /renderInvalidPracticeSession/);
  assert.match(source, /return;/);
});

test('practice completion tracks rated ids, invalidates stale study requests, and finalizes once', async () => {
  const source = await read('../src/views/flashcard.js');

  assert.match(source, /practiceCompletedWordIds\.add\(Number\(word\.id\)\)/);
  assert.match(source, /finalizePracticeSession/);
  assert.match(source, /expectedWordIds:\s*this\.practiceWordIds/);
  assert.match(source, /completedWordIds:\s*\[\.\.\.this\.practiceCompletedWordIds\]/);
  assert.match(source, /invalidateCardRequests\(\)/);
  assert.match(source, /clearPracticeSession|finalizePracticeSession/);
});

test('practice result has no ordinary restart and returns to vocabulary for explicit rerun', async () => {
  const source = await read('../src/views/flashcard.js');

  assert.match(source, /\$\{isPractice \? '' : '<button class="btn btn-outline" onclick="FlashcardView\.restart\(\)">再来一轮<\/button>'\}/);
  assert.match(source, /isPractice \? '#\/vocab' : '#\/chat'/);
});

test('practice rating continues to use event-only persistence', async () => {
  const source = await read('../src/views/flashcard.js');
  const practiceBranch = source.slice(source.indexOf('if (this.practiceScope) {', source.indexOf('async recordRating')), source.indexOf('} else {', source.indexOf('if (this.practiceScope) {', source.indexOf('async recordRating'))));

  assert.match(practiceBranch, /DB\.recordLearnWordPractice/);
  assert.doesNotMatch(practiceBranch, /settleSessionReview|recordLearnWordReview|SpacedRepetition\.calculateNext/);
});

test('practice flashcards restore word-level completion from reviewEvents', async () => {
  const source = await read('../src/views/flashcard.js');

  assert.match(source, /getPracticeProgress/);
  assert.match(source, /practiceCompletedWordIds\s*=\s*new Set\(this\.practiceProgress\.completedWordIds/);
  assert.match(source, /practiceCompletedWordIds\.size/);
});
