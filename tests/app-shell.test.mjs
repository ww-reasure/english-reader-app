import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

async function loadShell() {
  const source = await readFile(new URL('../src/components/app-shell.js', import.meta.url), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

test('maps article routes to the bookshelf drawer item', async () => {
  const { AppShell } = await loadShell();
  assert.equal(AppShell.getRouteMeta('#/reading/42').navKey, 'reading-list');
  assert.equal(AppShell.getRouteMeta('#/history').title, '阅读记录');
});
