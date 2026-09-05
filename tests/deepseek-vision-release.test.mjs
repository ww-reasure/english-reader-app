import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const gradleSource = await readFile(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
const versionManifest = JSON.parse(await readFile(new URL('../version.json', import.meta.url), 'utf8'));
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const releaseManifest = JSON.parse(await readFile(new URL('../www/release-manifest.json', import.meta.url), 'utf8'));

// main 线发布契约：package.json / build.gradle / version.json / release-manifest 四方保持同步。
// 断言跟随 version.json，避免每次升版都要手工改测试数字。
test('release metadata stays in sync across gradle, package.json and version.json', () => {
  const escapedVersion = versionManifest.version.replace(/\./gu, '\\.');
  assert.match(gradleSource, new RegExp(`versionCode\\s+${versionManifest.versionCode}`));
  assert.match(gradleSource, new RegExp(`versionName\\s+["']${escapedVersion}["']`));
  assert.equal(packageJson.version, versionManifest.version);
});

test('the built release manifest mirrors the version manifest', () => {
  assert.equal(releaseManifest.version, versionManifest.version);
  assert.equal(releaseManifest.versionCode, versionManifest.versionCode);
  assert.equal(typeof releaseManifest.privateExamPacksIncluded, 'boolean');
});
