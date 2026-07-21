import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('chat view has separate chat and generation modes', async () => {
  const source = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');
  assert.match(source, /mode === 'chat'/);
  assert.match(source, /mode === 'generate'/);
  assert.match(source, /ChatService/);
});
