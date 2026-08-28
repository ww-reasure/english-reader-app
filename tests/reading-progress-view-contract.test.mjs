import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readReadingView() {
  return (await readFile(new URL('../src/views/reading.js', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
}

test('reading view owns resumable progress without changing the existing completion evaluator', async () => {
  const source = await readReadingView();
  const activity = await readFile(new URL('../src/reading-activity.mjs', import.meta.url), 'utf8');
  assert.match(source, /createReadingProgressSession/);
  assert.match(source, /DB\.getReadingProgress\(/);
  assert.match(source, /DB\.saveReadingProgress\(/);
  assert.match(source, /DB\.deleteReadingProgress\(/);
  assert.match(source, /继续上次阅读/);
  assert.match(source, /继续逐句导读/);
  assert.match(source, /从头查看/);
  assert.match(source, /累计有效阅读/);
  assert.match(source, /formatReadingDuration/);
  assert.match(source, /保存进度并退出/);
  assert.match(source, /重试保存/);
  assert.match(source, /阅读进度.*暂未保存成功/);
  assert.match(source, /readingProgressSaveStatus/);
  assert.match(source, /retryReadingProgressSave/);
  assert.match(source, /retryReadingProgressCleanup/);
  assert.match(source, /factsRecorded/);
  assert.match(source, /completed_pending_cleanup/);
  assert.match(source, /reading\.progress_completion_cleanup_retry_failed/);
  assert.match(source, /sessionBaseActiveSeconds|activeSeconds/);
  assert.match(source, /evaluateReadingSession\(/);
  assert.match(activity, /READING_ACTIVE_SLICE/);
});

test('reading activation separates actual user scroll from initial viewport measurement', async () => {
  const source = await readReadingView();
  assert.match(source, /didUserScroll/);
  assert.match(source, /scrollTop\s*\/\s*Math\.max\(1,\s*scrollHeight\s*-\s*clientHeight\)/);
  assert.match(source, /_updateReadingScrollDepth\(\{\s*didUserScroll:\s*true\s*\}/);
  assert.match(source, /this\._updateReadingScrollDepth\(\);/);
});

test('reading guide keeps persisted and current-session visited sets separate', async () => {
  const source = await readReadingView();
  assert.match(source, /persistedGuideVisited/);
  assert.match(source, /sessionGuideVisited/);
  assert.match(source, /sessionGuideVisited\.size/);
  assert.match(source, /guideVisited\.add/);
  assert.match(source, /closeSentenceGuide[\s\S]*checkpoint/);
});

test('reading completion flushes and deletes progress only after the existing qualification path', async () => {
  const source = await readReadingView();
  const start = source.indexOf('async finishReading()');
  const end = source.indexOf('async showSummary(', start);
  const finish = source.slice(start, end);
  assert.match(finish, /evaluateReadingSession\(/);
  assert.match(finish, /readingProgressSession.*flush|readingProgressSession.*complete/s);
  assert.match(finish, /DB\.saveReadingStat\(/);
  assert.match(finish, /completionId/);
  assert.match(finish, /_updateReviewSRS\(completionId\)/);
  assert.match(finish, /deleteReadingProgress|readingProgressSession.*complete/s);
  assert.match(finish, /activeSeconds/);
  assert.match(finish, /wordCount\s*\/\s*\(.*activeSeconds/);
  assert.match(finish, /factsRecorded/);
  assert.match(finish, /retryReadingProgressCleanup/);
});

test('cleanup retry is progress-only and cannot repeat completion facts', async () => {
  const source = await readReadingView();
  const retryStart = source.indexOf('async _retryReadingProgressCleanup');
  const retryEnd = source.indexOf('async retryReadingProgressCleanup', retryStart);
  const retry = source.slice(retryStart, retryEnd);
  const finishStart = source.indexOf('async finishReading()');
  const finishEnd = source.indexOf('async showSummary(', finishStart);
  const finish = source.slice(finishStart, finishEnd);

  assert.match(retry, /session\.complete/);
  assert.doesNotMatch(retry, /saveReadingStat|recordQualifiedReadingObservation|_updateReviewSRS/);
  assert.match(finish, /readingProgressCompletion\s*=\s*\{\s*factsRecorded:\s*true/);
  assert.match(finish, /if \(!cleanupSucceeded\) \{[\s\S]*?return;/);
});

test('explicit progress exit confirms a final checkpoint before navigating away', async () => {
  const source = await readReadingView();
  const start = source.indexOf('async exitWithoutCounting()');
  const end = source.indexOf('// Finish reading', start);
  const exit = source.slice(start, end);

  assert.match(exit, /checkpointResult = await this\._checkpointReadingProgress\(\{ force: true \}\)/);
  assert.match(exit, /if \(!checkpointResult\.ok\) \{[\s\S]*?showIncompleteReadingPrompt/);
  assert.match(exit, /cleanup\(\{ skipProgressCheckpoint: true \}\)/);
  assert.match(exit, /if \(cleanupResult\?\.progressSaved === false\)/);
});

test('a failed completion cleanup blocks a new resumable session until cleanup succeeds', async () => {
  const source = await readReadingView();
  const loadStart = source.indexOf('async _loadReadingProgress');
  const loadEnd = source.indexOf('_renderResumeCard', loadStart);
  const load = source.slice(loadStart, loadEnd);
  const retryStart = source.indexOf('async _retryReadingProgressCleanup');
  const retryEnd = source.indexOf('async retryReadingProgressCleanup', retryStart);
  const retry = source.slice(retryStart, retryEnd);

  assert.match(load, /completionCleanupError/);
  assert.match(load, /readingProgressSession = null;[\s\S]*return;/);
  assert.match(retry, /if \(!session\)[\s\S]*DB\.deleteReadingProgress\(this\.articleData\.id\)/);
  assert.match(retry, /factsRecorded:\s*true[\s\S]*cleanupPending:\s*true/);
});

test('incomplete reading only describes progress as saved after a successful checkpoint', async () => {
  const source = await readReadingView();
  const promptStart = source.indexOf('showIncompleteReadingPrompt');
  const promptEnd = source.indexOf('dismissIncompleteReadingPrompt', promptStart);
  const prompt = source.slice(promptStart, promptEnd);

  assert.match(prompt, /readingProgressSaveStatus/);
  assert.match(prompt, /saved/);
  assert.match(prompt, /failed/);
  assert.match(prompt, /重试保存/);
  assert.match(prompt, /继续阅读/);
  assert.match(prompt, /checkpointFailed\s*\?/);
});
