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
  assert.match(source, /import \{ LEARNING_TOOLS, LearningAgent \} from '\.\.\/components\/learning-agent\.js';/);
  assert.match(source, /appClearContextBtn/);
  assert.match(source, /conversationStore\.clear\('home'\)/);
  assert.match(source, /resetGenerateButton\(\)/);
  assert.match(source, /文章定制中/);
  assert.match(source, /article-generation-status/);
  assert.match(source, /HOME_LEARNING_TOOLS/);
});
