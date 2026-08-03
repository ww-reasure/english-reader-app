import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { shouldShowApiOnboarding } from '../src/config-onboarding.mjs';

test('shows API onboarding only for an unconfigured first install', () => {
  assert.equal(shouldShowApiOnboarding({ apiKey: '', seen: false }), true);
  assert.equal(shouldShowApiOnboarding({ apiKey: 'configured', seen: false }), false);
  assert.equal(shouldShowApiOnboarding({ apiKey: '', seen: true }), false);
});

test('API onboarding can be closed without blocking the app and is not hard-coded', async () => {
  const [config, modal, app, storage] = await Promise.all([
    readFile(new URL('../src/config.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/modal.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/config-storage.mjs', import.meta.url), 'utf8')
  ]);
  assert.match(config, /api_onboarding_seen/);
  assert.match(config, /shouldShowApiOnboarding/);
  assert.match(modal, /showApiSettings\(\{ onboarding = false \} = \{\}\)/);
  assert.match(modal, /hideApiSettings\(\{ markSeen = true \} = \{\}\)/);
  assert.match(app, /showApiSettings\(\{ onboarding: true \}\)/);
  assert.match(storage, /api_onboarding_seen/);
  assert.doesNotMatch(config, /sk-[A-Za-z0-9_-]{8,}/, 'the API key must never be embedded in source');
});
