import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('chat view uses one composer for learning chat and article generation', async () => {
  const source = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /chat-mode-switch/);
  assert.match(source, /classifyComposerIntent/);
  assert.match(source, /buildGenerationContext/);
  assert.match(source, /问问题，或说“生成一篇/);
  assert.match(source, /ChatService/);
});
