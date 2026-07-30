import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('all review-reading routes use the bounded home generator instead of the legacy API', async () => {
  const [chat, flashcard, reading] = await Promise.all([
    readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/flashcard.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/reading.js', import.meta.url), 'utf8')
  ]);

  assert.match(chat, /ArticleGenerationTool/);
  assert.match(chat, /planReviewBatches/);
  assert.match(chat, /articleFields:\s*\{/);
  for (const source of [chat, flashcard, reading]) {
    assert.doesNotMatch(source, /API\.generateReviewArticle\(/);
    assert.doesNotMatch(source, /API\.generateArticle\(/);
  }
  assert.match(flashcard, /ChatView\.generateReviewReadings/);
  assert.match(reading, /ChatView\.generateReviewReadings/);
});

test('homepage review generation keeps already-saved cards visible when a later batch fails', async () => {
  const chatSource = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');

  assert.match(chatSource, /const articles = \[\];[\s\S]*?await this\.publishHomeGenerationArticle\(job, article, '', runtime, index\)/);
  assert.match(chatSource, /catch \(error\) \{[\s\S]*?this\.addGenerationFailure\(failure\)/);
});

test('review routes use the page-independent coordinator instead of the chat cancellation session', async () => {
  const [chatSource, flashcardSource, readingSource] = await Promise.all([
    readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/flashcard.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/reading.js', import.meta.url), 'utf8')
  ]);

  assert.match(chatSource, /HomeGenerationCoordinator/);
  assert.match(chatSource, /startHomeGenerationJob\(\{[\s\S]*?kind: 'review'/);
  assert.match(chatSource, /signal: runtime\.signal/);
  assert.match(chatSource, /isActive: runtime\.isCurrent/);
  const cleanupStart = chatSource.indexOf('  cleanup() {');
  const cleanupEnd = chatSource.indexOf('\n};', cleanupStart);
  assert.ok(cleanupStart >= 0 && cleanupEnd > cleanupStart, 'chat cleanup must remain inspectable');
  assert.doesNotMatch(chatSource.slice(cleanupStart, cleanupEnd), /homeGenerationCoordinator\.cancel/);
  for (const source of [flashcardSource, readingSource]) assert.match(source, /ChatView\.generateReviewReadings/);
});
