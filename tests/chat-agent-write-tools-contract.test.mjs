import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const chatSource = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');
const serviceSource = await readFile(new URL('../src/components/chat-service.js', import.meta.url), 'utf8');
const builderSource = await readFile(new URL('../src/components/context-builder.js', import.meta.url), 'utf8');

test('both write tools are registered in the home agent tool set', () => {
  assert.match(chatSource, /SAVE_READING_CARD_TOOL, PREPARE_WORD_IMPORT_TOOL\]/);
  assert.match(chatSource, /articleImportTool = new ArticleImportTool\(\{ db: DB, resolveDifficulty: \(\) => Config\.get\('exam_level'\) \}\)/);
  assert.match(chatSource, /wordImportPlanTool = new WordImportPlanTool\(\{ service: wordImportService \}\)/);
  assert.match(chatSource, /name === 'save_reading_card'/);
  assert.match(chatSource, /name === 'prepare_word_import'/);
});

test('imported articles publish through the existing article card path', () => {
  assert.match(chatSource, /artifact\.type === 'article' && !this\.hasPublishedGenerationArticle/);
  assert.match(chatSource, /artifact\.type === 'word_import_plan'/);
  assert.match(chatSource, /addWordImportPlan\(artifact\)/);
});

test('word import plan cards render, persist and restore across sessions', () => {
  assert.match(chatSource, /kind === 'word_import_plan'/g);
  assert.match(chatSource, /addWordImportPlanToDOM\(message\.plan, messageId\)/);
  assert.match(chatSource, /data-word-import-action="confirm"/);
  assert.match(chatSource, /data-word-import-action="dismiss"/);
  assert.match(chatSource, /wordImportService\.createPlan\(plan\.wordsText, \{ source: 'chat' \}\)/);
  assert.match(chatSource, /wordImportService\.execute\(freshPlan\)/);
  assert.match(chatSource, /conversationStore\.replaceMessage\('home', item => item\.kind === 'word_import_plan'/);
});

test('system prompt documents when to save cards and how word confirmation works', () => {
  assert.match(builderSource, /save_reading_card/);
  assert.match(builderSource, /prepare_word_import/);
  assert.match(builderSource, /不得在确认前声称单词已写入词库/);
});
