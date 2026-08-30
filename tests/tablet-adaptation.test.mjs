import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

async function loadShell() {
  const source = await readFile(new URL('../src/components/app-shell.js', import.meta.url), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

test('route metadata separates tablet rail pages from focus pages', async () => {
  const { AppShell } = await loadShell();
  for (const route of ['#/chat', '#/reading-list', '#/vocab', '#/profile']) {
    assert.equal(AppShell.getRouteMeta(route).tabletLayout, 'rail', route);
  }
  for (const route of ['#/reading/1', '#/flashcard']) {
    assert.equal(AppShell.getRouteMeta(route).tabletLayout, 'focus', route);
  }
});


test('tablet focus routes remove the persistent drawer and keep a full-width back header', async () => {
  const [css, shell] = await Promise.all([
    readFile(new URL('../css/style.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/app-shell.js', import.meta.url), 'utf8')
  ]);

  assert.match(shell, /app-shell--\$\{headerMode === 'back' \? 'back' : 'root'\}/);
  assert.match(css, /@media \(min-width:\s*600px\)[\s\S]*?\.app-shell--focus \.app-drawer\s*\{[^}]*display:\s*none/s);
  assert.match(css, /\.app-shell--focus \.app-drawer-backdrop\s*\{[^}]*display:\s*none/s);
  assert.match(css, /\.app-shell--focus \.app-header\s*\{[^}]*grid-column:\s*1[^}]*grid-template-columns:\s*48px\s+minmax\(0,1fr\)\s+auto/s);
});

test('tablet rail root headers reclaim the hidden menu column without hiding back navigation', async () => {
  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');

  assert.match(css, /\.app-shell--rail\.app-shell--root \.app-header\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\)\s+auto/s);
  assert.match(css, /\.app-shell--rail\.app-shell--back \.app-header\s*\{[^}]*grid-template-columns:\s*48px\s+minmax\(0,1fr\)\s+auto/s);
  assert.match(css, /\.app-shell--rail\.app-shell--root\.app-shell--vocab \.app-header/);
  assert.match(css, /\.app-shell--rail\.app-shell--root\.app-shell--exam \.app-header/);
});

test('tablet overlays become bounded side sheets and short landscape keeps controls visible', async () => {
  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');

  assert.match(css, /@media \(min-width:\s*600px\)[\s\S]*?\.reading-actions-overlay\s*,\s*\.sentence-guide-overlay\s*\{[^}]*align-items:\s*stretch[^}]*justify-content:\s*flex-end/s);
  assert.match(css, /\.reading-actions-sheet\s*,\s*\.sentence-guide-sheet\s*\{[^}]*width:\s*min\(460px,\s*62vw\)[^}]*height:\s*100%/s);
  assert.match(css, /@media \(min-width:\s*600px\) and \(max-height:\s*700px\)[\s\S]*?\.app-drawer a\s*\{[^}]*min-height:\s*42px/s);
});


