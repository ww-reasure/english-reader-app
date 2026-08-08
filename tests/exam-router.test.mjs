import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('router registers #/exam while keeping #/chat as the home route', async () => {
  const source = await readFile(new URL('../src/router.js', import.meta.url), 'utf8');
  assert.match(source, /import \{ ExamHomeView \}/);
  assert.match(source, /import \{ ExamCatalogView \}/);
  assert.match(source, /import \{ ExamHistoryView \}/);
  assert.match(source, /import \{ ExamPracticeView \}/);
  assert.match(source, /import \{ ExamResultView \}/);
  assert.match(source, /case hash === '#\/exam'/);
  assert.match(source, /import \{ ExamReviewView \}/);
  assert.match(source, /case hash === '#\/exam\/review'/);
  assert.match(source, /exam\/catalog/);
  assert.match(source, /case hash === '#\/exam\/history'/);
  assert.ok(source.includes('exam\\/practice'));
  assert.ok(source.includes('exam\\/result'));
  assert.match(source, /await this\.cleanupCurrentView\(\)/);
  assert.match(source, /case hash === '#\/chat'/);
});

test('Review Center is grouped by unit and starts an explicitly due review attempt', async () => {
  const source = await readFile(new URL('../src/views/exam-review.js', import.meta.url), 'utf8');
  assert.match(source, /startReviewCenterAttempt/);
  assert.match(source, /reviewEligibleQuestionKeys/);
  assert.match(source, /今日待复习/);
  assert.match(source, /翻译/);
});

test('app shell exposes a dedicated exam drawer item', async () => {
  const source = await readFile(new URL('../src/components/app-shell.js', import.meta.url), 'utf8');
  assert.match(source, /\['#\/exam', 'exam', '真题训练'\]/);
});

test('app shell maps practice and result routes to the exam drawer', async () => {
  const source = await readFile(new URL('../src/components/app-shell.js', import.meta.url), 'utf8');
  assert.match(source, /hash\.startsWith\('#\/exam\/practice\/'\)/);
  assert.match(source, /hash\.startsWith\('#\/exam\/result\/'\)/);
});

test('exam catalog and history routes remain inside the exam navigation', async () => {
  const source = await readFile(new URL('../src/router.js', import.meta.url), 'utf8');
  assert.match(source, /ExamCatalogView/);
  assert.match(source, /ExamHistoryView/);
  assert.match(source, /decodeURIComponent\(type/);
});
