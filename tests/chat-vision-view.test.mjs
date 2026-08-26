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

test('image drafts support mouse and touch drag sorting with button fallbacks', () => {
  assert.match(chatSource, /draggable="true"/);
  assert.match(chatSource, /data-chat-image-drag-handle/);
  assert.match(chatSource, /addEventListener\('dragstart'/);
  assert.match(chatSource, /addEventListener\('drop'/);
  assert.match(chatSource, /addEventListener\('pointerdown'/);
  assert.match(chatSource, /reorderImageDraft/);
  assert.match(chatSource, /data-chat-image-move="up"/);
  assert.match(chatSource, /data-chat-image-move="down"/);
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

test('image submission resolves a request-level vision model before uploading', () => {
  assert.match(chatSource, /resolveModelForRequest/);
  assert.match(chatSource, /resolveModelForRequest\(\{[\s\S]*hasImages[\s\S]*\}\)/);
  assert.match(chatSource, /modelOverride:\s*requestModel\.model/);
  assert.match(chatSource, /custom_model_image_capability_unknown/);
});

test('image upload shares cancellation and stale-request guards with the home request', () => {
  assert.match(chatSource, /_imageRequestController\?\.abort\(\)/);
  assert.match(chatSource, /prepareForSend\(draftGroupId,\s*\{\s*signal:\s*imageRequestController\.signal\s*\}\)/);
  assert.match(chatSource, /if\s*\(!isCurrentRequest\(\)\)\s*return/);
});

test('active image context is visible, detachable and restorable from history', () => {
  assert.match(chatSource, /renderActiveImageChip/);
  assert.match(chatSource, /data-chat-image-detach/);
  assert.match(chatSource, /detachGroup/);
  assert.match(chatSource, /activateImageGroup/);
  assert.match(chatSource, /继续询问这组图片/);
});

test('image viewer supports navigation and zoom while the image sheet has a cancel action', () => {
  assert.match(chatSource, /data-image-action="cancel"/);
  assert.match(chatSource, /data-chat-image-viewer="previous"/);
  assert.match(chatSource, /data-chat-image-viewer="next"/);
  assert.match(chatSource, /data-chat-image-viewer="zoom-in"/);
  assert.match(chatSource, /data-chat-image-viewer="zoom-out"/);
});

test('selecting more than twelve images keeps the accepted prefix and reports the remainder', () => {
  assert.match(chatSource, /selected\.slice\(0,\s*availableSlots\)/);
  assert.match(chatSource, /已保留前/);
  assert.match(chatSource, /deleteGroup\(previousGroupId\)/);
});
