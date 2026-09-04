import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildKeyPhraseMatcherIndex,
  matchKeyPhraseAt,
  renderPhraseAwareMarking
} from '../src/components/word-marking.mjs';

const PHRASES = [
  { id: 'look forward to', phrase: 'look forward to', glossZh: '期待；盼望' },
  { id: 'look', phrase: 'look', glossZh: '看' },
  { id: 'carry out', phrase: 'carry out', glossZh: '执行；落实' },
  { id: 'deal with', phrase: 'deal with', glossZh: '处理' },
  { id: 'world', phrase: 'world', glossZh: '世界' }
];

const tokenize = source => [...String(source).matchAll(/[A-Za-z]+(?:['’–-][A-Za-z]+)*/gu)];

test('builds an index whose first-token buckets are sorted longest first', () => {
  const matcher = buildKeyPhraseMatcherIndex(PHRASES);
  assert.equal(matcher.size, 5);
  const bucket = matcher.byFirst.get('look');
  assert.ok(Array.isArray(bucket));
  assert.equal(bucket[0].tokens.length, 3);
  assert.equal(matcher.byId.get('look forward to').glossZh, '期待；盼望');
});

test('longest phrase wins over its shorter prefix at the same position', () => {
  const matcher = buildKeyPhraseMatcherIndex(PHRASES);
  const html = renderPhraseAwareMarking('Look forward to it.', matcher, {});
  assert.match(html, /<span class="key-phrase" data-key-phrase-id="look forward to"[^>]*>Look forward to<\/span>/);
  assert.doesNotMatch(html, /data-key-phrase-id="look"/);
});

test('regular inflections of phrase tokens still match', () => {
  const matcher = buildKeyPhraseMatcherIndex(PHRASES);
  assert.match(renderPhraseAwareMarking('looked forward to', matcher, {}), /data-key-phrase-id="look forward to"/);
  assert.match(renderPhraseAwareMarking('looking forward to', matcher, {}), /data-key-phrase-id="look forward to"/);
  assert.match(renderPhraseAwareMarking('carried out', matcher, {}), /data-key-phrase-id="carry out"/);
});

test('doubled final consonants unwrap onto the base form', () => {
  const matcher = buildKeyPhraseMatcherIndex([{ id: 'stop by', phrase: 'stop by', glossZh: '' }]);
  assert.match(renderPhraseAwareMarking('stopped by', matcher, {}), /data-key-phrase-id="stop by"/);
});

test('deals with matches the base-form phrase deal with via -s folding', () => {
  const matcher = buildKeyPhraseMatcherIndex(PHRASES);
  assert.match(renderPhraseAwareMarking('deals with', matcher, {}), /data-key-phrase-id="deal with"/);
});

test('possessive forms fold onto the base token', () => {
  const matcher = buildKeyPhraseMatcherIndex([{ id: 'world', phrase: 'world', glossZh: '' }]);
  assert.match(renderPhraseAwareMarking("the world's future", matcher, {}), /data-key-phrase-id="world"/);
});

test('phrase span keeps the original casing and inner text verbatim', () => {
  const matcher = buildKeyPhraseMatcherIndex(PHRASES);
  const html = renderPhraseAwareMarking('LOOK forward TO', matcher, {});
  assert.match(html, />LOOK forward TO<\/span>/);
});

test('sentence punctuation blocks a cross-clause phrase match', () => {
  const matcher = buildKeyPhraseMatcherIndex(PHRASES);
  const html = renderPhraseAwareMarking('look. Forward to', matcher, {});
  assert.doesNotMatch(html, /data-key-phrase-id="look forward to"/);
});

test('phrase highlighting takes precedence over word marking inside the span', () => {
  const matcher = buildKeyPhraseMatcherIndex(PHRASES);
  const wordIndex = new Map([['it', { word: 'it', stem: 'it' }]]);
  const html = renderPhraseAwareMarking('Look forward to it', matcher, { wordIndex, className: 'learning-word' });
  assert.match(html, /<span class="key-phrase"[^>]*>Look forward to<\/span> <mark class="learning-word"[^>]*>it<\/mark>/);
});

test('without a matcher the renderer falls back to plain word marking', () => {
  const wordIndex = new Map([['it', { word: 'it', stem: 'it' }]]);
  const html = renderPhraseAwareMarking('keep it', null, { wordIndex, className: 'learning-word' });
  assert.match(html, /<mark class="learning-word"[^>]*>it<\/mark>/);
  assert.doesNotMatch(html, /key-phrase/);
});

test('matchKeyPhraseAt reports the consumed token count', () => {
  const matcher = buildKeyPhraseMatcherIndex(PHRASES);
  const tokens = tokenize('She looked forward to the trip.');
  const hit = matchKeyPhraseAt(matcher, tokens, 1, 'She looked forward to the trip.');
  assert.ok(hit);
  assert.equal(hit.id, 'look forward to');
  assert.equal(hit.tokenCount, 3);
  assert.equal(matchKeyPhraseAt(matcher, tokens, 0, 'She looked forward to the trip.'), null);
});

test('curly apostrophes in the source normalize onto straight-quote phrases', () => {
  const matcher = buildKeyPhraseMatcherIndex([{ id: "world's", phrase: "world's", glossZh: '' }]);
  // id 里的单引号按 HTML 属性转义为 &#39;
  assert.match(renderPhraseAwareMarking('the world’s future', matcher, {}), /data-key-phrase-id="world&#39;s"/);
});
