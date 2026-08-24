import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { getContextSentenceAtPoint } from '../src/components/reading-word-context.mjs';

test('shared word context resolves an abbreviation-aware sentence in exam passage markup', () => {
  const originalDocument = globalThis.document;
  const originalNode = globalThis.Node;
  const originalNodeFilter = globalThis.NodeFilter;
  const textNode = { nodeType: 3, textContent: 'Dr. Lee stayed. Target word appears here.', parentElement: null };
  const block = {
    classList: { contains: name => name === 'exam-practice-paragraph' },
    textContent: textNode.textContent,
    closest: selector => selector.includes('.exam-practice-paragraph') ? block : null
  };
  textNode.parentElement = { closest: block.closest };
  let walked = false;
  globalThis.Node = { TEXT_NODE: 3 };
  globalThis.NodeFilter = { SHOW_TEXT: 4 };
  globalThis.document = {
    caretRangeFromPoint: () => ({ startContainer: textNode, startOffset: 22 }),
    createTreeWalker: () => ({ nextNode: () => walked ? null : (walked = true, textNode) })
  };
  try {
    assert.equal(
      getContextSentenceAtPoint({ clientX: 12, clientY: 18 }, { contains: value => value === block }),
      'Target word appears here.'
    );
  } finally {
    globalThis.document = originalDocument;
    globalThis.Node = originalNode;
    globalThis.NodeFilter = originalNodeFilter;
  }
});

test('wrapped reading sentences return their exact text without a caret walk', () => {
  const originalDocument = globalThis.document;
  const textNode = { nodeType: 3, textContent: 'One wrapped sentence.', parentElement: null };
  const sentence = { textContent: textNode.textContent, dataset: { sentenceText: textNode.textContent } };
  textNode.parentElement = { closest: selector => selector === '.reading-sentence' ? sentence : null };
  globalThis.document = { caretRangeFromPoint: () => ({ startContainer: textNode, startOffset: 5 }) };
  try {
    assert.equal(getContextSentenceAtPoint({ target: textNode.parentElement }, { contains: value => value === sentence }), 'One wrapped sentence.');
  } finally {
    globalThis.document = originalDocument;
  }
});

test('guide lookup is isolated, keyboard accessible and fully disposed while exam selectors remain supported', async () => {
  const [lookup, context, point] = await Promise.all([
    readFile(new URL('../src/components/reading-word-lookup.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/reading-word-context.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/word-point.mjs', import.meta.url), 'utf8')
  ]);
  assert.match(lookup, /surface\s*=\s*['"]reading['"]/);
  assert.match(lookup, /surface\s*===\s*['"]guide['"]/);
  assert.match(lookup, /data-word-lookup-token/);
  assert.match(lookup, /(?:Enter|Space|\be\.key\s*===\s*['"] ['"])/);
  assert.match(lookup, /root\.removeEventListener\(['"]keydown['"]/);
  assert.match(context, /\.exam-practice-paragraph/);
  assert.match(context, /\.exam-question-stem/);
  assert.match(point, /\.exam-practice-paragraph/);
  assert.match(point, /\.exam-question-stem/);
});

test('reading lookup binding exposes optional success and save telemetry callbacks', async () => {
  const source = await readFile(new URL('../src/components/reading-word-lookup.js', import.meta.url), 'utf8');
  assert.match(source, /onLookupResolved\s*=\s*null/);
  assert.match(source, /onWordSaved\s*=\s*null/);
  assert.match(source, /onLookupResolved/);
  assert.match(source, /onWordSaved/);
  assert.match(source, /lemma/);
});
