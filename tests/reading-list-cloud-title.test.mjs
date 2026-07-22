import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('reading shelf renders cloud-provided Chinese titles without invoking the local AI client', async () => {
  const source = await readFile(new URL('../src/views/reading-list.js', import.meta.url), 'utf8');

  assert.match(source, /article\.titleZh/);
  assert.doesNotMatch(source, /import\s+\{\s*API\s*\}/);
  assert.doesNotMatch(source, /_translateTitles/);
  assert.doesNotMatch(source, /chat\/completions/);
});

test('article sync retains the cloud-provided Chinese title for offline shelf use', async () => {
  const source = await readFile(new URL('../src/db.js', import.meta.url), 'utf8');

  assert.match(source, /titleZh:\s*serverArticle\.titleZh/);
});
