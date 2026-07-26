import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('assessment reports observable reading performance instead of vocabulary population', async () => {
  const source = await readFile(new URL('../src/views/assessment.js', import.meta.url), 'utf8');

  assert.match(source, /import \{ buildReadingProfile \} from '\.\.\/reading-profile\.mjs';/);
  assert.match(source, /comprehensionCorrect/);
  assert.match(source, /explicitLookups/);
  assert.match(source, /averageWpm/);
  assert.match(source, /assessment_profile/);
  assert.doesNotMatch(source, /estimatedVocab/);
  assert.doesNotMatch(source, /assessment_vocab/);
});

test('assessment articles use the shared measurable difficulty validator and retry once', async () => {
  const source = await readFile(new URL('../src/views/assessment.js', import.meta.url), 'utf8');

  assert.match(source, /getDifficultyProfile\(exam, challenge\)/);
  assert.match(source, /formatProfileConstraints\(profile\)/);
  assert.match(source, /validateArticle\(result\.content \|\| '', profile\)/);
  assert.match(source, /for \(let attempt = 0; attempt < 2; attempt\+\+\)/);
  assert.match(source, /questionValidation = normalizeQuestionSet\(result\.questions\)/);
  assert.match(source, /if \(!validation\.passed \|\| !questionValidation\.valid\) continue;/);
  assert.match(source, /questions: questionValidation\.questions/);
  assert.doesNotMatch(source, /API\.difficultyRules/);
});

test('assessment requires complete comprehension evidence and cancels stale generation', async () => {
  const source = await readFile(new URL('../src/views/assessment.js', import.meta.url), 'utf8');

  assert.match(source, /import \{ hasCompleteAnswers, normalizeQuestionSet \} from '\.\.\/assessment-questions\.mjs';/);
  assert.match(source, /assessmentRunId/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /if \(!this\.isRunActive\(runId, controller\)\) return;/);
  assert.match(source, /hasCompleteAnswers\(article\.questions, this\.state\.quizAnswers\[articleIndex\]\)/);
  assert.match(source, /请完成全部阅读理解题后查看结果/);
});

test('assessment wait loop cannot advance a later run', async () => {
  const source = await readFile(new URL('../src/views/assessment.js', import.meta.url), 'utf8');
  const start = source.indexOf('async finishReading()');
  const end = source.indexOf('async retrySecondArticle()');
  const finishReading = source.slice(start, end);

  assert.match(finishReading, /const runId = this\.state\.assessmentRunId;/);
  assert.match(finishReading, /if \(this\.state\.assessmentRunId !== runId\) return;/);
});

test('assessment cleanup invalidates a pending wait loop immediately', async () => {
  const source = await readFile(new URL('../src/views/assessment.js', import.meta.url), 'utf8');
  const start = source.indexOf('// Clean up event listeners');
  const end = source.indexOf('async finishReading()');
  const cleanup = source.slice(start, end);

  assert.match(cleanup, /this\.state\.assessmentRunId \+= 1;/);
});
