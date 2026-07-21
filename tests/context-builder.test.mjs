import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

async function loadBuilder() {
  const source = await readFile(new URL('../src/components/context-builder.js', import.meta.url), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

test('reading context includes selected text but never full article content', async () => {
  const { ContextBuilder } = await loadBuilder();
  const messages = new ContextBuilder().build({
    kind: 'reading',
    summary: '',
    messages: [],
    userMessage: '继续解释',
    pageContext: {
      article: { title: 'Test', content: 'x'.repeat(5000) },
      sentence: 'Selected sentence.',
      paragraph: 'Current paragraph.'
    }
  });
  const joined = messages.map(message => message.content).join('\n');
  assert.match(joined, /Selected sentence/);
  assert.equal(joined.includes('x'.repeat(300)), false);
});
