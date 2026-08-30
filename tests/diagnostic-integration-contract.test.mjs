import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('app installs the diagnostic bridge and captures lifecycle failures', async () => {
  const app = await source('src/app.js');
  assert.match(app, /diagnostic-logger\.mjs/);
  assert.match(app, /setPersistence/);
  assert.match(app, /app\.start/);
  assert.match(app, /window\.addEventListener\(['"]error['"]/);
  assert.match(app, /window\.addEventListener\(['"]unhandledrejection['"]/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /online|offline/);
});

test('database lifecycle and API request paths expose timing without logging secrets', async () => {
  const db = await source('src/db.js');
  const api = await source('src/api.js');
  assert.match(db, /db\.open\.blocked/);
  assert.match(db, /beginSpan\(['"]db\.open/);
  assert.match(db, /diagnosticLogs/);
  assert.match(api, /network\.api_request/);
  assert.match(api, /correlationId/);
  assert.doesNotMatch(api, /DiagnosticLogger\.record\([^)]*apiKey/);
});

test('flashcard rating has one correlation id across save and session persistence', async () => {
  const flashcard = await source('src/views/flashcard.js');
  assert.match(flashcard, /review\.rating_clicked/);
  assert.match(flashcard, /review\.rating_save_start/);
  assert.match(flashcard, /review\.srs_transaction/);
  assert.match(flashcard, /review\.session_persist/);
  assert.match(flashcard, /review\.study_rendered/);
  assert.match(flashcard, /correlationId/);
});

test('settings exposes the troubleshooting card and diagnostic actions', async () => {
  const settings = await source('src/views/settings.js');
  assert.match(settings, /问题排查/);
  assert.match(settings, /开启详细日志/);
  assert.match(settings, /导出诊断日志/);
  assert.match(settings, /清除诊断日志/);
  assert.match(settings, /exportDiagnosticLogs/);
  assert.match(settings, /getStatus/);
});

test('diagnostic settings have responsive status and action styles', async () => {
  const css = await source('css/style.css');
  assert.match(css, /diagnostic/);
  assert.match(css, /settings-diagnostic/);
});

test('content-heavy learning flows expose safe business milestones', async () => {
  const vocabulary = await source('src/views/vocabulary.js');
  const reading = await source('src/views/reading.js');
  const chat = await source('src/views/chat.js');
  assert.match(vocabulary, /vocab\.rendered/);
  assert.match(reading, /reading\.rendered/);
  assert.match(reading, /reading\.word_lookup/);
  assert.match(reading, /reading\.completed/);
  assert.match(chat, /chat\.request/);
  assert.match(chat, /vocab\.import/);
});
