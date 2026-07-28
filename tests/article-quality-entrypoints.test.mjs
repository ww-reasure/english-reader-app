import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('home owns lightweight admission and one shared observer while review pages delegate to it', async () => {
  const [chat, flashcard, reading] = await Promise.all([
    readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/flashcard.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/reading.js', import.meta.url), 'utf8')
  ]);

  assert.match(chat, /getSharedArticleQualityService/);
  assert.match(chat, /const articleQualityService = getSharedArticleQualityService\(\{\s*api:\s*API,\s*db:\s*DB\s*\}\)/);
  assert.match(chat, /admit:\s*admitArticle/);
  assert.match(chat, /inspectQuality:\s*articleQualityService\.inspectQuality/);
  assert.match(chat, /personalization:\s*generationPolicy\.personalization/);
  assert.match(chat, /validationOptions:\s*generationPolicy\.validationOptions/);

  for (const source of [flashcard, reading]) {
    assert.match(source, /ChatView\.generateReviewReadings/);
    assert.doesNotMatch(source, /new ArticleGenerationTool/);
  }
});

test('flashcard and reading review flows do not expose raw generation errors', async () => {
  const sources = await Promise.all([
    readFile(new URL('../src/views/flashcard.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/reading.js', import.meta.url), 'utf8')
  ]);

  for (const source of sources) {
    assert.doesNotMatch(source, /生成失败：\$\{err\.message\}/);
  }
});
