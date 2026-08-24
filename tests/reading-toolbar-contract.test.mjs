import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function read(relativePath) {
  return (await readFile(new URL(relativePath, import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
}

test('reading header puts favourite and vocabulary marking in compact utilities', async () => {
  const reading = await read('../src/views/reading.js');

  assert.match(reading, /reading-header-utilities/);
  assert.match(reading, /id="favBtn"[^>]*aria-pressed=/);
  assert.match(reading, /id="wordMarkingBtn"[^>]*role="switch"[^>]*aria-checked=/);
  assert.match(reading, /词汇标记/);
  assert.match(reading, /id="sentenceColorBtn"[^>]*aria-pressed=/);
});

test('reading actions keep translation, sentence guide, PDF export and back in one compact strip', async () => {
  const [reading, css] = await Promise.all([
    read('../src/views/reading.js'),
    read('../css/style.css')
  ]);

  assert.match(reading, /class="reading-action-strip"/);
  assert.match(reading, /全文翻译/);
  assert.match(reading, /逐句导读/);
  assert.match(reading, /句子配色/);
  assert.match(reading, /导出 PDF/);
  assert.match(reading, /id="exportPdfBtn"/);
  assert.match(reading, /onclick="ReadingView\.exportArticlePdf\(\)"/);
  assert.match(reading, /阅读返回/);
  assert.match(css, /\.reading-action-strip\s*\{[^}]*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/s);
  assert.doesNotMatch(css, /@media \(max-width:380px\) \{[^}]*\.reading-actions \.btn \{ flex:1/s);
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
