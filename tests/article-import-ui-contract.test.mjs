import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function read(relativePath) {
  return (await readFile(new URL(relativePath, import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
}

test('article import modal keeps paste input and adds accessible file/status controls', async () => {
  const html = await read('../index.html');
  assert.match(html, /id="importFile"[^>]*accept="\.txt,\.md,\.markdown,\.html,\.htm"/);
  assert.match(html, /id="importStatus"[^>]*aria-live="polite"/);
  assert.match(html, /id="importContent"/);
  assert.match(html, /value="kaoyan1"/);
  assert.match(html, /value="kaoyan2"/);
  assert.match(html, /value="graduate"/);
});

test('app binds file selection once while modal owns parsing, stale-request protection and duplicate-safe saving', async () => {
  const [app, modal] = await Promise.all([
    read('../src/app.js'),
    read('../src/components/modal.js')
  ]);
  assert.match(app, /getElementById\(['"]importFile['"]\).*addEventListener\(['"]change['"]/s);
  assert.match(app, /Modal\.handleImportFile/);
  assert.equal((app.match(/Modal\.handleImportFile/g) || []).length, 1);
  assert.match(modal, /parseImportedDocument/);
  assert.match(modal, /_importRequestId/);
  assert.match(modal, /requestId\s*!==\s*this\._importRequestId/);
  assert.match(modal, /DB\.getAllArticles/);
  assert.match(modal, /contentFingerprint/);
  assert.match(modal, /article-imported/);
});

test('modal resets file state on open and close and exposes non-horizontal status styling', async () => {
  const [modal, css] = await Promise.all([
    read('../src/components/modal.js'),
    read('../css/style.css')
  ]);
  assert.match(modal, /importFile[\s\S]*value\s*=\s*['"]/);
  assert.match(modal, /_importFilePromise\s*=\s*null/);
  assert.match(modal, /_setImportBusy\(false\)/);
  assert.match(css, /\.import-status\s*\{[^}]*overflow-wrap:anywhere/s);
  assert.match(css, /\.import-file-control/);
});
