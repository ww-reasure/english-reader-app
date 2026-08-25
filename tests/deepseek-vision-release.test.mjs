import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const gradleSource = await readFile(new URL('../android/app/build.gradle', import.meta.url), 'utf8');

test('DeepSeek vision chat release keeps semantic version 2.0.0 and increments Android versionCode to 43', () => {
  assert.match(gradleSource, /versionCode\s+43/);
  assert.match(gradleSource, /versionName\s+["']2\.0\.0["']/);
});
