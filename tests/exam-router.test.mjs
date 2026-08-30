import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('router registers #/exam while keeping #/chat as the home route', async () => {
  const [source, routes] = await Promise.all([
    readFile(new URL('../src/router.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/router-routes.mjs', import.meta.url), 'utf8')
  ]);
  assert.doesNotMatch(source, /from ['"]\.\/views\//);
  assert.match(source, /createNavigationController/);
  assert.match(routes, /routeKey: 'chat'/);
  assert.match(routes, /routeKey: 'exam-home'/);
  assert.match(routes, /routeKey: 'exam-catalog'/);
  assert.match(routes, /routeKey: 'exam-history'/);
  assert.match(routes, /routeKey: 'exam-practice'/);
  assert.match(routes, /routeKey: 'exam-result'/);
  assert.match(routes, /routeKey: 'exam-review'/);
  assert.match(routes, /const safeDecode = value =>/);
  assert.match(routes, /safeDecode\(attemptId/);
  assert.match(source, /navigation\.navigate\(hash\)/);
});

test('Review Center groups by unit and allows autonomous review with full details', async () => {
  const source = await readFile(new URL('../src/views/exam-review.js', import.meta.url), 'utf8');
  assert.match(source, /startReviewCenterAttempt/);
  assert.match(source, /review_center_manual/);
  assert.match(source, /data-review-question-detail/);
  assert.match(source, /bindLearningTextLookup/);
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
  const source = await readFile(new URL('../src/router-routes.mjs', import.meta.url), 'utf8');
  assert.match(source, /routeKey: 'exam-catalog'/);
  assert.match(source, /routeKey: 'exam-history'/);
  assert.match(source, /safeDecode\(/);
});
