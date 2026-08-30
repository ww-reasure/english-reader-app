import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

function mediaBlock(css, media) {
  const start = css.indexOf(`@media (${media})`);
  assert.notEqual(start, -1, `missing media query: ${media}`);
  const next = css.indexOf('@media (', start + 1);
  return css.slice(start, next === -1 ? undefined : next);
}

test('the app shell keeps a named navigation toggle and navigation landmark for tablet layout', async () => {
  const source = await read('../src/components/app-shell.js');

  assert.match(source, /class="app-icon-button app-menu-button"/);
  assert.match(source, /aria-label="打开导航"/);
  assert.match(source, /aria-controls="appDrawer"/);
  assert.match(source, /<nav aria-label="主要导航">/);
});

test('tablet breakpoints reserve safe-area gutters and make the drawer persistent only on rail routes', async () => {
  const css = await read('../css/style.css');
  const tablet = mediaBlock(css, 'min-width: 600px) and (max-width: 839px');
  const wide = mediaBlock(css, 'min-width: 840px');

  assert.match(css, /safe-area-inset-left/);
  assert.match(css, /safe-area-inset-right/);
  assert.match(tablet, /\.app-shell--rail \.app-drawer\s*\{[^}]*position:relative/s);
  assert.match(tablet, /\.app-shell--rail \.app-menu-button\s*\{[^}]*display:none/s);
  assert.match(tablet, /\.app-shell--rail \.app-drawer-backdrop\s*\{[^}]*display:none/s);
  assert.match(tablet, /grid-template-columns:/);
  assert.match(wide, /grid-template-columns:/);
});

test('tablet library grids follow remaining content width instead of forcing narrow cards', async () => {
  const css = await read('../css/style.css');
  const narrow = mediaBlock(css, 'min-width: 600px) and (max-width: 719px');
  const tablet = mediaBlock(css, 'min-width: 720px) and (max-width: 1199px');
  const wide = mediaBlock(css, 'min-width: 1200px');

  for (const selector of ['.article-list', '.vocab-list']) {
    assert.match(narrow, new RegExp(`${selector.replace('.', '\\.') }[^}]*grid-template-columns:\\s*minmax\\(0,1fr\\)`, 's'), `${selector} should remain one column on narrow portrait tablets`);
    assert.match(tablet, new RegExp(`${selector.replace('.', '\\.') }[^}]*repeat\\(2`, 's'), `${selector} should be two columns on tablets`);
    assert.match(wide, new RegExp(`${selector.replace('.', '\\.') }[^}]*repeat\\(3`, 's'), `${selector} should use three columns only when the canvas is genuinely wide`);
  }
});

test('chat and standard outlets explicitly clamp inline content at tablet widths', async () => {
  const css = await read('../css/style.css');
  const tablet = mediaBlock(css, 'min-width: 600px) and (max-width: 839px');
  const wide = mediaBlock(css, 'min-width: 840px');

  for (const block of [tablet, wide]) {
    assert.match(block, /\.app-page-outlet\s*\{[^}]*min-width:0/s);
    assert.match(block, /\.chat-container\s*\{[^}]*min-width:0/s);
    assert.match(block, /overflow-wrap:anywhere/);
  }
});
