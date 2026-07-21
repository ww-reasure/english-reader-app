import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('enables viewport-fit cover for the fixed mobile chat composer', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<meta\s+name=["']viewport["']\s+content=["'][^"']*viewport-fit=cover/);
});
