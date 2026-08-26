import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

const [routerSource, statsSource, appShellSource, chatSource, flashcardSource, contextReviewSource, reviewModeSource, readingSource, reportSource, capabilitiesSource] = await Promise.all([
  read('../src/router.js'),
  read('../src/views/stats.js'),
  read('../src/components/app-shell.js'),
  read('../src/views/chat.js'),
  read('../src/views/flashcard.js'),
  read('../src/views/context-review.js'),
  read('../src/views/review-mode.js'),
  read('../src/views/reading.js'),
  read('../src/views/report.js'),
  read('../src/components/app-capabilities.mjs')
]);

test('vocab is canonical and the legacy route normalizes without LearnWordsView', () => {
  assert.match(routerSource, /hash === '#\/vocab'/);
  assert.match(routerSource, /#\/learn-words/);
  assert.match(routerSource, /replaceState/);
  assert.doesNotMatch(routerSource, /LearnWordsView/);
});

test('all user-facing vocabulary links use the canonical route', () => {
  const sources = { appShellSource, chatSource, flashcardSource, contextReviewSource, reviewModeSource, readingSource, reportSource, capabilitiesSource };
  for (const [name, source] of Object.entries(sources)) {
    assert.doesNotMatch(source, /href=["']#\/learn-words/, `${name} still links to the split page`);
  }
});

test('profile labels the active canonical count as vocabulary total', () => {
  assert.match(statsSource, /词汇总数/);
  assert.doesNotMatch(statsSource, />生词本</);
  assert.doesNotMatch(statsSource, /DB\.getAllWords\(\)/);
});

test('app shell keeps the canonical vocabulary route in the vocab rail', () => {
  assert.match(appShellSource, /hash === '#\/vocab'/);
  assert.doesNotMatch(appShellSource, /hash === '#\/learn-words'/);
});
