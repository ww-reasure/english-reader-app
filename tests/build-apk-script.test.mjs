import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const require = createRequire(import.meta.url);

test('Android build script selects the platform Gradle wrapper from the android directory', async () => {
  const { getGradleCommand, getAndroidProjectDirectory } = require('../scripts/build-apk.js');
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

  assert.deepEqual(getGradleCommand('win32'), { command: 'gradlew.bat', args: ['assembleDebug'] });
  assert.deepEqual(getGradleCommand('linux'), { command: './gradlew', args: ['assembleDebug'] });
  assert.match(getAndroidProjectDirectory(), /android$/);
  assert.equal(packageJson.scripts['build:apk'], 'npm run build && node scripts/build-apk.js');
});

test('legacy Capacitor libraries receive an Android namespace only when missing', () => {
  const { withAndroidNamespace } = require('../scripts/build-apk.js');
  const missing = "android {\n    compileSdkVersion 30\n}";
  const present = "android {\n    namespace 'com.example.ready'\n}";

  assert.match(withAndroidNamespace(missing, 'com.example.legacy'), /namespace 'com\.example\.legacy'/);
  assert.equal(withAndroidNamespace(present, 'com.example.legacy'), present);
});

test('APK build preflight rejects stale version.json metadata before Gradle runs', () => {
  const { assertBuildReleaseMetadata } = require('../scripts/build-apk.js');

  assert.throws(
    () => assertBuildReleaseMetadata(
      { version: '1.8.5' },
      'versionCode 31\nversionName "1.8.5"',
      { version: '1.7.1', versionCode: 25 }
    ),
    /version\.json/
  );
});
