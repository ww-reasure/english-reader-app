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

  assert.match(chatSource, /const articles = \[\];[\s\S]*?publishReviewArticles\(\[result\.article\], generationSession\)/);
  assert.match(chatSource, /catch \(error\) \{[\s\S]*?this\.addGenerationFailure\(failure\)/);
});

test('review routes bind generation to the chat cancellation session', async () => {
  const [chatSource, flashcardSource, readingSource] = await Promise.all([
    readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/flashcard.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/reading.js', import.meta.url), 'utf8')
  ]);

  assert.match(chatSource, /startArticleGenerationSession\(requestVersion = homeRequestGate\.version\)/);
  assert.match(chatSource, /const generationSession = this\.startArticleGenerationSession\(requestVersion\)/);
  assert.match(chatSource, /signal: generationSession\.signal/);
  assert.match(chatSource, /isActive: isReviewSessionActive/);
  assert.match(chatSource, /generationSession\.release\(\)/);
  for (const source of [flashcardSource, readingSource]) assert.match(source, /ChatView\.generateReviewReadings/);
});
