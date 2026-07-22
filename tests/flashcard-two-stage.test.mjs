import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  REVIEW_PHASES,
  createReviewState,
  revealMeaning,
  startRating,
  finishRating,
  skipWord,
  nextWord
} from '../src/flashcard-flow.mjs';

test('revealing a meaning keeps recall scoring available but disables known', () => {
  const revealed = revealMeaning(createReviewState());

  assert.equal(revealed.phase, REVIEW_PHASES.RECALL);
  assert.equal(revealed.meaningRevealed, true);
  assert.equal(startRating(revealed, 5), null);
  assert.deepEqual(startRating(revealed, 3), { ...revealed, pendingQuality: 3, isSubmitting: true });
  assert.deepEqual(startRating(revealed, 1), { ...revealed, pendingQuality: 1, isSubmitting: true });
});

test('every submitted rating enters the study phase exactly once', () => {
  for (const quality of [1, 3, 5]) {
    const submitting = startRating(createReviewState(), quality);
    const study = finishRating(submitting);

    assert.equal(study.phase, REVIEW_PHASES.STUDY);
    assert.equal(study.quality, quality);
    assert.equal(study.isSubmitting, false);
    assert.equal(startRating(submitting, quality), null, 'submitting state rejects duplicate scores');
  }
});

test('skip bypasses score and next word is only available from study', () => {
  const recall = createReviewState();

  assert.equal(nextWord(recall), null);
  assert.deepEqual(skipWord(recall), createReviewState());

  const study = finishRating(startRating(recall, 5));
  assert.deepEqual(nextWord(study), createReviewState());
});

