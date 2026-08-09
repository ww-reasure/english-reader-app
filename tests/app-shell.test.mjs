import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

async function loadShell() {
  const source = await readFile(new URL('../src/components/app-shell.js', import.meta.url), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

test('maps article routes to the bookshelf drawer item', async () => {
  const { AppShell } = await loadShell();
  assert.deepEqual(AppShell.getRouteMeta('#/reading/42'), { navKey: 'reading-list', title: '阅读', headerMode: 'back', tabletLayout: 'focus' });
  assert.equal(AppShell.getRouteMeta('#/history').title, '阅读记录');
});

test('maps the exam route to a dedicated drawer item', async () => {
  const { AppShell } = await loadShell();
  assert.deepEqual(AppShell.getRouteMeta('#/exam'), { navKey: 'exam', title: '真题训练', headerMode: 'drawer', tabletLayout: 'rail' });
});

test('maps practice and result routes to the exam drawer item', async () => {
  const { AppShell } = await loadShell();
  assert.deepEqual(AppShell.getRouteMeta('#/exam/practice/attempt_1'), { navKey: 'exam', title: '真题练习', headerMode: 'back', tabletLayout: 'focus' });
  assert.deepEqual(AppShell.getRouteMeta('#/exam/result/attempt_1'), { navKey: 'exam', title: '练习结果', headerMode: 'back', tabletLayout: 'focus' });
});

test('catalog, review and history use back navigation instead of the global drawer', async () => {
  const { AppShell } = await loadShell();
  assert.equal(AppShell.getRouteMeta('#/exam/review').headerMode, 'back');
  assert.equal(AppShell.getRouteMeta('#/exam/history').headerMode, 'back');
  assert.equal(AppShell.getRouteMeta('#/exam/catalog/reading_mcq').headerMode, 'back');
});

test('keeps flashcard review in the standard English Learning header', async () => {
  const { AppShell } = await loadShell();
  const meta = AppShell.getRouteMeta('#/flashcard');

  assert.deepEqual(meta, { navKey: 'vocab', title: '单词复习', headerMode: 'back', tabletLayout: 'focus' });
});

test('reserves the clear-context header action for the chat route', async () => {
  const source = await readFile(new URL('../src/components/app-shell.js', import.meta.url), 'utf8');
  assert.match(source, /meta\.navKey === 'chat'/);
  assert.match(source, /appClearContextBtn/);
  assert.match(source, /app-header-actions/);
});

test('keeps the settings action on the chat home only', async () => {
  const { AppShell } = await loadShell();

  assert.match(AppShell.getHeaderActions('chat'), /href="#\/settings"/);
  assert.doesNotMatch(AppShell.getHeaderActions('reading-list'), /href="#\/settings"/);
  assert.doesNotMatch(AppShell.getHeaderActions('vocab'), /href="#\/settings"/);
});

test('keeps settings navigation out of non-home page content', async () => {
  const [profile, calibration] = await Promise.all([
    readFile(new URL('../src/views/stats.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/calibration.js', import.meta.url), 'utf8')
  ]);
  assert.doesNotMatch(profile, /href="#\/settings"/);
  assert.doesNotMatch(calibration, /href="#\/settings"/);
});
