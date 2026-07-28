import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import * as Oewn from '../scripts/build-oewn-artifact.mjs';

const sourceFixture = Object.freeze({
  id: 'oewn-2025-json',
  title: 'Open English WordNet 2025 JSON',
  url: 'https://en-word.net/static/english-wordnet-2025-json.zip',
  version: '2025 edition',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  retrievedAt: '2026-07-26',
  purpose: 'english-definition-structure',
  attribution: 'Open English WordNet Community, derived from Princeton WordNet, licensed CC BY 4.0.',
  snapshotPath: 'oewn/english-wordnet-2025-json.zip',
  status: 'derived-core-definitions-only'
});

function fixturePayload() {
  return {
    entryMaps: [{
      record: {
        n: { sense: [{ id: 'record%1:10:03::', synset: '0001-n' }] },
        v: { sense: [{ id: 'record%2:32:00::', synset: '0002-v' }] }
      },
      recorded: {
        v: { sense: [{ id: 'recorded%2:32:00::', synset: '0003-v' }] }
      },
      'New York': {
        n: { sense: [{ id: 'new_york%1:15:00::', synset: '0004-n' }] }
      }
    }],
    synsetMaps: [{
      '0001-n': { definition: ['anything (such as a document or a phonograph record or a photograph) providing permanent evidence of or information about past events'] },
      '0002-v': { definition: ['register electronically'] },
      '0003-v': { definition: ['store a sound or performance'] },
      '0004-n': { definition: ['the largest city in New York'] }
    }]
  };
}

test('builds an OEWN artifact only for exact active-core lemmas and POS-linked English definitions', () => {
  const payload = fixturePayload();
  const sourceBytes = Buffer.from(JSON.stringify(payload));
  const source = {
    ...sourceFixture,
    sha256: createHash('sha256').update(sourceBytes).digest('hex'),
    byteSize: sourceBytes.byteLength
  };

  const artifact = Oewn.buildOewnCoreArtifact({
    source,
    sourceBytes,
    coreArtifact: {
      lexiconVersion: '2026.07.26-core.fixture',
      entries: [
        { lemma: 'record', forms: ['record', 'records', 'recorded'] },
        { lemma: 'the', forms: ['the'] }
      ]
    },
    entryMaps: payload.entryMaps,
    synsetMaps: payload.synsetMaps,
    generatedAt: '2026-07-26T00:00:00.000Z'
  });

  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.coreLexiconVersion, '2026.07.26-core.fixture');
  assert.deepEqual(artifact.source, {
    id: source.id,
    url: source.url,
    version: source.version,
    license: source.license,
    licenseUrl: source.licenseUrl,
    retrievedAt: source.retrievedAt,
    sha256: source.sha256,
    byteSize: source.byteSize,
    attribution: source.attribution
  });
  assert.deepEqual(artifact.entries, [
    {
      lemma: 'record',
      pos: 'noun',
      senses: [{ id: 'record%1:10:03::', synsetId: '0001-n', definitionEn: 'anything (such as a document or a phonograph record or a photograph) providing permanent evidence of or information about past events' }]
    },
    {
      lemma: 'record',
      pos: 'verb',
      senses: [{ id: 'record%2:32:00::', synsetId: '0002-v', definitionEn: 'register electronically' }]
    }
  ]);
  const serialized = JSON.stringify(artifact);
  assert.doesNotMatch(serialized, /recorded|New York|glossZh|difficulty|frequency/);
});

test('refuses an OEWN payload whose checksum is not the declared fixed source', () => {
  const sourceBytes = Buffer.from(JSON.stringify(fixturePayload()));
  const source = {
    ...sourceFixture,
    sha256: '0'.repeat(64),
    byteSize: sourceBytes.byteLength
  };

  assert.throws(() => Oewn.buildOewnCoreArtifact({
    source,
    sourceBytes,
    coreArtifact: { lexiconVersion: 'fixture', entries: [] },
    entryMaps: fixturePayload().entryMaps,
    synsetMaps: fixturePayload().synsetMaps,
    generatedAt: '2026-07-26T00:00:00.000Z'
  }), /校验和/);
});
