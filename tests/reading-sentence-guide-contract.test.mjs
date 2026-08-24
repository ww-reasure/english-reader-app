import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readReadingView() {
  return (await readFile(new URL('../src/views/reading.js', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
}

async function readStyles() {
  return (await readFile(new URL('../css/style.css', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
}

test('reading view provides a cancellable sentence guide with direct sentence navigation', async () => {
  const source = await readReadingView();

  assert.match(source, /import\s+\{\s*SentenceGuide\s*\}\s+from '\.\.\/components\/sentence-guide\.js';/);
  assert.match(source, /逐句导读/);
  assert.match(source, /async openSentenceGuide\(\)/);
  assert.match(source, /async loadSentenceGuide\(/);
  assert.match(source, /SentenceGuide\.get\(\{/);
  assert.match(source, /guideAbortController\.abort\(\)/);
  assert.match(source, /上一句/);
  assert.match(source, /下一句/);
  assert.match(source, /返回全文/);
});

test('guided sentences contribute to the same qualified-reading progress calculation as full-text scrolling', async () => {
  const source = await readReadingView();
  const finishStart = source.indexOf('async finishReading()');
  const finishEnd = source.indexOf('async showSummary(', finishStart);
  const finishReading = source.slice(finishStart, finishEnd);

  assert.match(source, /getSentenceGuideProgress\(\)/);
  assert.match(source, /Math\.max\(this\._updateReadingScrollDepth\(\), this\.getSentenceGuideProgress\(\)\)/);
  assert.match(finishReading, /contentProgress:\s*contentProgressAtFinish/);
  assert.match(finishReading, /const scrollDepth = contentProgressAtFinish/);
  assert.match(finishReading, /scrollDepth,/);
});

test('sentence guide uses an independently scrollable mobile sheet with fixed navigation controls', async () => {
  const css = await readStyles();

  assert.match(css, /\.sentence-guide-sheet\s*\{[^}]*grid-template-rows:\s*auto\s+minmax\(0,1fr\)\s+auto/s);
  assert.match(css, /\.sentence-guide-body\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.sentence-guide-actions\s*\{[^}]*grid-template-columns:\s*repeat\(3,1fr\)/s);
});

test('reading guide and body share source-ranged sentences and guide words use one isolated lookup binding', async () => {
  const source = await readReadingView();
  assert.match(source, /import\s+\{\s*splitSentences\s*\}/);
  assert.match(source, /class="reading-sentence/);
  assert.match(source, /data-sentence-start=/);
  assert.match(source, /_renderGuideSource\(sentence\)/);
  assert.match(source, /data-word-lookup-token=/);
  assert.match(source, /surface:\s*['"]guide['"]/);
  assert.match(source, /_guideWordLookupCleanup\?\.\(\)/);
  assert.match(source, /getContextSentence:\s*\(\)\s*=>\s*current\.sentence/);
});

test('sentence colors are page-local, default off and rerender through the same paragraph pipeline as word marking', async () => {
  const [source, css] = await Promise.all([readReadingView(), readStyles()]);
  assert.match(source, /sentenceColorsEnabled:\s*false/);
  assert.match(source, /id="sentenceColorBtn"[^>]*aria-pressed="\$\{this\.sentenceColorsEnabled\}"/);
  assert.match(source, /toggleSentenceColors\(\)/);
  assert.match(source, /_renderParagraphContent\(/);
  assert.match(source, /this\.sentenceColorsEnabled\s*=\s*false/);
  assert.match(css, /\.reading-sentence\s*\{[^}]*box-decoration-break:\s*clone/s);
  for (const index of [1, 2, 3, 4]) assert.match(css, new RegExp(`\\.reading-sentence\\.sentence-color-${index}`));
});
