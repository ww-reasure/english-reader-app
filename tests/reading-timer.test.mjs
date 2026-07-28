import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadTimer() {
  const source = await readFile(new URL('../src/helpers.js', import.meta.url), 'utf8');
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  return module.ReadingTimer;
}

test('reading timer does not resume active time while the document remains hidden', async () => {
  const ReadingTimer = await loadTimer();
  const originalDocument = globalThis.document;
  globalThis.document = { hidden: true };
  const timer = new ReadingTimer(400);

  timer.pauseForVisibility();
  timer.resume();
  assert.equal(timer.isPaused, true);

  globalThis.document.hidden = false;
  timer.resume();
  assert.equal(timer.isPaused, false);
  globalThis.document = originalDocument;
});
