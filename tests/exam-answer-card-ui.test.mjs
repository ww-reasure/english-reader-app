import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('practice progress opens an answer card and resolves cross-unit question keys', async () => {
  const source = await read('../src/views/exam-practice.js');
  assert.match(source, /<button[^>]+id="examSheetProgress"[^>]+aria-haspopup="dialog"/);
  assert.match(source, /showAnswerCard\(\)/);
  assert.match(source, /goToQuestionKey\(questionKey\)/);
  assert.match(source, /buildAnswerCardModel/);
  assert.match(source, /renderAnswerCardHtml/);
  assert.match(source, /requestSubmit\(\{ allowFromAnywhere: true \}\)/);
  assert.match(source, /event\.key === 'Tab'/);
});

test('submitted explanation binds sentence long press to a passage-only AI confirmation', async () => {
  const source = await read('../src/views/exam-practice.js');
  assert.match(source, /bindSentenceLongPress/);
  assert.match(source, /bindExplanationSentenceLongPress\(\)/);
  assert.match(source, /selectedSource:\s*'passage'/);
  assert.match(source, /exam-sentence-ai-confirm/);
  assert.match(source, /createSentenceRangeForTextNodes/);
});

test('answer card and tablet exam surfaces use adaptive layouts', async () => {
  const css = await read('../css/style.css');
  assert.match(css, /\.exam-answer-card-overlay\s*\{/);
  assert.match(css, /\.exam-answer-card-question\.is-answered/);
  assert.match(css, /@media \(min-width:\s*600px\)[\s\S]*\.exam-answer-card-overlay[\s\S]*justify-content:\s*flex-end/s);
  assert.match(css, /@media \(min-width:\s*840px\)[\s\S]*\.app-shell--rail \.exam-dashboard[\s\S]*max-width:\s*1180px/s);
  assert.match(css, /@media \(min-width:\s*840px\)[\s\S]*\.exam-result[\s\S]*grid-template-columns:/s);
  assert.match(css, /@media \(min-width:\s*840px\)[\s\S]*\.profile-panel:not\(\[hidden\]\)[\s\S]*display:\s*grid/s);
});

test('answer card participates in the native transient overlay dismissal path', async () => {
  const [practiceSource, nativeNavigationSource] = await Promise.all([
    read('../src/views/exam-practice.js'),
    read('../src/components/native-navigation.js')
  ]);
  assert.match(practiceSource, /overlay\.id = 'examAnswerCardOverlay'/);
  assert.match(practiceSource, /overlay\.className = 'modal-overlay exam-answer-card-overlay'/);
  assert.match(nativeNavigationSource, /visibleOverlay\.id === 'examAnswerCardOverlay'/);
  assert.match(nativeNavigationSource, /#examAnswerCardClose/);
});
