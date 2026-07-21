import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadChatShell() {
  const sourceUrl = new URL('../src/components/chat-shell.js', import.meta.url);
  const source = await readFile(sourceUrl, 'utf8');
  const dataUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(dataUrl);
}

function createDocument() {
  const classes = new Set();
  return {
    body: {
      classList: {
        add: value => classes.add(value),
        remove: value => classes.delete(value),
        contains: value => classes.has(value)
      }
    }
  };
}

test('activates and clears the chat-only immersive shell class', async () => {
  const { ChatShell } = await loadChatShell();
  const documentRef = createDocument();

  ChatShell.activate(documentRef);
  assert.equal(documentRef.body.classList.contains('chat-shell-active'), true);

  ChatShell.deactivate(documentRef);
  assert.equal(documentRef.body.classList.contains('chat-shell-active'), false);
});
