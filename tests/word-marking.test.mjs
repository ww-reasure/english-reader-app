import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExactWordFormIndex, renderExactWordMarking } from '../src/components/word-marking.mjs';

test('exact marking accepts declared dictionary forms but rejects similar prefixes', async () => {
  const index = await buildExactWordFormIndex([
    { word: 'care', stem: 'care' }
  ], {
    loadCore: async () => ({ entries: [
      { lemma: 'care', forms: ['care', 'cares'] }
    ] })
  });

  const html = renderExactWordMarking('care career careful cares', index, 'learning-word');
  assert.equal((html.match(/class="learning-word"/g) || []).length, 2);
  assert.match(html, /<mark class="learning-word"[^>]*>care<\/mark>/);
  assert.match(html, /<mark class="learning-word"[^>]*>cares<\/mark>/);
  assert.doesNotMatch(html, /<mark[^>]*>career<\/mark>/);
  assert.doesNotMatch(html, /<mark[^>]*>careful<\/mark>/);
});

test('ambiguous surface forms from different lemmas are not marked', async () => {
  const index = await buildExactWordFormIndex([
    { word: 'find', stem: 'find' },
    { word: 'found', stem: 'found' }
  ], {
    loadCore: async () => ({ entries: [
      { lemma: 'find', forms: ['found'] },
      { lemma: 'found', forms: ['found'] }
    ] })
  });
  assert.doesNotMatch(renderExactWordMarking('found', index), /<mark/);
});
