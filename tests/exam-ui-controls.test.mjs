import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { SNAP_HEIGHTS, SNAP_ORDER, isFinalPracticeQuestion } from '../src/exam/practice-ui.mjs';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('exam bottom navigation is shared by the three top-level exam pages only', async () => {
  const [navSource, homeSource, reviewSource, historySource, catalogSource, practiceSource, resultSource] = await Promise.all([
    read('src/exam/bottom-nav.mjs'),
    read('src/views/exam-home.js'),
    read('src/views/exam-review.js'),
    read('src/views/exam-history.js'),
    read('src/views/exam-catalog.js'),
    read('src/views/exam-practice.js'),
    read('src/views/exam-result.js')
  ]);
  assert.match(navSource, /export function renderExamBottomNav/);
  assert.match(navSource, /#\/exam\/review/);
  assert.match(navSource, /#\/exam\/history/);
  for (const source of [homeSource, reviewSource, historySource]) assert.match(source, /renderExamBottomNav/);
  for (const source of [catalogSource, practiceSource, resultSource]) assert.doesNotMatch(source, /renderExamBottomNav/);
});

test('practice controls expose a lower peek snap while the inline submit stays at the absolute final question', async () => {
  const [source, css] = await Promise.all([
    read('src/views/exam-practice.js'),
    read('css/style.css')
  ]);
  assert.deepEqual(SNAP_ORDER, ['peek', 'low', 'mid', 'high']);
  assert.deepEqual(SNAP_HEIGHTS, { peek: 12, low: 24, mid: 52, high: 88 });
  assert.equal(isFinalPracticeQuestion({ currentQuestionIndex: 4, currentUnitQuestionCount: 5 }), true);
  assert.equal(isFinalPracticeQuestion({ currentQuestionIndex: 3, currentUnitQuestionCount: 5 }), false);
  assert.equal(isFinalPracticeQuestion({ practiceKind: 'full_paper', currentUnitIndex: 0, unitCount: 2, currentQuestionIndex: 4, currentUnitQuestionCount: 5 }), false);
  assert.equal(isFinalPracticeQuestion({ practiceKind: 'full_paper', currentUnitIndex: 1, unitCount: 2, currentQuestionIndex: 4, currentUnitQuestionCount: 5 }), true);
  assert.match(source, /isFinalPracticeQuestion/);
  assert.match(source, /examSubmitBtn/);
  assert.match(source, /submitButton\.hidden/);
  assert.match(source, /if \(!allowFromAnywhere && !this\.isAtFinalQuestion\(\)\) return/);
  assert.match(source, /requestSubmit\(\{ allowFromAnywhere: true \}\)/);
  assert.match(source, /Math\.max\(SNAP_HEIGHTS\.peek,/);
  assert.match(css, /\.exam-sheet\.is-peek/);
  assert.match(css, /\.exam-sheet\.is-peek[^}]*min-height:\s*96px/);
  assert.match(css, /\.exam-sheet-header-actions \.btn\[hidden\]\s*\{[^}]*display:\s*none/);
});

test('practice keeps submit in the sheet header while the footer stays focused on secondary actions', async () => {
  const source = await read('src/views/exam-practice.js');
  const draft = source.slice(source.indexOf('container.innerHTML = `', source.indexOf('async render(container')), source.indexOf('this.container = container;'));
  assert.match(draft, /exam-sheet-header-actions/);
  assert.match(draft, /examSubmitBtn/);
  const footerStart = draft.indexOf('exam-sheet-footer');
  const footer = draft.slice(footerStart, footerStart + 600);
  assert.doesNotMatch(footer, /examSubmitBtn/);
  assert.match(draft, /id="examWordLookupToggle"/);
  assert.match(draft, /role="switch"/);
  assert.match(draft, /点词翻译/);
});

test('practice exposes a right-side word lookup switch that persists the current preference', async () => {
  const source = await read('src/views/exam-practice.js');

  assert.match(source, /examWordLookupToggle/);
  assert.match(source, /toggleWordLookup()/);
  assert.match(source, /Config\.set\('exam_word_lookup_enabled'/);
  assert.match(source, /aria-checked/);
  assert.match(source, /Tooltip\.hide\(\)/);
});

test('submitted explanations give automatic sentence selection priority over lookup and generic selection actions', async () => {
  const [practice, selectionActions] = await Promise.all([
    read('src/views/exam-practice.js'),
    read('src/exam/selectable-text-actions.mjs')
  ]);

  assert.match(practice, /createLongPressSelectionGuard/);
  assert.match(practice, /shouldIgnoreClick:\s*\(\)\s*=>\s*this\.sentenceLongPressGuard\?\.consumeClick\(\)/);
  assert.match(practice, /shouldIgnoreSelection:\s*\(\)\s*=>\s*this\.sentenceLongPressGuard\?\.shouldIgnoreSelection\(\)/);
  assert.match(practice, /sentenceLongPressGuard\?\.markAutomaticSelection\(\)/);
  assert.match(practice, /sentenceLongPressGuard\?\.clear\(\)/);
  assert.match(selectionActions, /shouldIgnoreSelection\s*=\s*\(\)\s*=>\s*false/);
  assert.match(selectionActions, /if \(this\.shouldIgnoreSelection\(\)\) return this\.hide\(\)/);
});

test('only submitted exam passages enable native-selection suppression for sentence long press', async () => {
  const [practice, reading] = await Promise.all([
    read('src/views/exam-practice.js'),
    read('src/views/reading.js')
  ]);

  assert.match(practice, /preventNativeTextSelection:\s*true/);
  assert.match(practice, /duration:\s*420/);
  assert.match(practice, /\[data-selection-source="passage"\]/);
  assert.doesNotMatch(reading, /preventNativeTextSelection:\s*true/);
});

test('exam home sends full-paper practice through the year catalogue', async () => {
  const source = await read('src/views/exam-home.js');
  assert.match(source, /href="#\/exam\/catalog\/full_paper"/);
  assert.doesNotMatch(source, /examFullPaperStart/);
  assert.doesNotMatch(source, /selectRandomPaper/);
});

test('exam catalogue keeps years collapsed and renders direct entry only for one visible unit', async () => {
  const source = await read('src/views/exam-catalog.js');
  assert.match(source, /kind: fullPaper \? 'full_paper' : 'unit'/);
  assert.match(source, /data-year/);
  assert.match(source, /data-paper-start/);
  assert.doesNotMatch(source, /index === 0 \? 'open' : ''/);
});

test('only the exam desktop exposes a compact bank switcher', async () => {
  const [homeSource, catalogSource, css] = await Promise.all([
    read('src/views/exam-home.js'),
    read('src/views/exam-catalog.js'),
    read('css/style.css')
  ]);

  assert.match(homeSource, /exam-bank-switcher/);
  assert.match(homeSource, /exam-bank-switcher-copy/);
  assert.match(homeSource, /exam-bank-switcher-value/);
  assert.match(homeSource, /id="examBankPicker"/);
  assert.match(css, /\.app-shell--exam-home \.exam-bank-switcher/);
  assert.match(css, /\.exam-bank-switcher:focus-within/);

  assert.doesNotMatch(catalogSource, /examCatalogBankPicker/);
  assert.doesNotMatch(catalogSource, /exam-bank-picker-source/);
  assert.doesNotMatch(catalogSource, /headerActions\.replaceChildren/);
});

test('every private exam pack entry point applies the shared installation migration policy', async () => {
  const [homeSource, loaderSource, ...sources] = await Promise.all([
    read('src/views/exam-home.js'),
    read('src/exam/private-pack-loader.mjs'),
    read('src/views/exam-catalog.js'),
    read('src/views/exam-history.js')
  ]);
  assert.match(homeSource, /installPrivateExamPacks/);
  assert.match(loaderSource, /getExamPackInstallOptions/);
  assert.match(loaderSource, /installPack\([^\n]+getExamPackInstallOptions\(pack\)\)/);
  for (const source of sources) {
    assert.match(source, /installPrivateExamPacks/);
    assert.doesNotMatch(source, /function installPrivatePacks/);
  }
});

test('the keep-alive exam home does not replace cached content with a loading page', async () => {
  const homeSource = await read('src/views/exam-home.js');
  assert.doesNotMatch(homeSource, /exam-loading-state|正在准备真题/);
  assert.match(homeSource, /ensurePrivatePacks/);
  assert.match(homeSource, /preloadData/);
  assert.match(homeSource, /installPrivateExamPacks/);
});

test('all private-pack pages expose a retry action when a pack cannot be updated', async () => {
  const sources = await Promise.all([
    read('src/views/exam-home.js'),
    read('src/views/exam-catalog.js'),
    read('src/views/exam-history.js')
  ]);
  for (const source of sources) {
    assert.match(source, /data-retry-private-packs/);
    assert.match(source, /部分真题包未更新/);
  }
});

test('router shows a recoverable page instead of leaving the app outlet blank when rendering fails', async () => {
  const source = await read('src/router-navigation.mjs');

  assert.match(source, /const renderClaim = \(async \(\) => view\.render\(outlet, \.\.\.route\.args\)\)\(\);/);
  assert.match(source, /try\s*\{\s*await renderClaim;/);
  assert.match(source, /route-render-error/);
  assert.match(source, /页面暂时无法打开/);
});
