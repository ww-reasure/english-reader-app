import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

async function loadShell() {
  const source = await readFile(new URL('../src/components/app-shell.js', import.meta.url), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

test('route metadata separates tablet rail pages from focus pages', async () => {
  const { AppShell } = await loadShell();
  for (const route of ['#/chat', '#/reading-list', '#/vocab', '#/profile', '#/exam', '#/exam/review', '#/exam/history', '#/exam/catalog/reading_mcq']) {
    assert.equal(AppShell.getRouteMeta(route).tabletLayout, 'rail', route);
  }
  for (const route of ['#/reading/1', '#/flashcard', '#/exam/practice/a1', '#/exam/result/a1']) {
    assert.equal(AppShell.getRouteMeta(route).tabletLayout, 'focus', route);
  }
});

test('tablet CSS keeps rail routes in the shell and turns exam navigation inline', async () => {
  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.app-shell--rail\.app-shell--standard\s*\{[^}]*grid-template-columns:\s*var\(--app-sidebar-width\)\s+minmax\(0,1fr\)/s);
  assert.match(css, /@media \(min-width:\s*600px\)\s*\{[\s\S]*\.app-shell--standard[\s\S]*grid-template-columns:\s*var\(--app-sidebar-width\)\s+minmax\(0,1fr\)/s);
  assert.match(css, /@media \(min-width:\s*600px\)[\s\S]*\.app-shell--rail/s);
  assert.match(css, /@media \(min-width:\s*600px\)[\s\S]*\.app-shell--rail[\s\S]*\.app-drawer/s);
  assert.match(css, /@media \(min-width:\s*600px\)[\s\S]*\.exam-bottom-nav[\s\S]*position:\s*static/s);
});

test('wide tablets use independent 60/40 exam practice panes', async () => {
  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
  const wide = css.match(/@media \(min-width:\s*840px\)\s*\{[\s\S]*?\/\* end wide exam practice \*\//)?.[0] || '';
  assert.match(wide, /\.exam-practice\s*\{[^}]*grid-template-columns:\s*minmax\(0,3fr\)\s+minmax\(340px,2fr\)/s);
  assert.match(wide, /\.exam-practice-article\s*\{[^}]*position:\s*relative[^}]*overflow-y:\s*auto/s);
  assert.match(wide, /\.exam-sheet\s*\{[^}]*position:\s*relative[^}]*height:\s*100%/s);
  assert.match(wide, /\.exam-sheet-handle\s*\{[^}]*display:\s*none/s);
});
