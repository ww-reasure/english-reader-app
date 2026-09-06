import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const chatSource = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');

const between = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + 1);
  assert.ok(start >= 0, `missing marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
};

const submitSource = between(chatSource, 'async submitComposer(', 'async handleDailyReport(');
const buttonHelpers = between(chatSource, 'setGenerateButtonStop() {', 'ensureTargetTrackBeforeGeneration');

test('the user bubble is appended before image upload work starts', () => {
  const appendIndex = submitSource.indexOf('this.appendConversation({');
  const prepareIndex = submitSource.indexOf('prepareForSend(draftGroupId');
  assert.ok(appendIndex > 0, 'submitComposer must append the user message');
  assert.ok(prepareIndex > appendIndex, 'user bubble must render before uploads begin');
  assert.match(submitSource, /DB\.getChatImageGroup\(draftGroupId\)/);
  assert.match(submitSource, /pendingUploadDraftId/);
  assert.match(submitSource, /input\.value = ''/);
});

test('upload progress updates the thinking label instead of leaving the UI silent', () => {
  assert.match(submitSource, /showThinking\(imageGroup \? '正在上传图片…' : undefined\)/);
  assert.match(submitSource, /onProgress:\s*\(\{\s*uploaded,\s*total\s*\}\)/);
  assert.match(submitSource, /updateThinkingLabel\(`正在上传图片 \$\{uploaded\}\/\$\{total\}…`\)/);
  assert.match(submitSource, /updateThinkingLabel\('正在查看图片并整理学习重点…'\)/);
  assert.match(chatSource, /updateThinkingLabel\(label\)/);
});

test('a failed upload takes the pending bubble back and restores the draft strip', () => {
  assert.match(submitSource, /discardPendingUploadMessage/);
  const calls = submitSource.match(/discardPendingUploadMessage\(\)/g) || [];
  assert.ok(calls.length >= 3, 'superseded and failed requests must both discard the pending bubble');
  assert.match(submitSource, /图片发送失败：\$\{reason\}。图片已放回输入区，可重试。/);
  assert.match(submitSource, /removeMessages\('home', message => message\.id === userMessageId\)/);
  assert.match(submitSource, /renderImageDraft\(pendingUploadDraftId\)/);
});

test('the send button becomes a stop button for the duration of a home request', () => {
  assert.match(submitSource, /this\.setGenerateButtonStop\(\)/);
  assert.match(submitSource, /this\.resetGenerateButton\(\)/);
  assert.match(chatSource, /dataset\.generateMode === 'stop'/);
  assert.match(chatSource, /stopHomeChatRequest/);
  assert.match(buttonHelpers, /dataset\.generateMode = 'stop'/);
  assert.match(buttonHelpers, /fa-stop/);
  assert.match(buttonHelpers, /homeRequestGate\.invalidate\(\)/);
  assert.match(buttonHelpers, /chatService\.cancel\('home'\)/);
  assert.match(buttonHelpers, /delete generateButton\.dataset\.generateMode/);
  assert.match(buttonHelpers, /fa-arrow-up/);
});

test('thinking indicator animates and reports elapsed wait time', () => {
  assert.match(chatSource, /chat-thinking-dots/);
  assert.match(chatSource, /chat-thinking-elapsed/);
  assert.match(chatSource, /_thinkingElapsedTimer/);
  assert.match(styleSource, /chat-thinking-bounce/);
  assert.match(styleSource, /@media \(prefers-reduced-motion: reduce\)[^}]*\{[^}]*chat-thinking-dots/);
});

test('image send state no longer discards row information', () => {
  assert.match(chatSource, /const currentRows = Array\.isArray\(rows\) \? rows : \[\];/);
  assert.doesNotMatch(chatSource, /rows \|\| \(this\.imageDraftGroupId \? \[\] : \[\]\)/);
});
