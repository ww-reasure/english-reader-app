import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { fetchPinnedOewnSource } from '../scripts/fetch-oewn-source.mjs';

const bytes = Buffer.from('fixed official OEWN archive bytes');
const source = Object.freeze({
  id: 'oewn-2025-json',
  title: 'Open English WordNet 2025 JSON',
  url: 'https://example.test/english-wordnet-2025-json.zip',
  version: '2025 edition',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  retrievedAt: '2026-07-26',
  sha256: createHash('sha256').update(bytes).digest('hex'),
  byteSize: bytes.byteLength,
  purpose: 'english-definition-structure',
  attribution: 'Open English WordNet Community, derived from Princeton WordNet, licensed CC BY 4.0.',
  snapshotPath: 'oewn/english-wordnet-2025-json.zip',
  status: 'derived-core-definitions-only'
});

test('refuses changed OEWN release bytes before writing the local reproducible cache', async () => {
  let wrote = false;

  await assert.rejects(() => fetchPinnedOewnSource({
    source,
    sourceDir: '.tmp-oewn-source-test',
    fetchFn: async () => ({ ok: true, async arrayBuffer() { return Buffer.from('changed').buffer; } }),
    mkdirFn: async () => {},
    writeFileFn: async () => { wrote = true; }
  }), /校验和/);

  assert.equal(wrote, false);
});

test('writes only checksum-verified OEWN release bytes to its configured relative cache path', async () => {
  let wrotePath = '';
  let wroteBytes = null;

  const result = await fetchPinnedOewnSource({
    source,
    sourceDir: 'E:/fixture/oewn-cache',
    fetchFn: async () => ({ ok: true, async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } }),
    mkdirFn: async () => {},
    writeFileFn: async (path, value) => { wrotePath = path; wroteBytes = Buffer.from(value); }
  });

  assert.match(wrotePath.replace(/\\/g, '/'), /E:\/fixture\/oewn-cache\/oewn\/english-wordnet-2025-json\.zip$/);
  assert.deepEqual(wroteBytes, bytes);
  assert.deepEqual(result, {
    id: source.id,
    snapshotPath: source.snapshotPath,
    sha256: source.sha256,
    byteSize: source.byteSize
  });
});