test('flashcard view separates recall scoring from tabbed study details', async () => {
  const [source, css] = await Promise.all([
    readFile(new URL('../src/views/flashcard.js', import.meta.url), 'utf8'),
    readFile(new URL('../css/style.css', import.meta.url), 'utf8')
  ]);

  assert.match(source, /flashcard-flow\.mjs/);
  assert.match(source, /showMeaning\(\)/);
  assert.match(source, /submitRating\(quality\)/);
  assert.match(source, /flashcard-study-tabs/);
  assert.match(source, /setStudyTab\(tab\)/);
  assert.match(source, /flashcard-study-next/);
  assert.doesNotMatch(source, /rateAndFlip\(/);
  assert.match(css, /\.flashcard-study-tabs\s*\{/);
  assert.match(css, /\.flashcard-study-next\s*\{/);
  assert.match(css, /\.flashcard-review-shell\s*\{[^}]*min-height:100%/s);
});

test('all flashcard companion states use the same study-notebook visual language', async () => {
  const [source, css] = await Promise.all([
    readFile(new URL('../src/views/flashcard.js', import.meta.url), 'utf8'),
    readFile(new URL('../css/style.css', import.meta.url), 'utf8')
  ]);

  for (const className of ['flashcard-recall-stage', 'flashcard-result-sheet', 'flashcard-empty-sheet']) {
    assert.match(source, new RegExp(className));
    assert.match(css, new RegExp(`\\.${className}\\s*\\{`));
  }
  assert.match(css, /\.flashcard-recall-stage::before\s*\{/);
  assert.match(css, /\.flashcard-result-sheet\s*\{[^}]*border-top:3px/s);
});

test('study keeps its shell and next action fixed while only the material panel scrolls', async () => {
  const [source, css] = await Promise.all([
    readFile(new URL('../src/views/flashcard.js', import.meta.url), 'utf8'),
    readFile(new URL('../css/style.css', import.meta.url), 'utf8')
  ]);

  assert.match(source, /flashcard-progress-block/);
  assert.match(css, /\.flashcard-review-shell--study\s*\{[^}]*height:100%/s);
  assert.match(css, /\.flashcard-review-shell--study \.flashcard-container\s*\{[^}]*height:100%/s);
  assert.match(css, /\.flashcard-study-sheet\s*\{[^}]*height:100%/s);
  assert.match(css, /\.flashcard-study-panel\s*\{[^}]*overflow-y:auto/s);
});

test('related words carry a Chinese gloss while legacy string caches remain supported', async () => {
  const [flashcard, affixes] = await Promise.all([
    readFile(new URL('../src/views/flashcard.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/affixes.js', import.meta.url), 'utf8')
  ]);

  assert.match(affixes, /relatedTranslations/);
  assert.match(affixes, /enrichRelatedTranslations/);
  assert.match(flashcard, /flashcard-related-translation/);
  assert.match(flashcard, /enrichRelatedTranslations/);
});

test('in-card updates keep rendering inside the shell outlet', async () => {
  const source = await readFile(new URL('../src/views/flashcard.js', import.meta.url), 'utf8');

  assert.match(source, /container:\s*null/);
  assert.match(source, /this\.container = container/);
  assert.match(source, /this\.renderRecall\(this\.container\)/);
  assert.match(source, /this\.renderStudy\(this\.container\)/);
  assert.doesNotMatch(source, /document\.getElementById\('app'\)/);
});

test('learn word in-place actions preserve the AppShell outlet', async () => {
  const source = await readFile(new URL('../src/views/learn-words.js', import.meta.url), 'utf8');

  assert.match(source, /container:\s*null/);
  assert.match(source, /this\.container = container/);
  assert.match(source, /setFilter\(mode\)\s*\{\s*this\.filterMode = mode;\s*this\.render\(this\.container\);/s);
  assert.match(source, /toggleManage\(\)\s*\{\s*this\.manageMode = !this\.manageMode;\s*this\.render\(this\.container\);/s);
  assert.match(source, /async deleteWord\(id\)\s*\{[\s\S]*?await DB\.deleteLearnWord\(id\);[\s\S]*?if \(words\.length === 0\)\s*\{\s*this\.manageMode = false;\s*\}\s*await this\.render\(this\.container\);/s);
  assert.match(source, /clearAll\(\)\s*\{[\s\S]*?this\.render\(this\.container\);/s);
  assert.doesNotMatch(source, /document\.getElementById\('app'\)/);
});

test('recall scoring uses one segmented action group with feedback icons', async () => {
  const [source, css] = await Promise.all([
    readFile(new URL('../src/views/flashcard.js', import.meta.url), 'utf8'),
    readFile(new URL('../css/style.css', import.meta.url), 'utf8')
  ]);

  assert.match(source, /flashcard-rating-group/);
  assert.match(source, /fa-face-smile/);
  assert.match(source, /fa-face-meh/);
  assert.match(source, /fa-face-frown/);
  assert.match(css, /\.flashcard-rating-group\s*\{[^}]*grid-template-columns:repeat\(3/s);
});

test('empty review primary action keeps readable primary text', async () => {
  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');

  assert.match(css, /\.flashcard-empty-sheet \.btn-primary\s*\{[^}]*color:var\(--on-accent\)/s);
});

test('study examples reuse the shared word tooltip and clean up its listeners', async () => {
  const source = await readFile(new URL('../src/views/flashcard.js', import.meta.url), 'utf8');

  assert.match(source, /import \{ Tooltip \} from '\.\.\/components\/tooltip\.js';/);
  assert.match(source, /id="wordTooltip" class="word-tooltip"/);
  assert.match(source, /bindExampleWordLookup\(\)/);
  assert.match(source, /cleanupExampleWordLookup\(\)/);
  assert.match(source, /Tooltip\.attachAutoDismiss\(\)/);
  assert.match(source, /Tooltip\.beginLookup\(e\.clientX, e\.clientY\)/);
  assert.match(source, /Dictionary\.lookup\(word\)/);
  assert.match(source, /Tooltip\.show\(lookupId, e\.clientX, e\.clientY, data\)/);
  assert.match(source, /target\.closest\('\.example-translate-btn'\)/);
  assert.match(source, /if \(Tooltip\.isVisible\(\)\)\s*\{\s*e\.stopPropagation\(\);\s*Tooltip\.hide\(\);\s*return;/s);
  assert.match(source, /cleanup\(\)\s*\{\s*this\.cleanupExampleWordLookup\(\);/s);
});
