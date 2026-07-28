import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadDictionary() {
  const source = await readFile(new URL('../src/dictionary.js', import.meta.url), 'utf8');
  const adapted = source
    .replace("import { API } from './api.js';", "const API = { async translateWord() { return ''; } };")
    .replace("import { createLexiconLoader } from './lexicon-runtime.mjs';", "const createLexiconLoader = () => ({ async loadCore() { return { lexiconVersion: 'empty', entryCount: 0 }; }, async lookup() { return null; } });")
    .replace("import { createOewnDefinitionLoader } from './oewn-runtime.mjs';", "const createOewnDefinitionLoader = () => ({ async lookup() { return null; } });");
  return import('data:text/javascript;base64,' + Buffer.from(adapted).toString('base64'));
}

function entry({ lemma, forms = [lemma], phonetic = '', quality = 'limited', senses = [], layers = {} }) {
  return { lemma, forms, phonetic, quality, senses, layers, sourceRefs: ['fixture-source'] };
}

function createLoader(entries) {
  const index = new Map();
  for (const value of entries) {
    for (const form of [value.lemma, ...(value.forms || [])]) index.set(form.toLowerCase(), value);
  }
  return {
    async loadCore() { return { lexiconVersion: 'fixture-1', entryCount: entries.length }; },
    async lookup(word) { return index.get(String(word).toLowerCase()) || null; }
  };
}

test('uses only a high-quality traceable Chinese gloss before any network fallback', async () => {
  const { createDictionary } = await loadDictionary();
  let translated = 0;
  const dictionary = createDictionary({
    lexiconLoader: createLoader([entry({
      lemma: 'may',
      forms: ['may', 'might'],
      quality: 'high',
      senses: [{ pos: 'modal', glossZh: '可以；可能', quality: 'high', sourceRefs: ['fixture-source'] }],
      layers: { frequency: [{ band: 'ngsl-1', sourceRef: 'fixture-source' }] }
    })]),
    fetchFn: async () => { throw new Error('network should not be used'); },
    translateWord: async () => { translated += 1; return '错误回退'; }
  });

  const result = await dictionary.lookup('might');

  assert.equal(result.translation, '可以；可能');
  assert.equal(result.baseForm, 'may');
  assert.equal(result.definitionQuality, 'high');
  assert.equal(result.source, 'lexicon-high');
  assert.equal(result.freqLevel, 'high');
  assert.equal(translated, 0);
});

test('uses a screened offline Chinese learning sense without an online fallback', async () => {
  const { createDictionary } = await loadDictionary();
  let translated = 0;
  const dictionary = createDictionary({
    lexiconLoader: createLoader([entry({
      lemma: 'production',
      forms: ['production', 'productions'],
      quality: 'screened',
      senses: [{ pos: 'noun', glossZh: '生产；制造；产量', quality: 'screened', sourceRefs: ['fixture-source'] }],
      layers: { frequency: [{ band: 'ngsl-2', sourceRef: 'fixture-source' }] }
    })]),
    fetchFn: async () => { throw new Error('network should not be used'); },
    translateWord: async () => { translated += 1; return '错误回退'; }
  });

  const result = await dictionary.lookup('production');

  assert.equal(result.translation, '生产；制造；产量');
  assert.equal(result.definitionQuality, 'screened');
  assert.equal(result.source, 'lexicon-screened');
  assert.equal(result.freqLevel, 'high');
  assert.equal(translated, 0);
});

test('returns every trusted offline sense and its bundled phonetic without a network request', async () => {
  const { createDictionary } = await loadDictionary();
  const dictionary = createDictionary({
    lexiconLoader: createLoader([entry({
      lemma: 'form',
      phonetic: 'fɔːm',
      quality: 'screened',
      senses: [
        { pos: 'noun', glossZh: '类型；形式', quality: 'screened', sourceRefs: ['fixture-source'] },
        { pos: 'verb', glossZh: '形成；建立', quality: 'screened', sourceRefs: ['fixture-source'] },
        { pos: 'adjective', glossZh: '正式的', quality: 'screened', sourceRefs: ['fixture-source'] }
      ]
    })]),
    fetchFn: async () => { throw new Error('network should not be used'); },
    translateWord: async () => { throw new Error('translation should not be used'); }
  });

  const result = await dictionary.lookup('form');

  assert.equal(result.translation, '类型；形式');
  assert.equal(result.pos, 'noun');
  assert.equal(result.phonetic, 'fɔːm');
  assert.deepEqual(result.senses, [
    { pos: 'noun', glossZh: '类型；形式' },
    { pos: 'verb', glossZh: '形成；建立' },
    { pos: 'adjective', glossZh: '正式的' }
  ]);
});

