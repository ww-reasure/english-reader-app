import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readReadingView() {
  return (await readFile(new URL('../src/views/reading.js', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
}

test('the reading page delegates its only completion rule to the shared reading-session evaluator', async () => {
  const source = await readReadingView();

  assert.match(source, /import\s+\{[^}]*\bevaluateReadingSession\b[^}]*\}\s+from '\.\.\/calibration-engine\.mjs';/s);
  assert.match(source, /const readingQualification = evaluateReadingSession\(\{[\s\S]*?contentProgress:\s*contentProgressAtFinish[\s\S]*?activeSeconds[\s\S]*?wordCount[\s\S]*?\}\);/);
  assert.match(source, /if \(!readingQualification\.qualified\) \{[\s\S]*?this\.showIncompleteReadingPrompt\(readingQualification\);[\s\S]*?return;/);
  assert.doesNotMatch(source, /MIN_READ_TIME:\s*15/);
});

test('an incomplete reading uses the shared qualification gate and offers continue or progress-save exit', async () => {
  const source = await readReadingView();
  const finishStart = source.indexOf('async finishReading()');
  const finishEnd = source.indexOf('async showSummary(', finishStart);
  const finishReading = source.slice(finishStart, finishEnd);

  assert.match(finishReading, /if \(!readingQualification\.qualified\) \{[\s\S]*?return;/);
  assert.match(source, /showIncompleteReadingPrompt\(qualification\)/);
  assert.match(source, /继续阅读/);
  assert.match(source, /保存进度并退出/);
  assert.match(finishReading, /qualificationVersion:\s*2/);
  assert.match(finishReading, /contentProgress:\s*scrollDepth/);
  assert.match(finishReading, /readingMode:/);
  assert.match(finishReading, /articleSnapshot:/);
  assert.match(finishReading, /checkpointResult = await this\._checkpointReadingProgress\(\{ force: true \}\)[\s\S]*showIncompleteReadingPrompt/);
  assert.match(finishReading, /readingProgressSaveStatus = checkpointResult\.ok \? 'saved' : 'failed'/);
});

test('only a qualified finished reading is recorded as article-level calibration evidence without asserting word mastery', async () => {
  const source = await readReadingView();
  const finishStart = source.indexOf('async finishReading()');
  const finishEnd = source.indexOf('async showSummary(', finishStart);
  const finishReading = source.slice(finishStart, finishEnd);

  const observationCall = finishReading.match(/knowledgeEvidenceBridge\.recordQualifiedReadingObservation\(\{([\s\S]*?)\}\);/);
  assert.ok(observationCall, 'qualified reading should record an article-level observation');
  assert.match(observationCall[1], /articleId:\s*this\.articleData\?\.id/);
  assert.match(observationCall[1], /completed:\s*true/);
  assert.match(observationCall[1], /scrollDepth/);
  assert.match(observationCall[1], /activeSeconds:\s*(?:elapsed|activeSeconds|cumulativeActiveSeconds)/);
  assert.doesNotMatch(observationCall[1], /\bword:\s*/);
});

test('skipped-calibration feedback reads and saves the same qualified-reading checkpoint', async () => {
  const source = await readReadingView();

  assert.match(source, /getQualifiedReadingObservationCheckpoint\(\)/);
  assert.match(source, /saveQualifiedReadingDifficultyFeedback\(choice\)/);
  assert.doesNotMatch(source, /getReadingFeedbackCheckpoint\(readings\)/);
});
