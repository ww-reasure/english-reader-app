import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

async function read(relativePath) {
  return (await readFile(new URL(relativePath, import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
}

function extractFunction(source, name) {
  const marker = `export function ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${name} export`);
  const end = source.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `could not isolate ${name}`);
  return Function(`return (${source.slice(start, end + 2).replace(/^export /, '')})`)();
}

test('flashcard creates one timer per render and writes one summary on result', async () => {
  const source = await read('../src/views/flashcard.js');

  assert.match(source, /new StudySessionTimer/);
  assert.match(source, /type:\s*ActivityType\.REVIEW_SESSION_SUMMARY/);
  assert.match(source, /mode:\s*this\.practiceScope\s*\?\s*'practice'\s*:\s*'flashcard'/);
  assert.match(source, /noteReviewActivity|noteActivity/);
  assert.match(source, /dedupeKey:\s*`review-summary:/);
});

test('context review summary carries known uncertain unknown and missing counts', async () => {
  const source = await read('../src/views/context-review.js');
  const buildReviewSummary = extractFunction(source, 'buildReviewSummary');

  assert.deepEqual(buildReviewSummary({
    counts: { known: 2, uncertain: 1, unknown: 1, skipped: 0 },
    missing: 1
  }), { known: 2, uncertain: 1, unknown: 1, skipped: 0, missing: 1 });
});

test('partial cleanup is marked partial and is not presented as completed', async () => {
  const [flashcard, contextReview] = await Promise.all([
    read('../src/views/flashcard.js'),
    read('../src/views/context-review.js')
  ]);

  assert.match(flashcard, /persistReviewSummary\('partial'\)/);
  assert.match(contextReview, /persistReviewSummary\('partial'\)/);
  assert.doesNotMatch(flashcard, /cleanup\(\)[\s\S]{0,1000}status:\s*'completed'/);
});
