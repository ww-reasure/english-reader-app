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

test('practice controls expose a lower peek snap and submit only at the absolute final question', async () => {
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
  assert.match(source, /if \(!this\.isAtFinalQuestion\(\)\) return/);
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
  assert.doesNotMatch(draft, /examWordLookupToggle/);
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
