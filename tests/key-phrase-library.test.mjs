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
    general: { path: 'general.json', phraseCount: 2 },
    cet4: { path: 'cet4.json', phraseCount: 1 }
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
    phrases: [{ p: 'carry out', g: '执行' }]
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

test('matcher resolution memoizes fetches per track', async () => {
  const { fetchFn, count } = stubFetch();
  const library = createKeyPhraseLibrary({ fetchFn });
  await library.getMatcher({ track: 'general' });
  await library.getMatcher({ track: 'general' });
  await library.getPhraseById('deal with', { track: 'general' });
  assert.equal(count(), 2);
});

test('a track missing from the manifest degrades to an empty matcher', async () => {
  const { fetchFn } = stubFetch();
  const library = createKeyPhraseLibrary({ fetchFn });
  const matcher = await library.getMatcher({ track: 'kaoyan' });
  assert.equal(matcher.size, 0);
});

test('default track falls back to general when no target is given', async () => {
  const { fetchFn } = stubFetch();
  const library = createKeyPhraseLibrary({ fetchFn });
  const matcher = await library.getMatcher({});
  assert.equal(matcher.size, 2);
});

test('resolveTargetTrack maps kaoyan variants onto the kaoyan shard', () => {
  const library = createKeyPhraseLibrary({ fetchFn: async () => ({ ok: true, json: async () => MANIFEST }) });
  assert.equal(library.resolveTargetTrack('kaoyan1'), 'kaoyan');
  assert.equal(library.resolveTargetTrack('kaoyan2'), 'kaoyan');
  assert.equal(library.resolveTargetTrack('cet4'), 'cet4');
  assert.equal(library.resolveTargetTrack(''), 'general');
  assert.equal(library.resolveTargetTrack('unknown'), 'general');
});
