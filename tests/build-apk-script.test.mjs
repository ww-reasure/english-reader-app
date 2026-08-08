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
  assert.equal(packageJson.scripts.dev, 'vite --mode private-qa');
  assert.equal(packageJson.scripts.build, 'vite build --mode public && node scripts/release-artifact.mjs --dir www --flavor public && npx cap sync android');
  assert.equal(packageJson.scripts['build:private-qa'], 'vite build --mode private-qa && node scripts/release-artifact.mjs --dir www --flavor private-qa && npx cap sync android');
  assert.equal(packageJson.scripts['build:apk'], 'npm run build:private-qa && node scripts/build-apk.js --flavor private-qa');
});

test('APK build options require the private QA flavor and use the shared output root', () => {
  const { parseBuildOptions, getReleaseApkPath } = require('../scripts/build-apk.js');

  assert.deepEqual(parseBuildOptions(['node', 'scripts/build-apk.js', '--flavor', 'private-qa']), { flavor: 'private-qa' });
  assert.throws(() => parseBuildOptions(['node', 'scripts/build-apk.js']), /--flavor private-qa/);
  assert.throws(() => parseBuildOptions(['node', 'scripts/build-apk.js', '--flavor', 'public']), /--flavor private-qa/);
  assert.match(
    getReleaseApkPath({ projectDirectory: 'E:\\play\\claude\\english-reader\\mobile', version: '1.9.3', versionCode: 37, flavor: 'private-qa' }),
    /EnglishReader-private-qa-v1\.9\.3-37-debug\.apk$/
  );
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

test('minor releases rebuild the OEWN derivative after the lexicon and before versioning or APK build', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

  assert.equal(
    packageJson.scripts['release:minor'],
    'npm run release:preflight && npm run version:minor && npm run build:apk'
  );
  assert.equal(
    packageJson.scripts['release:preflight'],
    'npm run security:audit && npm run exam-focus:verify && npm run exam-corpus:verify && npm run lexicon:verify && npm run oewn:verify && npm run track-baseline:verify'
  );
  assert.equal(packageJson.scripts['oewn:fetch'], 'node scripts/fetch-oewn-source.mjs');
  assert.equal(packageJson.scripts['oewn:build'], 'node scripts/build-oewn-artifact.mjs');
  assert.equal(packageJson.scripts['oewn:verify'], 'npm run oewn:fetch && npm run oewn:build');
  assert.equal(packageJson.scripts['exam-focus:build'], 'node scripts/build-exam-focus.mjs');
  assert.equal(packageJson.scripts['exam-focus:verify'], 'node scripts/build-exam-focus.mjs');
  assert.equal(packageJson.scripts['exam-corpus:verify'], 'node scripts/build-exam-corpus.mjs');
  assert.equal(
    packageJson.scripts['release:patch'],
    'npm run release:preflight && npm run version:patch && npm run build:apk'
  );
});
