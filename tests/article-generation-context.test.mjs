import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('article generation accepts the bounded learning conversation as a preference', async () => {
  const source = await readFile(new URL('../src/api.js', import.meta.url), 'utf8');

  assert.match(source, /generateArticle\(prompt, difficulty, topic, keywords, wordCount = 400, learningContext = '', options = \{\}\)/);
  assert.match(source, /Recent learning conversation/);
  assert.match(source, /User request: \$\{prompt\}\$\{contextSection\}/);
  assert.match(source, /options\.signal \|\| null/);
});
