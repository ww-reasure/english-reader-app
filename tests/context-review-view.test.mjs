import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function read(relativePath) {
  return (await readFile(new URL(relativePath, import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
}

test('flashcard routes expose a mode chooser plus recall and context modes', async () => {
  const [router, shell, chooser] = await Promise.all([
    read('../src/router.js'),
    read('../src/components/app-shell.js'),
    read('../src/views/review-mode.js')
  ]);

  assert.match(router, /#\/flashcard\/recall/);
  assert.match(router, /#\/flashcard\/context/);
  assert.match(shell, /hash\.startsWith\('#\/flashcard'\)/);
  assert.match(chooser, /单词回忆/);
  assert.match(chooser, /语境识词/);
  assert.match(chooser, /共用同一复习队列/);
});

test('context review protects the target but allows other word lookups before scoring', async () => {
  const source = await read('../src/views/context-review.js');

  assert.match(source, /认识/);
  assert.match(source, /模糊/);
  assert.match(source, /不认识/);
  assert.match(source, /跳过/);
  assert.match(source, /这是本句复习词，请先作答/);
  assert.match(source, /Tooltip\.beginLookup/);
  assert.match(source, /Dictionary\.lookup/);
  assert.match(source, /assistedLookupCount/);
  assert.match(source, /完整学习详情/);
  assert.match(source, /记错了/);
  assert.match(source, /data-context-translation-retry/);
  assert.match(source, /pendingEvidence/);
  assert.match(source, /expectedRevision/);
  assert.match(source, /exam-passage/);
  assert.match(source, /真题正文/);
  assert.match(source, /exam-question/);
  assert.match(source, /真题题干/);
});

test('context review unlocks target-word lookup after the answer and translation are shown', async () => {
  const source = await read('../src/views/context-review.js');

  assert.doesNotMatch(source, /if \(!word \|\| this\.answered\) return;/);
  assert.match(source, /answered[\s\S]{0,220}data-context-word/);
  assert.match(source, /if \(!this\.answered\) this\.assistedLookupCount/);
});

test('context review discloses source difficulty only after an answer', async () => {
  const source = await read('../src/views/context-review.js');

  assert.match(source, /difficultyStatus/);
  assert.match(source, /offline-fallback/);
  assert.match(source, /AI 定制例句/);
  assert.match(source, /原设定/);
  assert.match(source, /answered \? `<div class="context-review-answer/);
  assert.match(source, /item\.examTrack \|\| item\.sourceTrack/);
});

test('context review requires an explicit target exam before starting a new session', async () => {
  const source = await read('../src/views/context-review.js');

  assert.match(source, /requiresTargetTrackSelection/);
  assert.match(source, /#\/settings/);
  assert.match(source, /请先选择目标考试导向/);
});

test('traditional recall also consumes the shared revision-aware queue', async () => {
  const flashcard = await read('../src/views/flashcard.js');

  assert.match(flashcard, /ReviewQueue\.getDueWords/);
  assert.match(flashcard, /ReviewQueue\.revalidate/);
  assert.match(flashcard, /expectedRevision/);
});
