import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const chat = (await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
const css = (await readFile(new URL('../css/style.css', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');

test('home composer routes only eligible learning requests into choice, detailed or guided paths', () => {
  assert.match(chat, /classifyHomeLearningRequest/);
  assert.match(chat, /home_learning_response_mode/);
  assert.match(chat, /route === 'choose'/);
  assert.match(chat, /requestGuidedLearning/);
  assert.match(chat, /requestDetailedLearning/);
});

test('home restores and updates persistent learning cards without duplicating the source message', () => {
  assert.match(chat, /kind === 'learning_mode_choice'/);
  assert.match(chat, /kind === 'guided_learning'/);
  assert.match(chat, /conversationStore\.replaceMessage\('home'/);
  assert.match(chat, /sourceMessageId/);
  assert.match(chat, /guidedReplyTarget/);
});

test('guided learning supports local controls, composer answers and recovery actions', () => {
  for (const token of [
    'data-guided-action', 'data-learning-mode', 'data-guided-failure-action',
    'recordGuidedChoice', 'recordGuidedFreeResponse', 'setGuidedLearningStatus'
  ]) assert.match(chat, new RegExp(token));
  assert.match(chat, /create_guided_learning/);
  assert.match(chat, /adapt_guided_learning/);
  assert.match(chat, /currentSession\.revision !== target\.expectedRevision\) return/);
});

test('guided learning cards have responsive app-theme styles and no horizontal overflow', () => {
  for (const selector of [
    '.learning-mode-choice-card', '.guided-learning-card', '.guided-learning-progress',
    '.guided-learning-options', '.guided-learning-reply-chip', '.guided-learning-failure-card'
  ]) assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(css, /\.guided-learning-card[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.match(css, /@media\s*\(max-width:\s*599px\)[\s\S]*?\.guided-learning-card/);
});
