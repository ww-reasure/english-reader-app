import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

async function loadHistory() {
  const source = await readFile(new URL('../src/components/route-history.js', import.meta.url), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

test('tracks internal route visits and returns one app route at a time', async () => {
  const { RouteHistory } = await loadHistory();
  const history = new RouteHistory('#/chat');
  history.record('#/history');
  history.record('#/reading/42');

  assert.equal(history.previous(), '#/history');
  assert.equal(history.previous(), '#/chat');
  assert.equal(history.previous(), null);
});

test('revisiting an earlier route moves the cursor instead of creating a duplicate branch', async () => {
  const { RouteHistory } = await loadHistory();
  const history = new RouteHistory('#/chat');
  history.record('#/history');
  history.record('#/reading/42');
  history.record('#/history');

  assert.equal(history.current(), '#/history');
  assert.equal(history.previous(), '#/chat');
});
