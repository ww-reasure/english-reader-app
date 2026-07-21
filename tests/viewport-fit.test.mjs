import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('locks mobile zoom and removes the legacy bottom navigation', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<meta\s+name=["']viewport["']\s+content=["'][^"']*viewport-fit=cover/);
  assert.match(html, /maximum-scale=1\.0/);
  assert.match(html, /user-scalable=no/);
  assert.doesNotMatch(html, /class="tab-bar"/);
});
