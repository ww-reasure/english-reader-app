import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function read(relativePath) {
  return (await readFile(new URL(relativePath, import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
}

test('reading article actions are provided by the app header, not the scrolling article title', async () => {
  const [reading, shell] = await Promise.all([
    read('../src/views/reading.js'),
    read('../src/components/app-shell.js')
  ]);

  assert.doesNotMatch(reading, /reading-header-utilities/);
  assert.doesNotMatch(reading, /<button[^>]+id="favBtn"/);
  assert.doesNotMatch(reading, /<button[^>]+id="readingMoreBtn"/);
  assert.match(shell, /getHeaderActions\(navKey, hash = ''\)/);
  assert.match(shell, /reading-app-header-actions/);
  assert.match(shell, /id="favBtn"[^>]*aria-pressed="false"/);
  assert.match(shell, /id="readingMoreBtn"[^>]*aria-expanded="false"/);
  assert.match(shell, /aria-controls="readingActionsOverlay"/);
  assert.match(shell, /onclick="ReadingView\.toggleReadingActions\(\)"/);
});

test('reading actions keep sentence guide prominent and secondary tools in one sheet', async () => {
  const [reading, css] = await Promise.all([
    read('../src/views/reading.js'),
    read('../css/style.css')
  ]);

  assert.doesNotMatch(reading, /class="reading-action-strip"/);
  assert.match(reading, /class="reading-primary-actions"/);
  assert.match(reading, /全文翻译/);
  assert.match(reading, /逐句导读/);
  assert.match(reading, /句子配色/);
  assert.match(reading, /导出 PDF/);
  assert.match(reading, /class="reading-actions-sheet"/);
  assert.match(reading, /id="readingActionsOverlay"/);
  assert.match(reading, /id="exportPdfBtn"/);
  assert.match(reading, /onclick="ReadingView\.exportArticlePdf\(\)"/);
  assert.doesNotMatch(reading, /readingActionsTitle[\s\S]{0,500}阅读返回/);
  assert.match(css, /\.reading-actions-sheet\s*\{/);
  assert.match(css, /\.reading-action-item\s*\{[^}]*min-height:\s*54px/s);
});

test('reading export method guards empty articles and reports failures', async () => {
  const reading = await read('../src/views/reading.js');

  assert.match(reading, /async exportArticlePdf\(\) \{/);
  assert.match(reading, /这篇文章没有可导出的正文内容/);
  assert.match(reading, /导出 PDF 失败：/);
  assert.match(reading, /exportArticlePdf\(article, \{ track }\)/);
});
test('reading metadata uses the shared exam track and keeps a distinct vocabulary baseline', async () => {
  const reading = await read('../src/views/reading.js');

  assert.match(reading, /import \{ resolveArticleTrack \} from '\.\.\/cloud-article-metadata\.mjs';/);
  assert.match(reading, /const articleTrack = resolveArticleTrack\(article\);/);
  assert.match(reading, /badge-\$\{articleTrack\.badgeClass\}/);
  assert.match(reading, /\$\{esc\(articleTrack\.primaryLabel\)\}/);
  assert.match(reading, /articleTrack\.baselineLabel/);
  assert.match(reading, /targetTrack:\s*articleTrack\.targetTrack/);
  assert.match(reading, /examType:\s*this\.articleData\?\.examType/);
});
