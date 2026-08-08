import assert from 'node:assert/strict';
import test from 'node:test';
import { assertApkEntries } from '../scripts/verify-apk-artifact.mjs';

const version = '1.9.3';
const versionCode = 37;

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

test('accepts a private QA APK with the real pack and no raw sources', () => {
  assert.deepEqual(
    assertApkEntries({
      entries: [
        'assets/public/release-manifest.json',
        'assets/public/exam-packs/private/index.json',
        'assets/public/exam-packs/private/local.kaoyan.en1.json'
      ],
      releaseManifest: manifest('private-qa'),
      flavor: 'private-qa',
      expectedVersion: version,
      expectedVersionCode: versionCode
    }),
    { flavor: 'private-qa', version, versionCode }
  );
});

test('rejects a public APK containing private pack entries', () => {
  assert.throws(
    () => assertApkEntries({
      entries: ['assets/public/release-manifest.json', 'assets/public/exam-packs/private/index.json'],
      releaseManifest: manifest('public', false),
      flavor: 'public',
      expectedVersion: version,
      expectedVersionCode: versionCode
    }),
    /private exam pack/i
  );
});

test('rejects raw private sources and manifest mismatches', () => {
  assert.throws(
    () => assertApkEntries({
      entries: ['assets/public/release-manifest.json', 'assets/public/exam-packs/private/index.json', 'assets/public/private_exam_sources/source.md'],
      releaseManifest: manifest('private-qa'),
      flavor: 'private-qa',
      expectedVersion: version,
      expectedVersionCode: versionCode
    }),
    /raw private source/i
  );

  assert.throws(
    () => assertApkEntries({
      entries: ['assets/public/release-manifest.json', 'assets/public/exam-packs/private/index.json', 'assets/public/exam-packs/private/local.kaoyan.en1.json'],
      releaseManifest: manifest('public', false),
      flavor: 'private-qa',
      expectedVersion: version,
      expectedVersionCode: versionCode
    }),
    /manifest.*flavor/i
  );
});
