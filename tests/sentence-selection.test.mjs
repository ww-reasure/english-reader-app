import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSentenceRangeForTextNodes,
  findSentenceOffsets,
  splitSentences
} from '../src/components/sentence-selection.mjs';

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

test('shared sentence segmentation preserves abbreviations, decimals and initials', () => {
  const source = 'Dr. A. Smith used e.g. 3.14 units in the U.S. market. It worked.';
  const segments = splitSentences(source);
  assert.deepEqual(segments.map(item => item.text), [
    'Dr. A. Smith used e.g. 3.14 units in the U.S. market.',
    'It worked.'
  ]);
  assert.ok(segments.every(item => source.slice(item.start, item.end) === item.text));
});

test('shared boundaries include closing quotes and parentheses and retain an unpunctuated tail', () => {
  const source = 'She asked, “Really?” (He nodded.) A final clause';
  assert.deepEqual(splitSentences(source).map(item => item.text), [
    'She asked, “Really?”',
    '(He nodded.)',
    'A final clause'
  ]);
});

test('point lookup uses the same sentence ranges as segmentation', () => {
  const source = 'Mr. Lee said "Wait here." Then we left.';
  const segments = splitSentences(source);
  const point = source.indexOf('Wait') + 2;
  assert.deepEqual(findSentenceOffsets(source, point), {
    start: segments[0].start,
    end: segments[0].end
  });
  assert.equal(source.slice(segments[0].start, segments[0].end), 'Mr. Lee said "Wait here."');
});
