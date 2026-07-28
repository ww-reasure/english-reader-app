import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the reading page uses the same foreground-time threshold as the personal-profile evidence gate', async () => {
  const source = await readFile(new URL('../src/views/reading.js', import.meta.url), 'utf8');

  assert.match(source, /import\s+\{[^}]*\bminimumActiveReadingSeconds\b[^}]*\}\s+from '\.\.\/calibration-engine\.mjs';/s);
  assert.match(source, /const minimumReadTime = minimumActiveReadingSeconds\(wordCount\);/);
  assert.match(source, /if \(elapsed < minimumReadTime\)/);
  assert.doesNotMatch(source, /MIN_READ_TIME:\s*15/);
});

test('an insufficient foreground reading clearly says it has not met the calibration condition', async () => {
  const source = await readFile(new URL('../src/views/reading.js', import.meta.url), 'utf8');

  const insufficientTimeGuard = source.match(/if \(elapsed < minimumReadTime\) \{([\s\S]*?)\n    \}/);
  assert.ok(insufficientTimeGuard, 'reading completion should guard insufficient foreground time');
  assert.match(insufficientTimeGuard[1], /前台有效阅读/);
  assert.match(insufficientTimeGuard[1], /未完成计入校准条件/);
  assert.match(insufficientTimeGuard[1], /不计入校准/);
});

test('a qualified finished reading is recorded as an article-level observation without asserting word mastery', async () => {
  const source = await readFile(new URL('../src/views/reading.js', import.meta.url), 'utf8');

  const observationCall = source.match(/knowledgeEvidenceBridge\.recordQualifiedReadingObservation\(\{([\s\S]*?)\}\);/);
  assert.ok(observationCall, 'completed reading should record an article-level observation');
  assert.match(observationCall[1], /articleId:\s*this\.articleData\?\.id/);
  assert.match(observationCall[1], /completed:\s*true/);
  assert.match(observationCall[1], /scrollDepth/);
  assert.match(observationCall[1], /activeSeconds:\s*elapsed/);
  assert.doesNotMatch(observationCall[1], /\bword:\s*/);
  assert.match(source, /await knowledgeEvidenceBridge\.recordQualifiedReadingObservation\(/);
});

test('a completed but insufficiently browsed reading explains that it is excluded from calibration progress', async () => {
  const source = await readFile(new URL('../src/views/reading.js', import.meta.url), 'utf8');

  assert.match(source, /import\s+\{[^}]*\bisQualifiedReading\b[^}]*\}\s+from '\.\.\/calibration-engine\.mjs';/s);
  assert.match(source, /const qualifiesForCalibration = isQualifiedReading\(\{/);
  assert.match(source, /await this\.showSummary\(elapsed, wpm, \{ qualifiesForCalibration \}\);/);
  assert.match(source, /!readingQualification\?\.qualifiesForCalibration/);
  assert.match(source, /正文浏览未达到 70%/);
});

test('skipped-calibration feedback reads and saves the same qualified-reading checkpoint', async () => {
  const source = await readFile(new URL('../src/views/reading.js', import.meta.url), 'utf8');

  assert.match(source, /getQualifiedReadingObservationCheckpoint\(\)/);
  assert.match(source, /saveQualifiedReadingDifficultyFeedback\(choice\)/);
  assert.doesNotMatch(source, /getReadingFeedbackCheckpoint\(readings\)/);
});
