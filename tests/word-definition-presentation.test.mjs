import assert from 'node:assert/strict';
import test from 'node:test';

import * as DefinitionTrust from '../src/components/definition-trust.mjs';

test('normalizes display-ready parts of speech, phonetics, and unique Chinese senses', () => {
  assert.equal(DefinitionTrust.formatPartOfSpeech('noun'), 'n.');
  assert.equal(DefinitionTrust.formatPartOfSpeech('vt.'), 'v.');
  assert.equal(DefinitionTrust.formatPartOfSpeech('adjective'), 'adj.');
  assert.equal(DefinitionTrust.formatPhonetic('[fɔːm]'), '/fɔːm/');
  assert.equal(DefinitionTrust.formatPhonetic('/fɔːm/'), '/fɔːm/');

  assert.deepEqual(DefinitionTrust.getDefinitionSenses({
    translation: '类型；形式',
    pos: 'noun',
    senses: [
      { pos: 'noun', glossZh: '类型；形式' },
      { pos: 'verb', glossZh: '形成；建立' },
      { pos: 'noun', glossZh: '类型；形式' }
    ]
  }), [
    { pos: 'noun', glossZh: '类型；形式' },
    { pos: 'verb', glossZh: '形成；建立' }
  ]);

  assert.deepEqual(DefinitionTrust.getDefinitionDisplayLines({
    definitionSenses: [
      { pos: 'noun', glossZh: '类型；形式' },
      { pos: '', glossZh: '词性尚未确认的释义' }
    ]
  }), [
    { label: 'n.', glossZh: '类型；形式' },
    { label: '词性待确认', glossZh: '词性尚未确认的释义' }
  ]);
});
