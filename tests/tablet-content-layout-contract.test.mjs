import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('reading exposes a stable top header, content pane, and AI panel host for tablet layouts', async () => {
  const source = await read('../src/views/reading.js');

  assert.match(source, /class="reading-layout" data-reading-layout="article"/);
  assert.match(source, /data-reading-header="article"/);
  assert.match(source, /data-reading-ai-panel="side"/);
  assert.match(source, /class="reading-content-pane" data-reading-pane="content"/);
  assert.doesNotMatch(source, /class="reading-study-pane" data-reading-pane="study"/);
  assert.match(source, /_bindViewportLifecycle\(\)/);
  assert.match(source, /addEventListener\('resize'/);
  assert.match(source, /addEventListener\('orientationchange'/);
  assert.match(source, /removeEventListener\('orientationchange'/);
  assert.match(source, /_updateReadingScrollDepth\(\)/);
  assert.match(source, /Tooltip\.hide\(\)/);
  assert.match(source, /AIAnalysis\.hideButton\(\)/);
});

test('flashcard recall and study states expose content and study pane hooks', async () => {
  const source = await read('../src/views/flashcard.js');

  assert.match(source, /class="flashcard-container flashcard-content" data-flashcard-content="recall"/);
  assert.match(source, /class="flashcard-container flashcard-content flashcard-study-container" data-flashcard-content="study"/);
  assert.match(source, /class="flashcard-study-sheet flashcard-study-pane" data-flashcard-pane="study"/);
});

test('context review states expose a content root and detail pane', async () => {
  const source = await read('../src/views/context-review.js');

  assert.match(source, /context-review-content/);
  assert.match(source, /class="context-review-sheet context-review-detail-pane/);
  assert.match(source, /data-context-review-pane="detail"/);
});

test('full word study details expose their material pane without changing tab hooks', async () => {
  const source = await read('../src/components/word-study-detail.js');

  assert.match(source, /class="[^"]*word-study-content[^"]*" data-word-study-content="detail"/);
  assert.match(source, /class="flashcard-study-panel word-study-detail-panel word-study-material-pane" data-word-study-pane="materials"/);
  assert.match(source, /data-study-tab/);
});

test('wide tablet CSS keeps reading content single-column and opens AI separately', async () => {
  const css = await read('../css/style.css');
  const start = css.indexOf('@media (min-width: 840px)');
  assert.notEqual(start, -1);
  const wide = css.slice(start);
  assert.match(wide, /\.reading-layout\s*\{[^}]*display:block/s);
  assert.match(css, /\.ai-result-overlay--side/);
  assert.match(css, /\.ai-result-overlay--side \.modal/);
  assert.match(wide, /\.flashcard-review-shell--study \.flashcard-study-sheet\s*\{[^}]*grid-template-columns:/s);
  assert.match(wide, /\.word-study-detail-sheet\s*\{[^}]*grid-template-columns:/s);
});
