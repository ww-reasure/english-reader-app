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
