import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readFileText(relativePath) {
  return (await readFile(new URL(relativePath, import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
}

test('ordinary reading keeps vocabulary marking opt-in while review reading remains marked', async () => {
  const [config, reading] = await Promise.all([
    readFileText('../src/config.js'),
    readFileText('../src/views/reading.js')
  ]);

  assert.match(config, /reading_word_marking:\s*'false'/);
  assert.match(reading, /wordMarkingEnabled\s*=\s*Config\.get\('reading_word_marking'\)\s*===\s*'true'/);
  assert.match(reading, /this\.reviewMode\s*\?\s*this\._highlightReviewWords/);
  assert.match(reading, /this\.wordMarkingEnabled\s*\?\s*this\._highlightLearningWords/);
  assert.match(reading, /toggleWordMarking\(\)/);
  assert.match(reading, /词汇标记/);
});

test('highlight wrappers remain selectable for sentence-level long press', async () => {
  const [reading, css, analysis] = await Promise.all([
    readFileText('../src/views/reading.js'),
    readFileText('../css/style.css'),
    readFileText('../src/components/ai-analysis.js')
  ]);

  assert.match(reading, /class="review-word/);
  assert.match(reading, /class="learning-word/);
  assert.match(css, /\.review-word,\.learning-word\s*\{[^}]*user-select:text/s);
  assert.match(analysis, /getParagraphTextNodes\(node\)/);
  assert.match(analysis, /createSentenceRangeForTextNodes/);
});
