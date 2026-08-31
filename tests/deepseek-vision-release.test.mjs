import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const gradleSource = await readFile(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
const versionManifest = JSON.parse(await readFile(new URL('../version.json', import.meta.url), 'utf8'));

// main 线发布契约：语义版本与 Android versionCode 保持同步（无 private-qa 口味）。
test('release keeps semantic version 1.9.5 and Android versionCode 41 in sync', () => {
  assert.match(gradleSource, /versionCode\s+41/);
  assert.match(gradleSource, /versionName\s+["']1\.9\.5["']/);
  assert.equal(versionManifest.versionCode, 41);
  assert.equal(versionManifest.version, '1.9.5');
});
