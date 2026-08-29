import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function read(relativePath) {
  return (await readFile(new URL(relativePath, import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
}

test('reading article actions live in the app header and are not duplicated in the article title', async () => {
  const [source, shell] = await Promise.all([
    read('../src/views/reading.js'),
    read('../src/components/app-shell.js')
  ]);

  assert.doesNotMatch(source, /class="reading-header-utilities"/);
  assert.doesNotMatch(source, /<button[^>]+id="favBtn"/);
  assert.doesNotMatch(source, /<button[^>]+id="readingMoreBtn"/);
  assert.match(shell, /getHeaderActions\(navKey, hash = ''\)/);
  assert.match(shell, /reading-app-header-actions/);
  assert.match(source, /_syncHeaderFavorite\(article\)/);
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
  const exportMarkupStart = source.indexOf('id="exportPdfBtn"');
  const exportMarkupEnd = source.indexOf('</button>', exportMarkupStart);
  assert.ok(exportMarkupStart >= 0 && exportMarkupEnd > exportMarkupStart, 'PDF action markup should be present');
  const exportMarkup = source.slice(exportMarkupStart, exportMarkupEnd);
  assert.match(exportMarkup, /fa-file-arrow-down/);
  assert.match(exportMarkup, /<span>导出 PDF<\/span>/);
  assert.match(exportMarkup, /reading-action-chevron/);
  const exportStart = source.indexOf('async exportArticlePdf() {');
  const exportEnd = source.indexOf('async cleanup(', exportStart);
  assert.ok(exportStart >= 0 && exportEnd > exportStart, 'exportArticlePdf method should be present');
  const exportMethod = source.slice(exportStart, exportEnd);
  const emptyCheck = exportMethod.indexOf('这篇文章没有可导出的正文内容');
  const closeSheet = exportMethod.indexOf('this.closeReadingActions()');
  assert.ok(emptyCheck >= 0 && closeSheet > emptyCheck, 'empty content must be checked before closing the sheet');
  assert.doesNotMatch(exportMethod, /button\.textContent\s*=/);
  assert.match(exportMethod, /querySelector\(['"]\.reading-action-state['"]\)/);
  assert.match(exportMethod, /导出中…/);
  assert.match(exportMethod, /button\.disabled\s*=\s*true/);
  assert.match(css, /\.reading-actions-sheet\s*\{/);
  assert.match(css, /\.reading-action-item\s*\{[^}]*min-height:\s*54px/s);
  assert.match(css, /\.reading-actions-overlay\s*\{/);
  assert.match(css, /\.reading-more-btn\.is-open\s*\{/);
  assert.doesNotMatch(css, /\.reading-action-strip\s*\{/);
});
