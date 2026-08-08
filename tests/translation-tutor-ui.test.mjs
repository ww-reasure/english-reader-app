import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('submitted translation explanation owns the explicit score trigger and restores persisted feedback', async () => {
  const source = await readFile(new URL('../src/views/exam-practice.js', import.meta.url), 'utf8');
  assert.match(source, /examTranslationTutorScore/);
  assert.match(source, /scoreTranslation\(/);
  assert.match(source, /getTranslationTrainingFeedback\(/);
  assert.match(source, /AI 训练评分，仅供学习参考/);
  assert.match(source, /AI 推荐译法/);
  assert.match(source, /本题未填写译文/);
});

test('translation result selection is explicitly sourced and enables Ask AI only after submit', async () => {
  const [rendererSource, practiceSource] = await Promise.all([
    readFile(new URL('../src/exam/renderers/translation-renderer.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/exam-practice.js', import.meta.url), 'utf8')
  ]);
  assert.match(rendererSource, /data-selection-source="translation_source"/);
  assert.match(rendererSource, /data-selection-source="user_translation"/);
  assert.match(rendererSource, /data-selection-source="reference_translation"/);
  assert.match(rendererSource, /data-selection-source="local_analysis"/);
  const selectionMethod = practiceSource.slice(practiceSource.indexOf('  bindSubmittedSelection()'), practiceSource.indexOf('  replaceMenuWithBack()'));
  assert.match(selectionMethod, /allowAskAI: true/);
  assert.doesNotMatch(selectionMethod, /unit\?\.type === 'translation' \|\| !quote/);
});

test('translation Tutor dialog never auto-sends an objective initial analysis and renders saved feedback in its existing thread', async () => {
  const source = await readFile(new URL('../src/exam/exam-tutor-dialog.js', import.meta.url), 'utf8');
  assert.match(source, /message\?\.kind === 'translation_training_feedback'/);
  assert.match(source, /ai_feedback/);
  assert.match(source, /!hasMessages && !this\.isTranslation/);
  assert.match(source, /关于这段内容，你想问什么？/);
});
