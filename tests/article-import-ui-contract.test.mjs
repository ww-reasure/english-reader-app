import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function read(relativePath) {
  return (await readFile(new URL(relativePath, import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
}

test('article import modal accepts text, markdown and HTML files and exposes status controls', async () => {
  const html = await read('../index.html');
  assert.match(html, /id="importFile"[^>]*accept="\.txt,\.md,\.markdown,\.html,\.htm"/);
  assert.match(html, /id="importStatus"/);
  assert.match(html, /value="kaoyan1"/);
  assert.match(html, /value="kaoyan2"/);
  assert.match(html, /value="graduate"/);
});

test('app delegates file selection while modal owns parsing and duplicate-safe saving', async () => {
  const [app, modal] = await Promise.all([
    read('../src/app.js'),
    read('../src/components/modal.js')
  ]);
  assert.match(app, /importFile/);
  assert.match(app, /handleImportFile/);
  assert.match(modal, /parseImportedDocument/);
  assert.match(modal, /sourceType:\s*['"]imported['"]/);
  assert.match(modal, /contentFingerprint/);
  assert.match(modal, /保存中/);
  assert.match(modal, /article-imported/);
});
