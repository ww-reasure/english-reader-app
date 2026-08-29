import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function read(relativePath) {
  return (await readFile(new URL(relativePath, import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
}

test('reading page keeps favourite separate and exposes a compact more-actions trigger', async () => {
  const source = await read('../src/views/reading.js');

  assert.match(source, /id="favBtn"[^>]*aria-pressed=/);
  assert.match(source, /class="reading-more-btn"[^>]*id="readingMoreBtn"/);
  assert.match(source, /onclick="ReadingView\.toggleReadingActions\(\)"/);
  assert.match(source, /aria-controls="readingActionsOverlay"/);
  assert.doesNotMatch(source, /reading-header-utilities[\s\S]{0,900}id="wordMarkingBtn"/);
});

test('reading page keeps sentence guide prominent and moves secondary tools into one action sheet', async () => {
  const source = await read('../src/views/reading.js');

  assert.doesNotMatch(source, /class="reading-action-strip"/);
  assert.match(source, /class="reading-primary-actions"/);
  assert.match(source, /继续逐句导读/);
  assert.match(source, /class="modal-overlay reading-actions-overlay"/);
  assert.match(source, /id="translateBtn"/);
  assert.match(source, /id="sentenceColorBtn"/);
  assert.match(source, /id="wordMarkingBtn"/);
  assert.match(source, /id="exportPdfBtn"/);
  assert.doesNotMatch(source, /阅读工具[\s\S]{0,220}阅读返回/);
});

test('reading action sheet closes from backdrop, toggle, and Escape without leaking key handlers', async () => {
  const source = await read('../src/views/reading.js');

  assert.match(source, /handleReadingActionsBackdrop\(event\)/);
  assert.match(source, /toggleReadingActions\(\)/);
  assert.match(source, /event\.key\s*===\s*['"]Escape['"]/);
  assert.match(source, /addEventListener\(['"]keydown['"]/);
  assert.match(source, /removeEventListener\(['"]keydown['"]/);
  assert.match(source, /moreButton\?\.classList\.add\(['"]is-open['"]\)/);
  assert.match(source, /moreButton\?\.classList\.remove\(['"]is-open['"]\)/);
  assert.match(source, /this\.closeReadingActions\(\);/);
  assert.match(source, /async cleanup\([\s\S]{0,500}this\.closeReadingActions\(\)/);
});

test('reading action sheet keeps toggle state visible and one-shot PDF action closes the sheet', async () => {
  const [source, css] = await Promise.all([
    read('../src/views/reading.js'),
    read('../css/style.css')
  ]);

  assert.match(source, /reading-action-state/);
  assert.match(source, /id="sentenceColorBtn"[^>]*aria-pressed=/);
  assert.match(source, /id="wordMarkingBtn"[^>]*aria-checked=/);
  assert.match(source, /async exportArticlePdf\(\) \{[\s\S]{0,120}this\.closeReadingActions\(\)/);
  assert.match(css, /\.reading-actions-sheet\s*\{/);
  assert.match(css, /\.reading-action-item\s*\{[^}]*min-height:\s*54px/s);
  assert.match(css, /\.reading-actions-overlay\s*\{/);
  assert.match(css, /\.reading-more-btn\.is-open\s*\{/);
  assert.doesNotMatch(css, /\.reading-action-strip\s*\{/);
});
