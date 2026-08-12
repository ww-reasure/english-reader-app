import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';

import {
  buildArticlePdfLayout,
  exportArticlePdf,
  renderArticlePdf
} from '../src/components/article-pdf.mjs';

const sampleArticle = {
  title: 'The Future of AI: A Reading Practice',
  content: 'Artificial intelligence is changing how we learn.\n\nIt also changes how we work.\n\nResearchers are studying the effects every day.',
  titleZh: '人工智能的未来',
  wordCount: 24,
  createdAt: '2026-08-10T08:00:00.000Z'
};

test('layout extracts English title, meta, paragraphs and a sanitized file name', () => {
  const layout = buildArticlePdfLayout(sampleArticle, { track: 'cet6', now: Date.parse('2026-08-10T08:00:00.000Z') });
  assert.equal(layout.title, 'The Future of AI: A Reading Practice');
  assert.match(layout.meta, /24 words/);
  assert.match(layout.meta, /2026-08-10/);
  assert.match(layout.meta, /CET-6/);
  assert.deepEqual(layout.paragraphs, [
    'Artificial intelligence is changing how we learn.',
    'It also changes how we work.',
    'Researchers are studying the effects every day.'
  ]);
  assert.equal(layout.fileName, 'the-future-of-ai-a-reading-practice-2026-08-10.pdf');
});

test('layout sanitizes file names and falls back when content is empty', () => {
  const weird = buildArticlePdfLayout({ title: 'Hello, World! 你好 & Co.', content: '', createdAt: '2026-08-10' }, { now: Date.parse('2026-08-10') });
  assert.equal(weird.fileName, 'hello-world-co-2026-08-10.pdf');
  assert.deepEqual(weird.paragraphs, []);
  assert.equal(weird.title, 'Hello, World! 你好 & Co.');
  assert.match(weird.meta, /0 words/);

  const untitled = buildArticlePdfLayout({ content: 'Only body', createdAt: '2026-08-10' }, { now: Date.parse('2026-08-10') });
  assert.equal(untitled.fileName, 'untitled-2026-08-10.pdf');
});

test('layout caps overlong file-name slugs and counts words from content when absent', () => {
  const longTitle = 'A'.repeat(120);
  const layout = buildArticlePdfLayout({ title: longTitle, content: 'one two three', createdAt: '2026-08-10' }, { now: Date.parse('2026-08-10') });
  assert.ok(layout.fileName.length <= 80);
  assert.match(layout.meta, /3 words/);
});

test('render produces a valid multi-page PDF with the article title', async () => {
  const bytes = await renderArticlePdf(sampleArticle, { track: 'cet6', now: Date.parse('2026-08-10T08:00:00.000Z') });
  assert.ok(bytes.length > 1000);
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), '%PDF-');
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 1);
});

test('render paginates long articles onto multiple pages', async () => {
  const paragraphs = Array.from({ length: 80 }, (_, index) => `Paragraph ${index + 1}. ${'content '.repeat(30)}`);
  const bytes = await renderArticlePdf({ title: 'Long Article', content: paragraphs.join('\n\n'), createdAt: '2026-08-10' }, { now: Date.parse('2026-08-10') });
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() > 1, `expected >1 pages, got ${doc.getPageCount()}`);
});

test('export on web downloads the PDF and reports platform web', async () => {
  const downloads = [];
  const result = await exportArticlePdf(sampleArticle, {
    track: 'cet6',
    platform: 'web',
    downloadImpl: (bytes, fileName) => downloads.push({ bytes, fileName })
  });
  assert.equal(result.ok, true);
  assert.equal(result.platform, 'web');
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].fileName, 'the-future-of-ai-a-reading-practice-2026-08-10.pdf');
  assert.ok(downloads[0].bytes.length > 1000);
});

test('export on native writes to cache and opens the share sheet', async () => {
  let written = null;
  let shared = null;
  const result = await exportArticlePdf(sampleArticle, {
    track: 'cet6',
    platform: 'native',
    fsImpl: {
      writeFile: async options => {
        written = options;
        return { uri: 'file:///cache/the-future-of-ai.pdf' };
      }
    },
    shareImpl: {
      share: async options => { shared = options; }
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.platform, 'native');
  assert.equal(result.path, 'file:///cache/the-future-of-ai.pdf');
  assert.equal(written.directory, 'CACHE');
  assert.equal(written.path, 'the-future-of-ai-a-reading-practice-2026-08-10.pdf');
  assert.ok(typeof written.data === 'string' && written.data.length > 0);
  assert.deepEqual(shared.files, ['file:///cache/the-future-of-ai.pdf']);
  assert.equal(shared.title, 'the-future-of-ai-a-reading-practice-2026-08-10.pdf');
});

test('export reports a readable error when the file write fails', async () => {
  const result = await exportArticlePdf(sampleArticle, {
    platform: 'native',
    fsImpl: { writeFile: async () => { throw new Error('storage full'); } },
    shareImpl: { share: async () => {} }
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /storage full/);
});

test('export auto-detects web when Capacitor is unavailable', async () => {
  const downloads = [];
  const result = await exportArticlePdf(sampleArticle, {
    platform: 'auto',
    downloadImpl: (bytes, fileName) => downloads.push({ bytes, fileName })
  });
  assert.equal(result.ok, true);
  assert.equal(result.platform, 'web');
  assert.equal(downloads.length, 1);
});