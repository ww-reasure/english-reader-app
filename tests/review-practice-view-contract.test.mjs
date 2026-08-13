import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('vocabulary page exposes the three practice entries and manual word selection', async () => {
  const source = await read('../src/views/vocabulary.js');

  assert.match(source, /renderPracticeEntry\(\{ scope: 'today_added'/);
  assert.match(source, /renderPracticeEntry\(\{ scope: 'recent_added'/);
  assert.match(source, /toggleSelection\(\)/);
  assert.match(source, /data-practice-word/);
  assert.match(source, /startManualPractice\(\)/);
  assert.match(source, /resolvePracticeScope/);
  assert.match(source, /createPracticeSession/);
});

test('vocabulary toggles re-render into the routed outlet and refresh counts from the database', async () => {
  const source = await read('../src/views/vocabulary.js');

  assert.doesNotMatch(source, /render\(document\.getElementById\('app'\)\)/);
  assert.match(source, /this\.container = container/);
  assert.match(source, /await this\.render\(this\.container\)/);
  assert.match(source, /const words = await DB\.getAllWords\(\)/);
  assert.match(source, /const todayStatus = getPracticeScopeStatus\(\{/);
  assert.match(source, /const recentStatus = getPracticeScopeStatus\(\{/);
  assert.match(source, /idsFor\(practiceable\.filter\(word => Number\(word\.createdAt\) >= todayBoundary\.getTime\(\)\)\)/);
  assert.match(source, /idsFor\(practiceable\.filter\(word => Number\(word\.createdAt\) >= Date\.now\(\) - 7 \* dayMs\)\)/);
});

test('router maps the practice route with its scope into the flashcard view', async () => {
  const source = await read('../src/router.js');
  assert.match(source, /#\\\/flashcard\\\/practice\\\/\[a-z_\]+/);
  assert.match(source, /hash\.split\('\/'\)\.pop\(\)/);
});

test('flashcard practice mode records practice events and keeps scheduled review intact', async () => {
  const source = await read('../src/views/flashcard.js');

  assert.match(source, /readPracticeSession/);
  assert.match(source, /DB\.recordLearnWordPractice\(word\.id/);
  assert.match(source, /DB\.settleSessionReview\(word\.id/);
  assert.match(source, /if \(!this\.practiceScope\)/);
  assert.match(source, /专项练习完成/);
  assert.match(source, /返回生词本/);
});

test('practice completion clears the scoped session so re-entering cannot repeat the same words', async () => {
  const source = await read('../src/views/flashcard.js');

  assert.match(source, /clearPracticeSession\(\)/);
  assert.match(source, /const isPractice = Boolean\(this\.practiceScope\);/);
  assert.match(source, /this\.practiceScope = ''/);
  assert.match(source, /isPractice \? '' : '<button class="btn btn-outline" onclick="FlashcardView\.restart\(\)">再来一轮<\/button>'/);
  assert.match(source, /专项练习完成/);
});

test('completed time-scoped practice locks the vocabulary entries until an explicit new round', async () => {
  const vocabSource = await read('../src/views/vocabulary.js');

  assert.match(vocabSource, /getPracticeScopeStatus\(\{/);
  assert.match(vocabSource, /scope: 'today_added'/);
  assert.match(vocabSource, /scope: 'recent_added'/);
  assert.match(vocabSource, /renderPracticeEntry\(\{ scope: 'today_added'/);
  assert.match(vocabSource, /renderPracticeEntry\(\{ scope: 'recent_added'/);
  assert.match(vocabSource, /vocab-practice-entry--done/);
  assert.match(vocabSource, /今日已复习/);
  assert.match(vocabSource, /再来一轮/);
  assert.match(vocabSource, /onclick="VocabularyView\.startPractice\('\$\{scope\}', \{ reviewAll: true \}\)"/);
});

test('incremental state only exposes the newly added words and keeps reviewed ones out', async () => {
  const vocabSource = await read('../src/views/vocabulary.js');

  assert.match(vocabSource, /已复习 \$\{reviewedCount\} 词 · 新增 \$\{newCount\} 词/);
  assert.match(vocabSource, /status\.reviewedIds\.length > 0/);
  assert.match(vocabSource, /wordIds = status\.newIds/);
  assert.match(vocabSource, /getPracticeScopeStatus\(\{ scope, currentWordIds: currentIds \}\)/);
});

test('flashcard completion writes the daily done marker for the finished practice scope', async () => {
  const source = await read('../src/views/flashcard.js');

  assert.match(source, /markPracticeScopeDone\(this\.practiceScope, \{\s*wordIds: this\.words\.map\(word => word\.id\)\s*\}\)/);
  assert.match(source, /import \{ readPracticeSession, clearPracticeSession, markPracticeScopeDone \} from '\.\.\/review-practice\.mjs';/);
});
