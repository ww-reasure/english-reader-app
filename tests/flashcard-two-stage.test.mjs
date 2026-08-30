import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  REVIEW_PHASES,
  createReviewState,
  revealMeaning,
  startRating,
  finishRating,
  canCorrectKnownRating,
  startRatingCorrection,
  finishRatingCorrection,
  skipWord,
  nextWord
} from '../src/flashcard-flow.mjs';

async function loadAudioCacheModule() {
  const [audioSource, resolverSource] = await Promise.all([
    readFile(new URL('../src/audio-cache.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pronunciation-resolver.mjs', import.meta.url), 'utf8')
  ]);
  const resolverUrl = `data:text/javascript;base64,${Buffer.from(resolverSource).toString('base64')}`;
  const adaptedAudioSource = audioSource
    .replace("import { getStemForm } from './helpers.js';", 'const getStemForm = (word) => word;')
    .replace(
      /import \{\s*createPronunciationResolver,\s*fetchPronunciationResponse,\s*normalizePronunciationWord\s*\} from '\.\/pronunciation-resolver\.mjs';/,
      `import { createPronunciationResolver, fetchPronunciationResponse, normalizePronunciationWord } from '${resolverUrl}';`
    );

  return import(`data:text/javascript;base64,${Buffer.from(adaptedAudioSource).toString('base64')}`);
}

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

test('a known score can be corrected to forgotten exactly once while studying the same card', () => {
  const known = finishRating(startRating(createReviewState(), 5));

  assert.equal(canCorrectKnownRating(known), true);
  const correcting = startRatingCorrection(known);
  assert.deepEqual(correcting, { ...known, isSubmitting: true, isCorrecting: true });

  const corrected = finishRatingCorrection(correcting);
  assert.deepEqual(corrected, {
    ...known,
    quality: 1,
    isSubmitting: false,
    isCorrecting: false,
    ratingCorrected: true
  });
  assert.equal(canCorrectKnownRating(corrected), false);
  assert.equal(startRatingCorrection(finishRating(startRating(createReviewState(), 3))), null);
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
  assert.match(source, /correctMistakenKnown\(\)/);
  assert.match(source, /commitPendingKnowledgeEvidence\(\)/);
  assert.match(source, /: '记错了'/);
  assert.doesNotMatch(source, /记错了，按“忘了”处理/);
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

test('study details reserve substantially more viewport space for the scrollable material panel', async () => {
  const [source, css] = await Promise.all([
    readFile(new URL('../src/views/flashcard.js', import.meta.url), 'utf8'),
    readFile(new URL('../css/style.css', import.meta.url), 'utf8')
  ]);

  assert.match(source, /flashcard-study-info-trigger/);
  assert.match(source, /flashcard-study-exam-detail/);
  assert.match(source, /this\.studyTab === 'examples'/);
  assert.match(css, /\.flashcard-study-sheet\s*\{[^}]*grid-template-rows:auto auto minmax\(0,1fr\)/s);
  assert.match(css, /\.flashcard-study-panel\s*\{[^}]*overflow-y:auto[^}]*padding:16px 20px 20px[^}]*scrollbar-width:thin/s);
  assert.match(css, /\.flashcard-study-tabs \.flashcard-study-tab\s*\{[^}]*min-height:50px/s);
  assert.match(css, /\.flashcard-study-info-trigger\s*\{[^}]*min-height:42px/s);
  assert.match(css, /\.flashcard-next-btn\s*\{[^}]*min-height:48px/s);
  assert.match(css, /\.flashcard-study-info-sheet\s*\{[^}]*max-height:min\(72dvh,620px\)/s);
});

