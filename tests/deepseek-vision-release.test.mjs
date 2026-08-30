import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const gradleSource = await readFile(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
const versionManifest = JSON.parse(await readFile(new URL('../version.json', import.meta.url), 'utf8'));

test('private QA release keeps semantic version 2.0.0 and increments Android versionCode to 47', () => {
  assert.match(gradleSource, /versionCode\s+47/);
  assert.match(gradleSource, /versionName\s+["']2\.0\.0["']/);
  assert.equal(versionManifest.versionCode, 47);
  assert.equal(versionManifest.version, '2.0.0');
});
