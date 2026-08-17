import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { getContextSentenceAtPoint } from '../src/components/reading-word-context.mjs';

test('shared word lookup resolves the sentence under a text point in Android WebView style DOM', () => {
  const originalDocument = globalThis.document;
  const originalNode = globalThis.Node;
  const textNode = { nodeType: 3, textContent: 'First sentence. Target word appears here.', parentElement: null };
  const block = {
    textContent: textNode.textContent,
    closest: () => block
  };
  textNode.parentElement = { closest: () => block };
  let walked = false;

  globalThis.Node = { TEXT_NODE: 3 };
  globalThis.document = {
    caretRangeFromPoint: () => ({ startContainer: textNode, startOffset: 22 }),
    createTreeWalker: () => ({
      nextNode: () => {
        if (walked) return null;
        walked = true;
        return textNode;
      }
    })
  };

  try {
    assert.equal(
      getContextSentenceAtPoint({ clientX: 12, clientY: 18 }, { contains: value => value === block }),
      'Target word appears here.'
    );
  } finally {
    globalThis.document = originalDocument;
    globalThis.Node = originalNode;
  }
});

test('guide lookup exposes an isolated surface and cleans its listener on disposal', async () => {
  const source = await readFile(new URL('../src/components/reading-word-lookup.js', import.meta.url), 'utf8');
  assert.match(source, /surface\s*=\s*['"]reading['"]/);
  assert.match(source, /surface\s*===\s*['"]guide['"]/);
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.match(source, /root\.removeEventListener\('click', lookupWord\)/);
});
