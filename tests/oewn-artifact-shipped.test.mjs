import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const manifestPath = resolve('public/data/oewn-artifact-manifest.json');
const artifactPath = resolve('public/data/oewn-core-2025.json');
const corePath = resolve('public/data/lexicon-core.json');

function collectObjectKeys(value, keys = []) {
  if (Array.isArray(value)) {
    value.forEach(item => collectObjectKeys(item, keys));
    return keys;
  }
  if (!value || typeof value !== 'object') return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.push(key);
    collectObjectKeys(child, keys);
  }
  return keys;
}

test('ships a checksum-pinned OEWN 2025 derivative with only exact active-core English definitions', () => {
  assert.equal(existsSync(manifestPath), true, 'OEWN 的独立来源清单必须随应用发布');
  assert.equal(existsSync(artifactPath), true, 'OEWN 的轻量英文义项产物必须随应用发布');

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  const core = JSON.parse(readFileSync(corePath, 'utf8'));
  const source = manifest.source;

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(source.id, 'oewn-2025-json');
  assert.equal(source.url, 'https://github.com/globalwordnet/english-wordnet/releases/download/2025-edition/english-wordnet-2025-json.zip');
  assert.equal(source.sha256, '7d749f6e2c39e6970e4997839dcf6e42fd281f3c2fae0171d2192bae8cfa4b51');
  assert.equal(source.byteSize, 9986555);
  assert.equal(source.purpose, 'english-definition-structure');
  assert.equal(source.status, 'derived-core-definitions-only');
  assert.match(source.license, /CC BY 4\.0/);
  assert.match(source.attribution, /Open English WordNet Community/);

  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.coreLexiconVersion, core.lexiconVersion);
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
  assert.equal(artifact.entryCount, artifact.entries.length);
  assert.ok(artifact.entryCount > 1000, '派生产物应覆盖足够多的 active-core exact lemma + POS 组合');

  const activeCoreLemmas = new Set(core.entries.map((entry) => entry.lemma));
  assert.ok(artifact.entries.every((entry) => activeCoreLemmas.has(entry.lemma)));
  assert.ok(artifact.entries.every((entry) => ['noun', 'verb', 'adjective', 'adverb'].includes(entry.pos)));
  assert.ok(artifact.entries.every((entry) => entry.senses.length > 0));
  assert.ok(artifact.entries.every((entry) => entry.senses.every((sense) =>
    typeof sense.definitionEn === 'string' && sense.definitionEn.trim() && !Object.hasOwn(sense, 'glossZh'))));
  const forbiddenKeys = new Set(['forms', 'layers', 'frequency', 'difficulty', 'examFocus', 'glossZh']);
  assert.ok(collectObjectKeys(artifact).every(key => !forbiddenKeys.has(key)));
});
