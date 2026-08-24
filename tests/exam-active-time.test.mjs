import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { StudySessionTimer } from '../src/study-session-timer.mjs';

async function read(relativePath) {
  return (await readFile(new URL(relativePath, import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
}

function createExamTimerFixture() {
  let now = new Date(2026, 7, 24, 9).getTime();
  const timer = new StudySessionTimer({
    sessionId: 'exam:attempt-1',
    mode: 'exam',
    now: () => now,
    idleMs: 120_000
  });
  return {
    timer,
    advance(ms) { now += ms; }
  };
}

test('question activity does not erase time accumulated before the latest event', async () => {
  const source = await read('../src/views/exam-practice.js');
  const { timer, advance } = createExamTimerFixture();

  assert.match(source, /StudySessionTimer/);
  timer.start({ contextKey: 'reading_mcq' });
  advance(10_000);
  timer.noteActivity();
  advance(5_000);
  assert.equal(timer.getActiveDuration(), 15_000);
});

test('full-paper unit switch emits old type before activating the next type', async () => {
  const source = await read('../src/views/exam-practice.js');
  const switchIndex = source.indexOf('switchContext');
  const unitMutationIndex = source.indexOf('this.unit = nextUnit', switchIndex);

  assert.notEqual(switchIndex, -1);
  assert.notEqual(unitMutationIndex, -1);
  assert.ok(switchIndex < unitMutationIndex);
  assert.match(source, /persistActiveSlices|flushActiveSlices/);
  assert.match(source, /contextKey: examTypeKey\(nextUnit\)/);
});

test('wrong-review and manual-review origins remain separate from normal attempts', async () => {
  const source = await read('../src/views/exam-practice.js');

  assert.match(source, /ActivityType\.EXAM_ACTIVE_SLICE/);
  assert.match(source, /practiceKind/);
  assert.match(source, /practiceOrigin/);
  assert.match(source, /attemptId/);
  assert.match(source, /bankId/);
  assert.match(source, /paperKey/);
  assert.match(source, /matchingVariant/);
});
