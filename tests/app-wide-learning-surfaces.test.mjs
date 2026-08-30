import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = path => readFile(new URL(path, import.meta.url), 'utf8');

test('reading declares English title, body and sentence guide as compact lookup surfaces', async () => {
  const reading = await source('../src/views/reading.js');
  assert.match(reading, /import \{ bindLearningTextLookup,/);
  assert.match(reading, /class="reading-title"[^>]*data-learning-text="click"/);
  assert.match(reading, /class="en-paragraph"[^>]*data-learning-text="click"/);
  assert.match(reading, /class="sentence-guide-source"[^>]*data-learning-text="click"/);
  assert.doesNotMatch(reading, /bindReadingStyleWordLookup\(\{/);
});

test('exam practice declares passage and stems for click lookup while options are long-press only', async () => {
  const practice = await source('../src/views/exam-practice.js');
  assert.match(practice, /import \{ bindLearningTextLookup,/);
  assert.match(practice, /markExamLearningTextSurfaces\(/);
  assert.match(practice, /\.exam-option[^\n]+data-learning-text[^\n]+longpress/s);
  assert.match(practice, /bindLearningTextLookup\(\{/);
  assert.doesNotMatch(practice, /bindReadingStyleWordLookup\(\{/);
});

test('exam review and results use the shared lookup binding and exclude translated option analysis', async () => {
  const [review, result] = await Promise.all([
    source('../src/views/exam-review.js'),
    source('../src/views/exam-result.js')
  ]);
  assert.match(review, /bindLearningTextLookup\(\{/);
  assert.match(review, /data-learning-text="click"/);
  assert.match(review, /data-word-lookup="disabled"/);
  assert.match(result, /bindLearningTextLookup\(\{/);
});

test('AI analysis, assessment and review study surfaces share the delegated lookup lifecycle', async () => {
  const [analysis, assessment, flashcard, contextReview, wordDetail, studyStage, studyMaterials] = await Promise.all([
    source('../src/components/ai-analysis.js'),
    source('../src/views/assessment.js'),
    source('../src/views/flashcard.js'),
    source('../src/views/context-review.js'),
    source('../src/components/word-study-detail.js'),
    source('../src/components/word-study-stage.mjs'),
    source('../src/components/word-study-materials.mjs')
  ]);
  for (const file of [analysis, assessment, flashcard, contextReview, wordDetail]) {
    assert.match(file, /bindLearningTextLookup\(\{/);
  }
  assert.match(analysis, /ai-original-sentence[^>]*data-learning-text="click"/);
  assert.match(analysis, /ai-result-content[^>]*data-learning-text="click"/);
  assert.match(assessment, /assessment-article[^>]*data-learning-text="click"/);
  assert.match(studyStage, /data-example-text[^>]*data-learning-text="click"/);
  assert.match(studyMaterials, /data-example-text[^>]*data-learning-text="click"/);
  assert.match(contextReview, /context-review-sentence[^>]*data-learning-text="click"/);
  assert.match(studyMaterials, /word-study-phrase-term[^>]*data-learning-text="click"/);
});

test('home lookup is limited to explicit guided-learning cards and does not mark chat messages', async () => {
  const [chat, guidedCard] = await Promise.all([
    source('../src/views/chat.js'),
    source('../src/components/guided-learning-card.mjs')
  ]);
  assert.doesNotMatch(chat, /^import \{ bindLearningTextLookup \} from '.+reading-word-lookup\.js';$/m);
  assert.match(chat, /import\('\.\.\/components\/reading-word-lookup\.js'\)/);
  assert.match(chat, /querySelector\('\[data-learning-text="click"\]'\)/);
  assert.match(chat, /bindLearningTextLookup\(\{/);
  assert.match(guidedCard, /guided-learning-card[^>]*data-learning-text="click"/);
  assert.doesNotMatch(chat, /class="message user-message"[^>]*data-learning-text/);
  assert.match(chat, /_learningTextLookupCleanup\?\.\(\)/);
});
