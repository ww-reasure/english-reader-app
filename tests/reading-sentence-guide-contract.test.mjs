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
