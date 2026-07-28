import assert from 'node:assert/strict';
import test from 'node:test';

import { ensureSavedWordDefinition } from '../src/components/saved-word-definition.mjs';

test('enriches a legacy saved word once without replacing its existing Chinese translation', async () => {
  let lookupCalls = 0;
  const updates = [];
  const legacy = {
    id: 17,
    word: 'form',
    translation: '形式',
    phonetic: '',
    pos: ''
  };
  const dependencies = {
    lookup: async () => {
      lookupCalls += 1;
      return {
        translation: '类型；形式',
        phonetic: 'fɔːm',
        pos: 'noun',
        lexiconVersion: 'core-v2',
        senses: [
          { pos: 'noun', glossZh: '类型；形式' },
          { pos: 'verb', glossZh: '形成；建立' }
        ]
      };
    },
    update: async (_id, fields) => updates.push(fields)
  };

  const enriched = await ensureSavedWordDefinition(legacy, dependencies);

  assert.equal(lookupCalls, 1);
  assert.equal(enriched.translation, '形式');
  assert.equal(enriched.phonetic, 'fɔːm');
  assert.equal(enriched.pos, 'noun');
  assert.deepEqual(enriched.definitionSenses, [
    { pos: 'noun', glossZh: '类型；形式' },
    { pos: 'verb', glossZh: '形成；建立' }
  ]);
  assert.equal(enriched.definitionSchemaVersion, 1);
  assert.equal(updates.length, 1);

  await ensureSavedWordDefinition(enriched, dependencies);
  assert.equal(lookupCalls, 1);
});
