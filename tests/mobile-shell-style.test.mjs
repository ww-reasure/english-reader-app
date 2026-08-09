import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('shared CSS contains safe areas and no legacy tab bar rule', async () => {
  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.app-shell\s*\{[^}]*min-height:\s*100dvh/s);
  assert.match(css, /env\(safe-area-inset-top/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.doesNotMatch(css, /\.tab-bar\s*\{/);
  assert.match(css, /\.chat-container\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\)/s);
});

test('uses Capacitor safe-area variables and 48px header touch targets', async () => {
  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
  assert.match(css, /var\(--safe-area-inset-top,\s*env\(safe-area-inset-top,0px\)\)/);
  assert.match(css, /var\(--safe-area-inset-bottom,\s*env\(safe-area-inset-bottom,0px\)\)/);
  assert.match(css, /\.app-icon-button\s*\{[^}]*width:48px[^}]*height:48px/s);
});

test('dark theme supplies the semantic surfaces used by reading cards and controls', async () => {
  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
  const darkTheme = css.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  for (const token of ['--paper-note', '--pine', '--pine-soft', '--toast-bg', '--on-accent', '--state-review']) {
    assert.match(darkTheme, new RegExp(`${token}:`), `${token} should be overridden in dark mode`);
  }
});

test('exam surfaces use semantic theme tokens instead of a second light-only palette', async () => {
  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
  const darkTheme = css.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  for (const token of ['--exam-surface', '--exam-surface-muted', '--exam-border', '--exam-text', '--exam-text-muted', '--exam-accent', '--exam-nav-bg']) {
    assert.match(css, new RegExp(`${token}:`), `${token} should be declared by the light palette`);
    assert.match(darkTheme, new RegExp(`${token}:`), `${token} should be overridden by the dark palette`);
  }
  assert.match(css, /\.exam-sheet\s*\{[^}]*background:\s*var\(--exam-surface\)/s);
  assert.match(css, /\.exam-bottom-nav\s*\{[^}]*background:\s*var\(--exam-nav-bg\)/s);
  assert.match(css, /\.exam-practice-paragraph\s*\{[^}]*color:\s*var\(--exam-text\)/s);
  assert.match(css, /\.exam-option\.is-selected\s*\{[^}]*background:\s*var\(--exam-selected\)/s);
  assert.match(css, /\.exam-review-tabs \.is-active\s*\{[^}]*background:\s*var\(--exam-accent\)/s);
  assert.match(css, /\.exam-translation-segment\.is-current\s*\{[^}]*background:\s*var\(--exam-accent-soft\)/s);
  assert.match(css, /\.exam-translation-input\s*\{[^}]*border:\s*1px solid var\(--exam-border\)/s);
});

test('shared overlays and elevated cards use theme-owned depth tokens across the app', async () => {
  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
  const darkTheme = css.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  for (const token of ['--overlay-backdrop', '--overlay-soft', '--elevation-card', '--elevation-float']) {
    assert.match(css, new RegExp(`${token}:`));
    assert.match(darkTheme, new RegExp(`${token}:`));
  }
  assert.match(css, /\.modal-overlay\s*\{[^}]*background:\s*var\(--overlay-backdrop\)/s);
  assert.match(css, /\.app-drawer-backdrop\s*\{[^}]*background:\s*var\(--overlay-soft\)/s);
  assert.match(css, /\.article-card\s*\{[^}]*box-shadow:\s*var\(--elevation-card\)/s);
});

test('vocabulary list words use a dedicated readable theme token', async () => {
  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
  const darkTheme = css.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)?.[1] || '';

  assert.match(css, /--vocab-word:\s*var\(--pine\)/);
  assert.match(darkTheme, /--vocab-word:\s*var\(--moss\)/);
  assert.match(css, /\.vocab-word \.word\s*\{[^}]*color:\s*var\(--vocab-word\)/s);
});

test('standard routes constrain the app shell so the page outlet can scroll', async () => {
  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.app-shell--standard\s*\{[^}]*height:\s*100dvh[^}]*display:\s*grid[^}]*grid-template-rows:\s*auto\s+minmax\(0,1fr\)[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.app-shell--standard\s+\.app-page-outlet\s*\{[^}]*overflow-y:\s*auto/s);
});
