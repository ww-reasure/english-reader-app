import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

test('bumps a patch release by 0.0.1 and a major update by 0.1.0', () => {
  const { bumpVersion } = require('../scripts/bump-version.js');

  assert.equal(bumpVersion('1.7.1', 'patch'), '1.7.2');
  assert.equal(bumpVersion('1.7.1', 'minor'), '1.8.0');
});

test('keeps Android version name aligned while incrementing version code', () => {
  const { withAndroidVersion } = require('../scripts/bump-version.js');
  const gradle = 'versionCode 25\nversionName "1.7.1"';

  assert.equal(withAndroidVersion(gradle, '1.8.0'), 'versionCode 26\nversionName "1.8.0"');
});

test('uses the Android release version when package metadata is stale', () => {
  const { getReleaseVersion } = require('../scripts/bump-version.js');

  assert.equal(getReleaseVersion('2.0.0', 'versionCode 25\nversionName "1.7.1"'), '1.7.1');
});
