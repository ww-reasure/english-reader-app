import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('home chat injects the shared read-only exam learning provider', async () => {
  const source = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');
  assert.match(source, /createExamLearningOverviewProvider/);
  assert.match(source, /examLearningProvider/);
});

test('agent prompt selects reading, exam or combined data and only filters explicit years', async () => {
  const source = await readFile(new URL('../src/components/context-builder.js', import.meta.url), 'utf8');
  assert.match(source, /问阅读情况/);
  assert.match(source, /问真题或做题情况/);
  assert.match(source, /整体学习情况/);
  assert.match(source, /明确提到年份/);
  assert.match(source, /当天学习量.*get_today_learning_report/);
  assert.match(source, /明确的历史日期.*get_daily_learning_report/);
});

test('capability catalog exposes exam training, review and history as click-only actions', async () => {
  const { AppCapabilityRegistry } = await import('../src/components/app-capabilities.mjs');
  assert.equal(AppCapabilityRegistry.get('exam_training').route, '#/exam');
  assert.equal(AppCapabilityRegistry.get('exam_review').route, '#/exam/review');
  assert.equal(AppCapabilityRegistry.get('exam_history').route, '#/exam/history');
});
