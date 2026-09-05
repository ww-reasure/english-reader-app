import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertKeyPhraseManifest,
  assertKeyPhrasePack,
  createKeyPhraseLibrary
} from '../src/key-phrase-library.mjs';

const MANIFEST = {
  schemaVersion: 1,
  packVersion: '2026-09-01',
  tracks: {
    general: { path: 'general.json', phraseCount: 2, derivedFrom: ['cet4', 'kaoyan'] },
    cet4: { path: 'cet4.json', phraseCount: 1 },
    kaoyan: { path: 'kaoyan.json', phraseCount: 1 }
  }
};

const PACKS = {
  'key-phrases/general.json': {
    schemaVersion: 1,
    track: 'general',
    phrases: [
      { p: 'look forward to', g: '期待；盼望' },
      { p: 'deal with', g: '处理' }
    ]
  },
  'key-phrases/cet4.json': {
    schemaVersion: 1,
    track: 'cet4',
    phrases: [{ p: 'carry out', g: '执行' }, { p: 'deal with', g: '处理' }]
  },
  'key-phrases/kaoyan.json': {
    schemaVersion: 1,
    track: 'kaoyan',
    phrases: [{ p: 'deal with', g: '处理；应付' }]
  }
};

function stubFetch() {
  let calls = 0;
  const fetchFn = async url => {
    calls += 1;
    const path = String(url).replace(/^.*\/key-phrases\//, 'key-phrases/');
    if (path === 'key-phrases/manifest.json') {
      return { ok: true, json: async () => MANIFEST };
    }
    const pack = PACKS[path];
    if (!pack) return { ok: false, json: async () => null };
    return { ok: true, json: async () => pack };
  };
  return { fetchFn, count: () => calls };
}

test('manifest validation enforces schema version and track table', () => {
  assert.equal(assertKeyPhraseManifest(MANIFEST).packVersion, '2026-09-01');
  assert.throws(() => assertKeyPhraseManifest({ schemaVersion: 2, tracks: {} }));
  assert.throws(() => assertKeyPhraseManifest({ schemaVersion: 1 }));
});

test('pack validation enforces schema, track identity and phrase rows', () => {
  assert.equal(assertKeyPhrasePack(PACKS['key-phrases/general.json'], { track: 'general' }).phrases.length, 2);
  assert.throws(() => assertKeyPhrasePack(PACKS['key-phrases/cet4.json'], { track: 'general' }));
  assert.throws(() => assertKeyPhrasePack({ schemaVersion: 1, track: 'general', phrases: [{ g: '无词组' }] }, { track: 'general' }));
});

test('library loads the requested track and exposes a working matcher', async () => {
  const { fetchFn } = stubFetch();
  const library = createKeyPhraseLibrary({ fetchFn });
  const matcher = await library.getMatcher({ track: 'general' });
  assert.equal(matcher.size, 2);
  assert.equal(matcher.byId.get('look forward to').glossZh, '期待；盼望');
  assert.equal((await library.getPhraseById('deal with', { track: 'general' }))?.glossZh, '处理');
});

test('getPhraseById merges levels across source packs and prefers the target gloss', async () => {
  const { fetchFn } = stubFetch();
  const library = createKeyPhraseLibrary({ fetchFn });
  // deal with 同时存在于 cet4 与 kaoyan；general 是派生包，不参与等级。
  const both = await library.getPhraseById('deal with', { targetTrack: 'kaoyan1' });
  assert.deepEqual(both.tracks, ['cet4', 'kaoyan']);
  assert.equal(both.glossZh, '处理；应付');
  assert.equal(both.phrase, 'deal with');

  const cet4Only = await library.getPhraseById('carry out', { targetTrack: 'cet4' });
  assert.deepEqual(cet4Only.tracks, ['cet4']);
  assert.equal(cet4Only.glossZh, '执行');

  // 目标 track 没有该词组时回落到任一来源释义。
  const fallback = await library.getPhraseById('carry out', { targetTrack: 'kaoyan1' });
  assert.equal(fallback.glossZh, '执行');
});

test('getPhraseIndex warms every non-derived source pack once', async () => {
  const { fetchFn, count } = stubFetch();
  const library = createKeyPhraseLibrary({ fetchFn });
  await library.getPhraseIndex();
  await library.getPhraseIndex();
  // manifest + cet4 + kaoyan（general 派生包不加载）
  assert.equal(count(), 3);
});

test('matcher resolution memoizes fetches per track', async () => {
  const { fetchFn, count } = stubFetch();
  const library = createKeyPhraseLibrary({ fetchFn });
  await library.getMatcher({ track: 'general' });
  await library.getMatcher({ track: 'general' });
  await library.getPhraseById('look forward to', { track: 'general' });
  // getMatcher: manifest + general；getPhraseIndex: 已有 manifest，只补 cet4/kaoyan 两个来源包
  assert.equal(count(), 4);
});

test('a track missing from the manifest degrades to an empty matcher', async () => {
  const { fetchFn } = stubFetch();
  const library = createKeyPhraseLibrary({ fetchFn });
  const matcher = await library.getMatcher({ track: 'cet6' });
  assert.equal(matcher.size, 0);
});

test('default track falls back to general when no target is given', async () => {
  const { fetchFn } = stubFetch();
  const library = createKeyPhraseLibrary({ fetchFn });
  const matcher = await library.getMatcher({});
  assert.equal(matcher.size, 2);
});

test('a failed manifest fetch does not poison later retries', async () => {
  let attempts = 0;
  const library = createKeyPhraseLibrary({ fetchFn: async url => {
    if (String(url).endsWith('manifest.json')) {
      attempts += 1;
      if (attempts === 1) return { ok: false, json: async () => null };
      return { ok: true, json: async () => MANIFEST };
    }
    return { ok: true, json: async () => PACKS['key-phrases/general.json'] };
  } });
  await assert.rejects(() => library.getMatcher({ track: 'general' }));
  const matcher = await library.getMatcher({ track: 'general' });
  assert.equal(matcher.size, 2);
});

test('cet6 targets fall back to the general union pack', () => {
  const { fetchFn } = stubFetch();
  const library = createKeyPhraseLibrary({ fetchFn });
  assert.equal(library.resolveTargetTrack('cet6'), 'general');
});

test('resolveTargetTrack maps kaoyan variants onto the kaoyan shard', () => {
  const library = createKeyPhraseLibrary({ fetchFn: async () => ({ ok: true, json: async () => MANIFEST }) });
  assert.equal(library.resolveTargetTrack('kaoyan1'), 'kaoyan');
  assert.equal(library.resolveTargetTrack('kaoyan2'), 'kaoyan');
  assert.equal(library.resolveTargetTrack('cet4'), 'cet4');
  assert.equal(library.resolveTargetTrack(''), 'general');
  assert.equal(library.resolveTargetTrack('unknown'), 'general');
});
