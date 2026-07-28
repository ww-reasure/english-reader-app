import assert from 'node:assert/strict';
import test from 'node:test';
import { definitionTrustLabel, getDefinitionPreview, getSavableTranslation } from '../src/components/definition-trust.mjs';

test('labels offline reviewed, limited fallback, and unavailable dictionary results distinctly', () => {
  assert.equal(definitionTrustLabel({ definitionQuality: 'high', source: 'lexicon-high' }), '离线高可信学习义');
  assert.equal(definitionTrustLabel({ definitionQuality: 'screened', source: 'lexicon-screened' }), '离线筛选学习义');
  assert.equal(definitionTrustLabel({ definitionQuality: 'limited', source: 'lexicon-limited' }), '受限词条：英文结构提示');
  assert.equal(definitionTrustLabel({ definitionQuality: 'limited', source: 'lexicon-limited-ai' }), '受限词条：在线临时释义');
  assert.equal(definitionTrustLabel({ definitionQuality: 'unavailable', source: 'api' }), '在线临时释义');
  assert.equal(definitionTrustLabel({ definitionQuality: 'unavailable', source: 'unavailable' }), '暂未取得可靠释义');
});

test('only stores Chinese glossary text for saved words', () => {
  assert.equal(getSavableTranslation({ word: 'production', translation: '生产；制造；产量' }), '生产；制造；产量');
  assert.equal(getSavableTranslation({ word: 'production', translation: 'production' }), '');
  assert.equal(getSavableTranslation({ word: 'production', translation: '英文释义：the act of producing something' }), '');
  assert.equal(getSavableTranslation({ word: 'production', translation: '暂时无法获取可靠释义' }), '');
});

test('keeps the first two distinct definitions visible and expands only later definitions', () => {
  const preview = getDefinitionPreview({
    definitionSenses: [
      { pos: 'noun', glossZh: '攻击；袭击' },
      { pos: 'verb', glossZh: '攻击；抨击' },
      { pos: 'adjective', glossZh: '攻击性的' }
    ]
  });

  assert.deepEqual(preview.visibleLines.map(line => line.glossZh), ['攻击；袭击', '攻击；抨击']);
  assert.deepEqual(preview.additionalLines.map(line => line.glossZh), ['攻击性的']);
  assert.equal(preview.total, 3);
});
