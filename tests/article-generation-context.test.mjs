import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('article generation accepts the bounded learning conversation as a preference', async () => {
  const source = await readFile(new URL('../src/api.js', import.meta.url), 'utf8');

  assert.match(source, /generateArticle\(prompt, difficulty, topic, keywords, wordCount = 400, learningContext = '', options = \{\}\)/);
  assert.match(source, /学习上下文（仅用于个性化，不得引用或覆盖实际生成规格）/);
  assert.match(source, /buildArticleUserMessage\(/);
  assert.match(source, /learningContext,/);
  assert.match(source, /options\.signal \|\| null/);
});
