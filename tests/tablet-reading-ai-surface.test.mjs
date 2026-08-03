import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

function mediaBlock(css, media) {
  const start = css.indexOf(`@media (${media})`);
  assert.notEqual(start, -1, `missing media query: ${media}`);
  const next = css.indexOf('@media (', start + 1);
  return css.slice(start, next === -1 ? undefined : next);
}

test('reading keeps the article header above the content and exposes an AI panel host', async () => {
  const source = await read('../src/views/reading.js');

  assert.match(source, /data-reading-header="article"/);
  assert.match(source, /data-reading-ai-panel="side"/);
  assert.match(source, /class="reading-content-pane" data-reading-pane="content"/);
  assert.doesNotMatch(source, /class="reading-study-pane" data-reading-pane="study"/);
});

test('AI analysis has responsive side-overlay and fixed composer surfaces', async () => {
  const [source, css] = await Promise.all([
    read('../src/components/ai-analysis.js'),
    read('../css/style.css')
  ]);

  assert.match(source, /side-overlay/);
  assert.match(source, /ai-result-body/);
  assert.match(source, /ai-result-footer/);
  assert.match(css, /\.ai-result-overlay--side/);
  assert.match(css, /\.ai-result-overlay--side \.modal\s*\{[^}]*width:clamp\(320px,42vw,430px\)/s);
  assert.match(css, /\.ai-followup-composer\s*\{[^}]*position:sticky/s);
});

test('tablet article grids stretch cards so bottom rules align by row', async () => {
  const css = await read('../css/style.css');
  const tablet = mediaBlock(css, 'min-width: 600px) and (max-width: 839px');
  const wide = mediaBlock(css, 'min-width: 840px');

  for (const block of [tablet, wide]) {
    assert.match(block, /\.article-list\s*,\s*\.vocab-list\s*\{[^}]*align-items:stretch/s);
    assert.match(block, /\.article-list-item\s*,\s*\.vocab-card\s*\{[^}]*height:100%/s);
  }
});
