import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('word import exposes a confirmation preview and resumable progress contract', async () => {
  const [chat, css] = await Promise.all([
    readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8'),
    readFile(new URL('../css/style.css', import.meta.url), 'utf8')
  ]);
  assert.match(chat, /new WordImportService/);
  assert.match(chat, /createPlan\(text,\s*\{\s*source:/);
  assert.match(chat, /renderImportPreview/);
  assert.match(chat, /确认导入/);
  assert.match(chat, /返回修改/);
  assert.match(chat, /onProgress/);
  assert.match(chat, /processed.*recognized/);
  assert.match(css, /\.word-import-preview/);
  assert.match(css, /\.word-import-preview-grid/);
  assert.match(css, /\.word-import-preview-row/);
  assert.match(css, /\.word-import-progress/);
});

test('large PDF import guards duplicate preview tasks and reports batch limits', async () => {
  const chat = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');
  const service = await readFile(new URL('../src/word-import-service.mjs', import.meta.url), 'utf8');
  assert.match(chat, /_planPromise/);
  assert.match(chat, /_importLimitExceeded/);
  assert.match(chat, /batchCount/);
  assert.match(chat, /MAX_PDF_WORDS/);
  assert.match(service, /MAX_PDF_WORDS\s*=\s*5000/);
  assert.match(service, /MAX_WORDS_PER_BATCH\s*=\s*200/);
});

test('PDF word import uses a bundled parser with bounded, retryable loading', async () => {
  const [chat, parser] = await Promise.all([
    readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pdf-import.mjs', import.meta.url), 'utf8')
  ]);

  assert.match(chat, /createPdfImportService/);
  assert.match(chat, /pdfImportService\.extractText/);
  assert.doesNotMatch(chat, /cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js/);
  assert.match(parser, /pdfjs-dist\/legacy\/build\/pdf\.js/);
  assert.match(parser, /timeoutError\('loader'\)/);
  assert.match(parser, /document_fallback/);
});
