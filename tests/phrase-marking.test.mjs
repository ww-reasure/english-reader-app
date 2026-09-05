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

test('placeholder tokens (sth/sb/do) match any single word', () => {
  const matcher = buildKeyPhraseMatcherIndex([{ id: 'respond to sth', phrase: 'respond to sth', glossZh: '回应' }]);
  assert.match(renderPhraseAwareMarking('respond to the question', matcher, {}), /data-key-phrase-id="respond to sth"/);
  assert.match(renderPhraseAwareMarking('respond to it', matcher, {}), /data-key-phrase-id="respond to sth"/);
  // 通配符只吃掉一个词，不能跨两个词
  assert.doesNotMatch(renderPhraseAwareMarking('respond to', matcher, {}), /data-key-phrase-id/);
});

test('capture one\u2019s attention style possessive placeholders are wildcards', () => {
  const matcher = buildKeyPhraseMatcherIndex([{ id: "capture one's attention", phrase: "capture one's attention", glossZh: '' }]);
  assert.match(renderPhraseAwareMarking('capture public attention', matcher, {}), /data-key-phrase-id="capture one&#39;s attention"/);
  assert.match(renderPhraseAwareMarking("capture one's attention", matcher, {}), /data-key-phrase-id="capture one&#39;s attention"/);
});

test('first-token placeholders stay literal: do/anything phrases cannot hijack real text', () => {
  const matcher = buildKeyPhraseMatcherIndex([
    { id: 'do good', phrase: 'do good', glossZh: '' },
    { id: 'do the trick', phrase: 'do the trick', glossZh: '' },
    { id: 'anything like', phrase: 'anything like', glossZh: '' }
  ]);
  // 资料里 do/anything 开头的词组是实义词，绝不能把 feels good / just like 误判成词组。
  assert.doesNotMatch(renderPhraseAwareMarking('She feels good about it.', matcher, {}), /data-key-phrase-id/);
  assert.doesNotMatch(renderPhraseAwareMarking('It was just like a dream.', matcher, {}), /data-key-phrase-id/);
  assert.doesNotMatch(renderPhraseAwareMarking('He knows the trick.', matcher, {}), /data-key-phrase-id/);
  // 字面形式照常命中，且 do 的常规变形（doing/did/does）也命中。
  assert.match(renderPhraseAwareMarking('do good every day', matcher, {}), /data-key-phrase-id="do good"/);
  assert.match(renderPhraseAwareMarking('doing good deeds', matcher, {}), /data-key-phrase-id="do good"/);
});

test('first-token placeholder tokens are literal, so sb-initial phrases need the exact word', () => {
  const matcher = buildKeyPhraseMatcherIndex([{ id: 'sb else', phrase: 'sb else', glossZh: '' }]);
  assert.doesNotMatch(renderPhraseAwareMarking('somebody else', matcher, {}), /data-key-phrase-id/);
});

test('gap no longer tolerates commas or ampersands', () => {
  const matcher = buildKeyPhraseMatcherIndex([{ id: 'carry out', phrase: 'carry out', glossZh: '' }]);
  assert.doesNotMatch(renderPhraseAwareMarking('carried, out the plan', matcher, {}), /data-key-phrase-id="carry out"/);
  assert.doesNotMatch(renderPhraseAwareMarking('carried & out', matcher, {}), /data-key-phrase-id="carry out"/);
});

test('-es words with silent-e bases fold onto the -s form', () => {
  const matcher = buildKeyPhraseMatcherIndex([{ id: 'size up', phrase: 'size up', glossZh: '' }]);
  assert.match(renderPhraseAwareMarking('sizes up the room', matcher, {}), /data-key-phrase-id="size up"/);
});

test('short -ed and -ing forms fold onto their base verbs', () => {
  const useUp = buildKeyPhraseMatcherIndex([{ id: 'use up', phrase: 'use up', glossZh: '' }]);
  assert.match(renderPhraseAwareMarking('used up everything', useUp, {}), /data-key-phrase-id="use up"/);
  const goAgainst = buildKeyPhraseMatcherIndex([{ id: 'go against', phrase: 'go against', glossZh: '' }]);
  assert.match(renderPhraseAwareMarking('going against the rules', goAgainst, {}), /data-key-phrase-id="go against"/);
});

test('news keeps its own surface and does not fold onto new', () => {
  const matcher = buildKeyPhraseMatcherIndex([{ id: 'new deal', phrase: 'new deal', glossZh: '' }]);
  assert.doesNotMatch(renderPhraseAwareMarking('The news deal was signed.', matcher, {}), /data-key-phrase-id="new deal"/);
});

test('the articles a/an/b stay literal so "many a" cannot jump across words', () => {
  const matcher = buildKeyPhraseMatcherIndex([
    { id: 'many a', phrase: 'many a', glossZh: '' },
    { id: 'a range of sth', phrase: 'a range of sth', glossZh: '' }
  ]);
  assert.match(renderPhraseAwareMarking('many a study', matcher, {}), /data-key-phrase-id="many a"/);
  assert.doesNotMatch(renderPhraseAwareMarking('Many aging clocks', matcher, {}), /data-key-phrase-id="many a"/);
  assert.match(renderPhraseAwareMarking('a range of topics', matcher, {}), /data-key-phrase-id="a range of sth"/);
  assert.doesNotMatch(renderPhraseAwareMarking('broad range of topics', matcher, {}), /data-key-phrase-id="a range of sth"/);
});

test('longest match still wins with wildcard candidates present', () => {
  const matcher = buildKeyPhraseMatcherIndex([
    { id: 'respond to sth', phrase: 'respond to sth', glossZh: '' },
    { id: 'respond to', phrase: 'respond to', glossZh: '' }
  ]);
  const html = renderPhraseAwareMarking('respond to pressure', matcher, {});
  assert.match(html, /data-key-phrase-id="respond to sth"/);
  assert.doesNotMatch(html, /data-key-phrase-id="respond"/);
});
