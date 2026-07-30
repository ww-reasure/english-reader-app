import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('all review-reading entry points delegate to the one-by-one four-batch home workflow', async () => {
  const [chat, flashcard, reading] = await Promise.all([
    readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/flashcard.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/reading.js', import.meta.url), 'utf8')
  ]);

  assert.match(chat, /planReviewBatches/);
  assert.match(chat, /maxArticles:\s*4/);
  assert.match(chat, /正在制作第 \$\{index \+ 1\}/);
  assert.match(chat, /async executeReviewGenerationJob\(job, runtime\)/);
  assert.match(chat, /completedBatches/);
  assert.match(chat, /generationJobId: batchGenerationJobId/);
  assert.match(chat, /await this\.publishHomeGenerationArticle\(job, article, '', runtime, index\)/);
  assert.match(chat, /addReviewContinueAction/);
  assert.match(flashcard, /ChatView\.generateReviewReadings/);
  assert.match(reading, /ChatView\.generateReviewReadings/);
});
