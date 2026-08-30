import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('vocabulary page exposes the three practice entries and manual word selection', async () => {
  const source = await read('../src/views/vocabulary.js');

  assert.match(source, /scope: 'today_added'/);
  assert.match(source, /scope: 'recent_added'/);
  assert.match(source, /toggleSelection\(\)/);
  assert.match(source, /data-practice-word/);
  assert.match(source, /startManualPractice\(\)/);
  assert.match(source, /resolvePracticeScope/);
  assert.match(source, /createPracticeSession/);
  assert.match(source, /getPracticeScopeStatus/);
  assert.match(source, /getPracticeProgress/);
  assert.match(source, /completedCount/);
  assert.match(source, /this\.renderTodayPractice\(todayStatus, todayScope\.skipped, todayProgress\)/);
  assert.match(source, /this\.renderRecentPractice\(recentStatus, recentScope\.skipped, recentProgress\)/);
  assert.match(source, /renderPracticeEntry/);
  assert.match(source, /新增 \$\{newCount\} 词/);
  assert.match(source, /已完成/);
  assert.match(source, /再练一轮/);
  assert.match(source, /clearPracticeScopeDone/);
});

test('vocabulary loads one snapshot and keeps filter/search redraws in memory', async () => {
  const source = await read('../src/views/vocabulary.js');

  assert.doesNotMatch(source, /render\(document\.getElementById\('app'\)\)/);
  assert.match(source, /this\.container = container/);
  assert.match(source, /this\.renderPage\(\)/);
  assert.match(source, /DB\.getUnifiedVocabularySnapshot\(\)/);
  assert.match(source, /this\.rows = snapshot\.data/);
  assert.doesNotMatch(source, /DB\.getAllWords\(\)/);
  assert.match(source, /const \[todayScope, recentScope\] = await Promise\.all/);
  assert.match(source, /const todayStatus = getPracticeScopeStatus/);
  assert.match(source, /const recentStatus = getPracticeScopeStatus/);
  assert.match(source, /getPracticeProgressBatch/);
});

test('router maps the practice route with its scope into the flashcard view', async () => {
  const source = await read('../src/router-routes.mjs');
  assert.match(source, /#\\\/flashcard\\\/practice\\\/\[a-z_\]+/);
  assert.match(source, /hash\.split\('\/'\)\.pop\(\)/);
});

test('flashcard practice mode records practice events and keeps scheduled review intact', async () => {
  const source = await read('../src/views/flashcard.js');

  assert.match(source, /readPracticeSession/);
  assert.match(source, /finalizePracticeSession/);
  assert.match(source, /DB\.recordLearnWordPractice\(word\.id/);
  assert.match(source, /DB\.settleSessionReview\(word\.id/);
  assert.match(source, /if \(!this\.practiceScope\)/);
  assert.match(source, /专项练习完成/);
  assert.match(source, /返回我的词汇/);
  assert.doesNotMatch(source, /isPractice \? '[^']*再来一轮/);
  assert.match(source, /DB\.getLearnWordsByIds\(expectedWordIds\)/);
  assert.doesNotMatch(source, /for \(const wordId of expectedWordIds\)[\s\S]{0,180}findLearnWordById/);
});

test('vocabulary filtering is memory-only and renders a bounded word window', async () => {
  const source = await read('../src/views/vocabulary.js');

  assert.match(source, /getUnifiedVocabularySnapshot/);
  assert.match(source, /getPracticeProgressBatch/);
  assert.match(source, /renderWordWindow/);
  assert.doesNotMatch(source, /async setSearchQuery/);
  assert.doesNotMatch(source, /async renderPage/);
});
