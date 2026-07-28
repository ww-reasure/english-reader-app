import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readSource(relativePath) {
  return (await readFile(new URL(relativePath, import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
}

test('reading lookup supplies the full current sentence to a constrained contextual-sense resolver', async () => {
  const reading = await readSource('../src/views/reading.js');

  assert.match(reading, /import\s+\{\s*ContextualSense\s*\}\s+from '\.\.\/components\/contextual-sense\.js';/);
  assert.match(reading, /getLookupSentence\(e\)/);
  assert.match(reading, /ContextualSense\.resolve\(\{/);
  assert.match(reading, /sentence:\s*contextSentence/);
  assert.match(reading, /Tooltip\.show\([^;]*contextSentence/s);
});

test('tooltip and full study detail display a selected in-sentence meaning without replacing full dictionary senses', async () => {
  const [tooltip, detail] = await Promise.all([
    readSource('../src/components/tooltip.js'),
    readSource('../src/components/word-study-detail.js')
  ]);

  assert.match(tooltip, /本句义/);
  assert.match(tooltip, /contextSentence/);
  assert.match(tooltip, /contextualSenseIndex/);
  assert.match(detail, /本句义/);
  assert.match(detail, /contextualSenseIndex/);
  assert.match(detail, /word-study-definition-list/);
});
