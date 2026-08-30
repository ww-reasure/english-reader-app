import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('flashcard view uses non-blocking review persistence and avoids duplicate session saves', async () => {
  const source = await read('../src/views/flashcard.js');

  assert.match(source, /review-persistence\.mjs/);
  assert.match(source, /enqueueRating/);
  assert.match(source, /enqueueSession/);
  assert.doesNotMatch(source, /const wordId = this\.sessionQueue\.next\(\);\s*await this\.persistCurrentSession\(\);/s);
  assert.doesNotMatch(source, /this\.currentIndex\+\+;\s*void this\.persistCurrentSession\(\);/s);
  const rateAt = source.indexOf('const outcome = this.sessionQueue?.rate');
  const debtAfterRateAt = source.indexOf('const sessionDebt = this.sessionQueue?.getDebt');
  assert.ok(rateAt >= 0 && debtAfterRateAt > rateAt, 'session debt must include the current rating');
});

test('context review renders before persistence completes and does not double-save on next', async () => {
  const [source, persistenceSource] = await Promise.all([
    read('../src/views/context-review.js'),
    read('../src/components/context-review.js')
  ]);

  assert.match(source, /review-persistence\.mjs/);
  assert.match(source, /enqueueSession/);
  assert.match(persistenceSource, /enqueueRating/);
  assert.match(source, /this\.submitting/);
  assert.doesNotMatch(source, /this\.currentIndex \+= 1;\s*await this\.persistSession\(\);\s*await this\.showCurrent\(\);/s);
});

test('review mode documents shared candidates and separate recall/context limits', async () => {
  const [queue, mode] = await Promise.all([
    read('../src/review-queue-coordinator.mjs'),
    read('../src/views/review-mode.js')
  ]);

  assert.match(queue, /getDueSummary/);
  assert.match(mode, /20/);
  assert.match(mode, /10/);
});

test('review mode reuses one vocabulary snapshot and preloads only the selected exam track', async () => {
  const mode = await read('../src/views/review-mode.js');

  assert.match(mode, /ExamCorpus/);
  assert.match(mode, /Config/);
  assert.match(mode, /getDueSummary\(\{[^}]*words:\s*allWords/s);
  assert.match(mode, /ExamCorpus\.preload\(Config\.get\('exam_level'\)/);
});