test('ships production as an offline screened learning sense for shelf reading', async () => {
  const { createDictionary } = await loadDictionary();
  const core = JSON.parse(await readFile(new URL('../public/data/lexicon-core.json', import.meta.url), 'utf8'));
  const production = core.entries.find(entry => entry.lemma === 'production');
  assert.ok(production, 'shipped core must include production');
  assert.equal(production.quality, 'screened');
  assert.equal(production.senses[0]?.pos, 'noun');
  assert.match(production.senses[0]?.glossZh || '', /生产|制造/u);

  let fallbackCalls = 0;
  const dictionary = createDictionary({
    lexiconLoader: createLoader([production]),
    fetchFn: async () => { throw new Error('network should not be used'); },
    translateWord: async () => { fallbackCalls += 1; return '不应调用'; }
  });
  const result = await dictionary.lookup('production');

  assert.equal(result.definitionQuality, 'screened');
  assert.equal(result.source, 'lexicon-screened');
  assert.equal(result.translation, production.senses[0].glossZh);
  assert.equal(fallbackCalls, 0);
});

test('does not expose a limited entry Chinese gloss as a local truth and falls back to translation', async () => {
  const { createDictionary } = await loadDictionary();
  const dictionary = createDictionary({
    lexiconLoader: createLoader([entry({
      lemma: 'methodology',
      quality: 'limited',
      senses: [{ pos: 'noun', definitionEn: 'a system of methods', glossZh: '不应直接显示', quality: 'limited', sourceRefs: ['fixture-source'] }],
      layers: { academic: [{ sourceRef: 'fixture-source' }] }
    })]),
    fetchFn: async () => ({ ok: false }),
    translateWord: async word => `${word}：方法论`
  });

  const result = await dictionary.lookup('methodology');

  assert.equal(result.translation, 'methodology：方法论');
  assert.equal(result.definitionQuality, 'limited');
  assert.equal(result.source, 'lexicon-limited-ai');
  assert.equal(result.freqLevel, 'medium');
  assert.doesNotMatch(result.translation, /不应直接显示/);
});

test('does not accept an English source-word echo as a Chinese fallback', async () => {
  const { createDictionary } = await loadDictionary();
  const dictionary = createDictionary({
    lexiconLoader: createLoader([entry({
      lemma: 'production',
      quality: 'limited',
      layers: { frequency: [{ band: 'ngsl-2', sourceRef: 'fixture-source' }] }
    })]),
    oewnLoader: {
      async lookup() {
        return { definitionEn: 'the act of producing something', pos: 'noun' };
      }
    },
    fetchFn: async () => ({ ok: false }),
    translateWord: async () => 'production'
  });

  const result = await dictionary.lookup('production');

  assert.equal(result.translation, '英文释义：the act of producing something');
  assert.equal(result.definitionQuality, 'limited');
  assert.equal(result.source, 'lexicon-limited-oewn');
});

test('does not promote an undeclared heuristic stem to a high-quality Chinese gloss', async () => {
  const { createDictionary } = await loadDictionary();
  const core = JSON.parse(await readFile(new URL('../public/data/lexicon-core.json', import.meta.url), 'utf8'));
  const entries = ['approach', 'obtain'].map((lemma) => {
    const value = core.entries.find(entry => entry.lemma === lemma);
    assert.ok(value, `shipped core should include ${lemma}`);
    assert.equal(value.quality, 'high');
    return value;
  });
  const dictionary = createDictionary({
    lexiconLoader: createLoader(entries),
    fetchFn: async () => ({ ok: false }),
    translateWord: async word => `${word}：在线翻译`
  });

  for (const [word, baseForm] of Object.entries({
    approachable: 'approach',
    obtainable: 'obtain'
  })) {
    const result = await dictionary.lookup(word);
    assert.equal(result.baseForm, baseForm);
    assert.equal(result.translation, `${word}：在线翻译`);
    assert.equal(result.definitionQuality, 'limited');
    assert.equal(result.source, 'lexicon-limited-ai');
  }
});

test('uses a core-version-matched offline OEWN English definition for a limited entry when live fallbacks are unavailable', async () => {
  const { createDictionary } = await loadDictionary();
  const calls = [];
  const dictionary = createDictionary({
    lexiconLoader: createLoader([entry({
      lemma: 'methodology',
      quality: 'limited',
      senses: [{ pos: 'noun', quality: 'limited', sourceRefs: ['fixture-source'] }],
      layers: { academic: [{ sourceRef: 'fixture-source' }] }
    })]),
    oewnLoader: {
      async lookup(input) {
        calls.push(input);
        return { definitionEn: 'the system of methods used in a study', pos: 'noun' };
      }
    },
    fetchFn: async () => ({ ok: false }),
    translateWord: async () => ''
  });

  const result = await dictionary.lookup('methodology');

  assert.equal(result.translation, '英文释义：the system of methods used in a study');
  assert.equal(result.definitionEn, 'the system of methods used in a study');
  assert.equal(result.definitionQuality, 'limited');
  assert.equal(result.source, 'lexicon-limited-oewn');
  assert.deepEqual(calls, [{ lemma: 'methodology', pos: 'noun', coreLexiconVersion: 'fixture-1' }]);
});

test('dictionary implementation does not load legacy mixed dictionary or exam files', async () => {
  const source = await readFile(new URL('../src/dictionary.js', import.meta.url), 'utf8');

  assert.match(source, /createLexiconLoader/);
  assert.match(source, /loadCore/);
  assert.doesNotMatch(source, /dict-5000\.json/);
  assert.doesNotMatch(source, /exam-words\.json/);
  assert.doesNotMatch(source, /exam-frequency\.json/);
});
