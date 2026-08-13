import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { copyPlainText, normalizeCopyText } from '../src/components/message-actions.mjs';
import { normalizeSelectedExcerpt } from '../src/components/chat-selection-actions.mjs';

async function read(relativePath) {
  return (await readFile(new URL(relativePath, import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
}

test('copyPlainText prefers the clipboard and copies visible plain text', async () => {
  const calls = [];
  await copyPlainText('  解释\n\n原文  ', {
    navigatorObject: { clipboard: { writeText: async value => calls.push(value) } }
  });
  assert.deepEqual(calls, ['解释\n\n原文']);
  assert.equal(normalizeCopyText('  hello  '), 'hello');
});

test('copyPlainText falls back to a temporary textarea when clipboard is unavailable', async () => {
  const appended = [];
  const removed = [];
  const area = {
    value: '',
    style: {},
    select() { this.selected = true; },
    remove() { removed.push(this); }
  };
  const documentObject = {
    createElement: tag => tag === 'textarea' ? area : null,
    body: { appendChild: node => appended.push(node) },
    execCommand: command => command === 'copy'
  };
  await copyPlainText('fallback text', { navigatorObject: {}, documentObject });
  assert.equal(appended[0], area);
  assert.equal(area.value, 'fallback text');
  assert.equal(area.selected, true);
  assert.deepEqual(removed, [area]);
});

test('copyPlainText cleans up the fallback textarea when the WebView copy command throws', async () => {
  const area = {
    value: '',
    style: {},
    select() {},
    remove() { this.removed = true; }
  };
  const documentObject = {
    createElement: () => area,
    body: { appendChild() {} },
    execCommand() { throw new Error('unsupported'); }
  };
  assert.equal(await copyPlainText('fallback text', { navigatorObject: {}, documentObject }), false);
  assert.equal(area.removed, true);
});

test('chat wiring adds copy actions only to assistant content and cleans selection bindings', async () => {
  const [chat, analysis, selection, css] = await Promise.all([
    read('../src/views/chat.js'),
    read('../src/components/ai-analysis.js'),
    read('../src/components/chat-selection-actions.mjs'),
    read('../css/style.css')
  ]);
  assert.match(chat, /message-actions\.mjs/);
  assert.match(chat, /createCopyButton\(\)/);
  assert.match(chat, /chat-ai-content/);
  assert.match(chat, /ChatSelectionActions/);
  assert.match(chat, /selectedExcerpt/);
  assert.match(chat, /pageContext:\s*\{[^}]*selectedExcerpt[^}]*source:\s*['"]chat_reply['"]/s);
  assert.match(chat, /content\.appendChild\(createCopyButton\(\)\)/);
  assert.match(chat, /_chatSelectionActions/);
  assert.match(chat, /_chatSelectionActions\?\.destroy\?\.\(\)/);
  assert.match(analysis, /message-actions\.mjs/);
  assert.match(analysis, /createCopyButton\(\)/);
  assert.match(analysis, /closest\?\.\('\[data-message-copy\]'\)/);
  assert.match(selection, /normalizeSelectedExcerpt/);
  assert.match(selection, /chatSelectionAction/);
  assert.match(selection, /removeAllRanges/);
  assert.match(css, /\.message-copy-action/);
  assert.match(css, /\.chat-follow-up-panel/);
});

test('selected text is normalized and capped before it becomes a follow-up quote', () => {
  assert.equal(normalizeSelectedExcerpt('  one\n two\tthree  '), 'one two three');
  assert.equal(normalizeSelectedExcerpt('x'.repeat(700)).length, 600);
  assert.equal(normalizeSelectedExcerpt('   '), '');
});

test('home context includes a selected chat excerpt without treating it as a reading article', async () => {
  const source = await read('../src/components/context-builder.js');
  assert.match(source, /pageContext\?\.selectedExcerpt/);
  assert.match(source, /chat_reply|selected_quote/);
});
