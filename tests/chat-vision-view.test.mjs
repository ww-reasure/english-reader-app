import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const chatSource = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');

test('composer opens image actions and removes generation settings from chat', () => {
  assert.match(chatSource, /aria-label="添加图片"/);
  assert.match(chatSource, /data-image-action="camera"/);
  assert.match(chatSource, /data-image-action="gallery"/);
  assert.doesNotMatch(chatSource, /id="difficultySelect"/);
  assert.doesNotMatch(chatSource, /id="topicSelect"/);
});

test('image drafts expose ordered, removable, retryable and previewable controls', () => {
  assert.match(chatSource, /data-chat-image-draft-id/);
  assert.match(chatSource, /data-image-order/);
  assert.match(chatSource, /data-chat-image-remove/);
  assert.match(chatSource, /data-chat-image-retry/);
  assert.match(chatSource, /data-chat-image-preview/);
  assert.match(chatSource, /aria-live/);
  assert.match(chatSource, /maxImagesPerMessage/);
});

test('image requests use the required learning prompt', () => {
  assert.match(chatSource, /DEFAULT_IMAGE_LEARNING_PROMPT/);
  assert.match(chatSource, /结合我当前的英语学习目标/);
  assert.match(chatSource, /按图片顺序/);
  assert.match(chatSource, /看不清的地方请明确指出/);
});

test('clearing the home conversation also clears durable image context', () => {
  assert.match(chatSource, /conversationStore\.clear\(['"]home['"]\)/);
  assert.match(chatSource, /imageService\.clearConversation\(['"]home['"]\)/);
  assert.match(chatSource, /clearHistoryConfirmed/);
});
