import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const chatSource = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../src/api.js', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');

const between = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + 1);
  assert.ok(start >= 0, `missing marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
};

const submitSource = between(chatSource, 'async submitComposer(', 'async handleDailyReport(');
const stopSource = between(chatSource, 'stopHomeChatRequest() {', 'resetGenerateButton() {');

test('chat replies stream through the deltas channel into a preview bubble', () => {
  assert.match(submitSource, /onDelta: appendStreamDelta/);
  assert.match(submitSource, /onRoundEnd: handleStreamRoundEnd/);
  assert.match(submitSource, /chat-stream-preview/);
  assert.match(submitSource, /streamState\.text \+= text/);
  assert.match(submitSource, /setTimeout\(flushStreamPreview, 70\)/);
  assert.match(submitSource, /this\.removeThinking\(\);\s*\n\s*ensureStreamNode\(\)/);
  assert.match(chatSource, /content\.textContent = `\$\{streamState\.text\}▍`/);
  assert.match(styleSource, /\.chat-stream-preview \{/);
});

test('tool-call rounds clear the preview and return to a tool thinking label', () => {
  assert.match(submitSource, /if \(reply\?\.tool_calls\?\.length\) \{\s*\n\s*this\.clearHomeStreamPreview\(\)/);
  assert.match(submitSource, /正在调用工具…/);
});

test('the preview is discarded on publish, failure and every request teardown', () => {
  assert.match(submitSource, /this\.removeArticleGenerationStatus\(\);\s*\n\s*this\.clearHomeStreamPreview\(\)/);
  assert.match(chatSource, /clearHomeStreamPreview\(\) \{/);
  assert.match(submitSource, /this\.clearHomeStreamPreview\(\);\s*\n\s*this\._homeStreamState = null;/);
  assert.match(submitSource, /this\._homeStreamState = streamState;/);
});

test('stopping a request keeps the streamed partial with a stopped note', () => {
  assert.match(stopSource, /String\(this\._homeStreamState\?\.text \|\| ''\)\.trim\(\)/);
  assert.match(stopSource, /chatService\.cancel\('home'\)/);
  assert.match(stopSource, /（已停止）/);
  const publishIndex = stopSource.indexOf('appendConversation');
  const clearIndex = stopSource.indexOf('clearHomeStreamPreview');
  assert.ok(clearIndex >= 0 && publishIndex > clearIndex, 'the partial text must be captured before the preview is cleared');
});

test('the api exposes a streaming chat/completions request on the existing fetchStream path', () => {
  assert.match(apiSource, /async chatCompletionStream\(messages, \{/);
  assert.match(apiSource, /return this\.fetchStream\('\/chat\/completions', body, 60000, signal, onEvent\);/);
  assert.match(apiSource, /onDelta = null\n  \} = \{\}\) \{\n    if \(!deepSeekResponsesClient\)/);
});
