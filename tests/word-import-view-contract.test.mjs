import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('word import exposes a confirmation preview and resumable progress contract', async () => {
  const [chat, css] = await Promise.all([
    readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8'),
    readFile(new URL('../css/style.css', import.meta.url), 'utf8')
  ]);
  assert.match(chat, /new WordImportService/);
  assert.match(chat, /createPlan\(text\)/);
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
