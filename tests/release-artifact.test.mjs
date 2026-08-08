import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertReleaseArtifact } from '../scripts/release-artifact.mjs';

const version = '1.9.3';
const versionCode = 37;

async function createArtifact(files) {
  const root = await mkdtemp(join(tmpdir(), 'english-reader-release-'));
  for (const [relativePath, contents] of Object.entries(files)) {
    const path = join(root, relativePath);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, typeof contents === 'string' ? contents : JSON.stringify(contents));
  }
  return root;
}

function manifest(flavor, privateExamPacksIncluded = flavor === 'private-qa') {
  return {
    schemaVersion: 1,
    flavor,
    version,
    versionCode,
    privateExamPacksIncluded,
    distribution: flavor === 'private-qa' ? 'internal-authorized' : 'public'
  };
}

function privateIndex(path = '/exam-packs/private/local.kaoyan.en1.json') {
  return {
    schemaVersion: 1,
    packs: [{ packageId: 'local.kaoyan.en1', path }]
  };
}

test('accepts a public artifact when private pack paths are absent', async t => {
  const root = await createArtifact({
    'release-manifest.json': manifest('public', false),
    'data/app.json': '{}'
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = assertReleaseArtifact({
    artifactDir: root,
    flavor: 'public',
    expectedVersion: version,
    expectedVersionCode: versionCode
  });

  assert.deepEqual(result, {
    flavor: 'public',
    version,
    versionCode,
    packs: []
  });
});

test('accepts a private QA artifact with every indexed pack', async t => {
  const root = await createArtifact({
    'release-manifest.json': manifest('private-qa'),
    'exam-packs/private/index.json': privateIndex(),
    'exam-packs/private/local.kaoyan.en1.json': '{}'
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = assertReleaseArtifact({
    artifactDir: root,
    flavor: 'private-qa',
    expectedVersion: version,
    expectedVersionCode: versionCode
  });

  assert.deepEqual(result, {
    flavor: 'private-qa',
    version,
    versionCode,
    packs: ['local.kaoyan.en1']
  });
});

test('rejects a public artifact that contains a private pack', async t => {
  const root = await createArtifact({
    'release-manifest.json': manifest('public', false),
    'exam-packs/private/index.json': privateIndex(),
    'exam-packs/private/local.kaoyan.en1.json': '{}'
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  assert.throws(
    () => assertReleaseArtifact({ artifactDir: root, flavor: 'public', expectedVersion: version, expectedVersionCode: versionCode }),
    /private exam pack/i
  );
});

test('rejects a private QA artifact when the required real pack is missing', async t => {
  const root = await createArtifact({
    'release-manifest.json': manifest('private-qa'),
    'exam-packs/private/index.json': privateIndex()
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  assert.throws(
    () => assertReleaseArtifact({ artifactDir: root, flavor: 'private-qa', expectedVersion: version, expectedVersionCode: versionCode }),
    /missing.*local\.kaoyan\.en1/i
  );
});

test('rejects private pack files that are not declared by the index', async t => {
  const root = await createArtifact({
    'release-manifest.json': manifest('private-qa'),
    'exam-packs/private/index.json': privateIndex(),
    'exam-packs/private/local.kaoyan.en1.json': '{}',
    'exam-packs/private/undeclared.json': '{}'
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  assert.throws(
    () => assertReleaseArtifact({ artifactDir: root, flavor: 'private-qa', expectedVersion: version, expectedVersionCode: versionCode }),
    /undeclared.*pack/i
  );
});

test('rejects path traversal and raw private source paths', async t => {
  const traversalRoot = await createArtifact({
    'release-manifest.json': manifest('private-qa'),
    'exam-packs/private/index.json': privateIndex('/private_exam_sources/raw/source.pdf'),
    'private_exam_sources/raw/source.pdf': 'private'
  });
  t.after(() => rm(traversalRoot, { recursive: true, force: true }));

  assert.throws(
    () => assertReleaseArtifact({ artifactDir: traversalRoot, flavor: 'private-qa', expectedVersion: version, expectedVersionCode: versionCode }),
    /private source|path|outside/i
  );
});
