import assert from 'node:assert/strict';
import test from 'node:test';

import { createOewnDefinitionLoader } from '../src/oewn-runtime.mjs';

function jsonResponse(payload) {
  return { ok: true, async json() { return payload; } };
}

const source = Object.freeze({
  id: 'oewn-2025-json',
  url: 'https://example.test/oewn.zip',
  version: '2025 edition',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  retrievedAt: '2026-07-26',
  sha256: 'a'.repeat(64),
  byteSize: 123,
  attribution: 'Open English WordNet Community, derived from Princeton WordNet, licensed CC BY 4.0.',
  purpose: 'english-definition-structure',
  status: 'derived-core-definitions-only'
});

const manifest = Object.freeze({ schemaVersion: 1, artifactVersion: 'oewn-core-definitions-v1', source });
const artifact = Object.freeze({
  schemaVersion: 1,
  artifactVersion: 'oewn-core-definitions-v1',
  coreLexiconVersion: 'core-v1',
  source,
  entryCount: 2,
  entries: [
    { lemma: 'record', pos: 'noun', senses: [{ id: 'record%1', synsetId: '1-n', definitionEn: 'a written account of facts' }] },
    { lemma: 'record', pos: 'verb', senses: [{ id: 'record%2', synsetId: '2-v', definitionEn: 'register information for later use' }] }
  ]
});

test('lazily returns an exact OEWN lemma/POS English definition only when it matches the active core version', async () => {
  const calls = [];
  const loader = createOewnDefinitionLoader({
    dataUrl: 'https://example.test/data',
    fetchFn: async url => {
      calls.push(url);
      if (url.endsWith('/oewn-artifact-manifest.json')) return jsonResponse(manifest);
      if (url.endsWith('/oewn-core-2025.json')) return jsonResponse(artifact);
      throw new Error(`unexpected ${url}`);
    }
  });

  const definition = await loader.lookup({ lemma: 'record', pos: 'verb', coreLexiconVersion: 'core-v1' });

  assert.deepEqual(definition, { definitionEn: 'register information for later use', pos: 'verb' });
  assert.deepEqual(calls, [
    'https://example.test/data/oewn-artifact-manifest.json',
    'https://example.test/data/oewn-core-2025.json'
  ]);
});

test('fails closed on a core-version mismatch and never treats the artifact as a Chinese or difficulty source', async () => {
  const loader = createOewnDefinitionLoader({
    fetchFn: async url => url.endsWith('manifest.json') ? jsonResponse(manifest) : jsonResponse(artifact)
  });

  assert.equal(await loader.lookup({ lemma: 'record', pos: 'noun', coreLexiconVersion: 'other-core' }), null);
  assert.equal(await loader.lookup({ lemma: 'record', pos: 'adjective', coreLexiconVersion: 'core-v1' }), null);
});