test('study phase uses a focused example stage and a separate exam-information sheet', async () => {
  const [source, stage, css] = await Promise.all([
    readFile(new URL('../src/views/flashcard.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/word-study-stage.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../css/style.css', import.meta.url), 'utf8')
  ]);

  assert.match(source, /studyExampleIndex:\s*0/);
  assert.match(source, /studyExamplesExpanded:\s*false/);
  assert.match(source, /getFocusedWordStudyExamples/);
  assert.match(stage, /wordCount >= 6 && wordCount <= 28/);
  assert.match(source, /renderFocusedStudyExample\(\)/);
  assert.match(source, /renderFocusedWordStudyExample/);
  assert.match(source, /data-study-info-open/);
  assert.match(source, /role="dialog"[^>]*aria-labelledby="flashcardStudyInfoTitle"/);
  assert.match(source, /data-example-select/);
  assert.match(source, /data-example-show-all/);
  assert.match(source, /touchstart/);
  assert.match(source, /touchend/);
  assert.match(css, /\.flashcard-study-masthead\s*\{/);
  assert.match(css, /\.flashcard-focused-example\s*\{/);
  assert.match(css, /\.flashcard-study-info-overlay\s*\{/);
  assert.match(css, /\.flashcard-study-bottom-dock\s*\{/);
});

test('related words carry a Chinese gloss while legacy string caches remain supported', async () => {
  const [flashcard, affixes, materials] = await Promise.all([
    readFile(new URL('../src/views/flashcard.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/affixes.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/word-study-materials.mjs', import.meta.url), 'utf8')
  ]);

  assert.match(affixes, /relatedTranslations/);
  assert.match(affixes, /enrichRelatedTranslations/);
  assert.match(flashcard, /renderWordStudyPanel/);
  assert.match(materials, /flashcard-related-translation/);
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

test('unified vocabulary in-place actions preserve the AppShell outlet', async () => {
  const source = await readFile(new URL('../src/views/vocabulary.js', import.meta.url), 'utf8');

  assert.match(source, /container:\s*null/);
  assert.match(source, /this\.container = container/);
  assert.match(source, /setSourceFilter\(value\)/);
  assert.match(source, /toggleManage\(\)/);
  assert.match(source, /archiveWords\(wordIds\)/);
  assert.doesNotMatch(source, /deleteLearnWord|clearAll/);
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
  assert.match(source, /bindLearningTextLookup\(\{/);
  assert.match(source, /getContextSentence:/);
  assert.match(source, /getTargetTrack:/);
  assert.match(source, /Tooltip\.hide\(\);/);
  assert.match(source, /invalidateCardRequests\(\)\s*\{\s*this\.cardSession\+\+;\s*this\.cancelCardPronunciation\(\);\s*this\.cancelPhraseRequest\(\);\s*this\.cancelSimilarRequest\(\);\s*this\.cancelRootRequest\(\);\s*this\.cleanupExampleWordLookup\(\);/s);
  assert.match(source, /cleanup\(\)\s*\{\s*this\.invalidateCardRequests\(\);/s);
});

test('study example lookup can switch words after a tooltip is open and keeps sentence context', async () => {
  const [source, materials] = await Promise.all([
    readFile(new URL('../src/views/flashcard.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/word-study-materials.mjs', import.meta.url), 'utf8')
  ]);

  assert.match(materials, /data-word-study-word/);
  assert.match(source, /closeBeforeLookup:\s*false/);
  assert.match(source, /getContextSentence:[\s\S]*?data-example-text/s);
  assert.match(source, /getTargetTrack:/);
});

test('flashcard review telemetry is best effort and does not replace the two-stage flow', async () => {
  const source = await readFile(new URL('../src/views/flashcard.js', import.meta.url), 'utf8');

  assert.match(source, /StudySessionTimer/);
  assert.match(source, /DB\.saveLearningActivity/);
  assert.match(source, /reviewedWordIds/);
  assert.match(source, /practiceCompletedWordIds/);
  assert.match(source, /review-session-summary/);
  assert.match(source, /commitPendingKnowledgeEvidence\(\)/);
});

test('a recall card starts one cancellable automatic pronunciation', async () => {
  const source = await readFile(new URL('../src/views/flashcard.js', import.meta.url), 'utf8');

  assert.match(source, /import \{ AudioCache \} from '\.\.\/audio-cache\.js';/);
  assert.match(source, /cancelCardPronunciation\(\);/);
  assert.match(source, /startCardPronunciation\(word\.word, session\);/);
  assert.match(source, /AudioCache\.getAudio\(word, \{ signal: controller\.signal, silent: true \}\)/);
  assert.match(source, /invalidateCardRequests\(\)\s*\{[\s\S]*?this\.cancelCardPronunciation\(\);[\s\S]*?this\.cleanupExampleWordLookup\(\);/);
  assert.match(source, /cleanup\(\)\s*\{\s*this\.invalidateCardRequests\(\);/s);
});

test('an aborted pronunciation request does not fetch or fall back to speech', async () => {
  const previous = {
    window: globalThis.window,
    fetch: globalThis.fetch,
    speechSynthesis: globalThis.speechSynthesis,
    SpeechSynthesisUtterance: globalThis.SpeechSynthesisUtterance
  };
  let fetchCalls = 0;

  try {
    globalThis.window = {};
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return { ok: false };
    };
    globalThis.SpeechSynthesisUtterance = class {};
    globalThis.speechSynthesis = { cancel() {}, speak() {} };
    const { AudioCache } = await loadAudioCacheModule();
    const controller = new AbortController();
    controller.abort();

    assert.equal(await AudioCache.getAudio('practice', { signal: controller.signal }), false);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.window = previous.window;
    globalThis.fetch = previous.fetch;
    globalThis.speechSynthesis = previous.speechSynthesis;
    globalThis.SpeechSynthesisUtterance = previous.SpeechSynthesisUtterance;
  }
});

test('silent automatic pronunciation does not show a missing-audio toast', async () => {
  const previous = {
    window: globalThis.window,
    fetch: globalThis.fetch,
    speechSynthesis: globalThis.speechSynthesis,
    SpeechSynthesisUtterance: globalThis.SpeechSynthesisUtterance,
    document: globalThis.document
  };

  try {
    globalThis.window = {};
    globalThis.fetch = async () => ({ ok: false });
    globalThis.speechSynthesis = undefined;
    globalThis.SpeechSynthesisUtterance = undefined;
    globalThis.document = undefined;
    const { AudioCache } = await loadAudioCacheModule();

    assert.equal(await AudioCache.getAudio('practice', { silent: true }), false);
  } finally {
    globalThis.window = previous.window;
    globalThis.fetch = previous.fetch;
    globalThis.speechSynthesis = previous.speechSynthesis;
    globalThis.SpeechSynthesisUtterance = previous.SpeechSynthesisUtterance;
    globalThis.document = previous.document;
  }
});
