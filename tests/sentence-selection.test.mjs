import assert from 'node:assert/strict';
import test from 'node:test';

import { createSentenceRangeForTextNodes, splitSentences } from '../src/components/sentence-selection.mjs';

function textNode(text) {
  return { nodeType: 3, textContent: text };
}

function createRangeRecorder() {
  return {
    setStart(node, offset) { this.start = { node, offset }; },
    setEnd(node, offset) { this.end = { node, offset }; }
  };
}

test('long press selects one complete sentence across review-highlight text nodes', () => {
  const beforeHighlight = textNode('Many college graduates now ');
  const highlightedWord = textNode('find');
  const afterHighlight = textNode(' temp work during their first job. This second sentence stays out.');
  const nodes = [beforeHighlight, highlightedWord, afterHighlight];

  const result = createSentenceRangeForTextNodes({
    textNodes: nodes,
    pointNode: highlightedWord,
    pointOffset: 2,
    createRange: createRangeRecorder
  });

  assert.ok(result);
  assert.equal(result.text, 'Many college graduates now find temp work during their first job.');
  assert.equal(result.range.start.node, beforeHighlight);
  assert.equal(result.range.start.offset, 0);
  assert.equal(result.range.end.node, afterHighlight);
  assert.equal(result.range.end.offset, ' temp work during their first job.'.length);
});

test('long press starts after the preceding sentence even when a highlight begins at the node boundary', () => {
  const first = textNode('The first sentence ends. ');
  const highlightedWord = textNode('Review');
  const tail = textNode(' words may sit in the next sentence.');
  const nodes = [first, highlightedWord, tail];

  const result = createSentenceRangeForTextNodes({
    textNodes: nodes,
    pointNode: highlightedWord,
    pointOffset: 3,
    createRange: createRangeRecorder
  });

  assert.ok(result);
  assert.equal(result.text, 'Review words may sit in the next sentence.');
  assert.equal(result.range.start.node, highlightedWord);
  assert.equal(result.range.start.offset, 0);
  assert.equal(result.range.end.node, tail);
});

test('shared sentence segmentation keeps abbreviations, closing quotes, and source ranges', () => {
  const source = 'Dr. Lee said "Wait here." Then we left.';
  const segments = splitSentences(source);

  assert.deepEqual(segments.map(item => item.text), [
    'Dr. Lee said "Wait here."',
    'Then we left.'
  ]);
  assert.equal(source.slice(segments[0].start, segments[0].end), segments[0].text);
  assert.equal(source.slice(segments[1].start, segments[1].end), segments[1].text);
});

test('shared sentence segmentation recognizes typographic closing quotes', () => {
  assert.deepEqual(splitSentences('She said “Go now.” Then she left.').map(item => item.text), [
    'She said “Go now.”',
    'Then she left.'
  ]);
});

test('shared sentence segmentation returns an unpunctuated tail and handles multiple paragraphs', () => {
  const source = 'First paragraph ends. A final clause\n\nSecond paragraph has no mark';
  const segments = splitSentences(source);

  assert.deepEqual(segments.map(item => item.text), [
    'First paragraph ends.',
    'A final clause',
    'Second paragraph has no mark'
  ]);
  assert.ok(segments.every(item => item.end > item.start));
});
