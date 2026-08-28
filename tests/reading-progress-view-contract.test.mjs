import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readReadingView() {
  return (await readFile(new URL('../src/views/reading.js', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
}

test('reading view owns resumable progress without changing the existing completion evaluator', async () => {
  const source = await readReadingView();
  assert.match(source, /createReadingProgressSession/);
  assert.match(source, /DB\.getReadingProgress\(/);
  assert.match(source, /DB\.saveReadingProgress\(/);
  assert.match(source, /DB\.deleteReadingProgress\(/);
  assert.match(source, /继续上次阅读/);
  assert.match(source, /继续逐句导读/);
  assert.match(source, /从头查看/);
  assert.match(source, /保存进度并退出/);
  assert.match(source, /sessionBaseActiveSeconds|activeSeconds/);
  assert.match(source, /evaluateReadingSession\(/);
  assert.doesNotMatch(source, /READING_ACTIVE_SLICE/);
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
  assert.match(finish, /deleteReadingProgress|readingProgressSession.*complete/s);
  assert.match(finish, /activeSeconds/);
  assert.match(finish, /wordCount\s*\/\s*\(.*activeSeconds/);
});
