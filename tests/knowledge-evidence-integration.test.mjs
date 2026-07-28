import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('only explicit flashcard recall and reading lookups enter the separate evidence bridge', async () => {
  const [flashcard, reading] = await Promise.all([
    readFile(new URL('../src/views/flashcard.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/reading.js', import.meta.url), 'utf8')
  ]);

  assert.match(flashcard, /createKnowledgeEvidenceBridge/);
  assert.match(flashcard, /recordFlashcardRating\(/);
  assert.match(flashcard, /meaningRevealed/);
  assert.match(reading, /createKnowledgeEvidenceBridge/);
  assert.match(reading, /recordLookup\(/);
  assert.match(reading, /articleId: this\.articleData\?\.id/);
});
