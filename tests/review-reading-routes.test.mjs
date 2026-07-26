import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('all review-reading routes use bounded shared article generation instead of the legacy API', async () => {
  const sources = await Promise.all([
    readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/flashcard.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/reading.js', import.meta.url), 'utf8')
  ]);

  for (const source of sources) {
    assert.match(source, /ArticleGenerationTool/);
    assert.match(source, /\.execute\(/);
    assert.match(source, /chunkTargetWords\(/);
    assert.match(source, /articleFields:\s*\{/);
    assert.doesNotMatch(source, /API\.generateReviewArticle\(/);
    assert.doesNotMatch(source, /API\.generateArticle\(/);
  }
});

test('homepage review generation keeps already-saved cards visible when a later batch fails', async () => {
  const chatSource = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');

  assert.match(chatSource, /let articles = \[\];[\s\S]*?try \{[\s\S]*?catch \(err\) \{[\s\S]*?if \(articles\.length\b/);
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
  for (const source of [flashcardSource, readingSource]) {
    assert.match(source, /const generationSession = ChatView\.startArticleGenerationSession\(\)/);
    assert.match(source, /signal: generationSession\.signal/);
    assert.match(source, /isActive: generationSession\.isActive/);
    assert.match(source, /generationSession\.release\(\)/);
  }
});
