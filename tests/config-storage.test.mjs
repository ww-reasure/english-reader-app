import assert from 'node:assert/strict';
import test from 'node:test';

import { CONFIG_STORAGE_KEYS, createConfigStorage } from '../src/config-storage.mjs';

function createWebStorage(initial = {}) {
  const values = new Map(Object.entries(initial));

  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

function createNativeStorage(initial = null) {
  let value = initial;
  let setCalls = 0;

  return {
    async get() {
      return value;
    },
    async set(_key, next) {
      setCalls += 1;
      value = next;
    },
    value() {
      return value;
    },
    setCalls() {
      return setCalls;
    }
  };
}

test('migrates only secrets to native storage while display settings remain synchronously available', async () => {
  const webStorage = createWebStorage({
    api_key: 'local-key',
    base_url: 'https://example.test/v1',
    model: 'example-model',
    theme: 'dark',
    unrelated_cache: 'do-not-migrate'
  });
  const nativeStorage = createNativeStorage();
  const storage = createConfigStorage({ webStorage, nativeStorage, isNative: true });

  assert.equal(storage.get('theme'), 'dark', 'display settings are readable before the asynchronous native bridge resolves');

  await storage.initialize();

  assert.equal(storage.get('api_key'), 'local-key');
  assert.equal(storage.get('theme'), 'dark');
  assert.deepEqual(nativeStorage.value(), { api_key: 'local-key' });
  assert.equal(webStorage.getItem('api_key'), null, 'the plaintext API key is removed after migration');
  assert.equal(webStorage.getItem('theme'), 'dark');
  assert.equal(webStorage.getItem('model'), 'example-model');
  assert.equal(webStorage.getItem('unrelated_cache'), 'do-not-migrate');
});

test('moves legacy native display settings to local storage and does not rewrite secure storage on display updates', async () => {
  const webStorage = createWebStorage({ theme: 'light' });
  const nativeStorage = createNativeStorage({ api_key: 'native-secret', theme: 'dark', model: 'native-model' });
  const storage = createConfigStorage({ webStorage, nativeStorage, isNative: true });

  await storage.initialize();
  await storage.set('theme', 'light');

  assert.equal(storage.get('theme'), 'light');
  assert.equal(webStorage.getItem('theme'), 'light');
  assert.equal(webStorage.getItem('model'), 'native-model');
  assert.deepEqual(nativeStorage.value(), { api_key: 'native-secret' });
  assert.equal(nativeStorage.setCalls(), 1, 'secure storage is rewritten only for the one-time legacy cleanup');
});

test('uses web storage only outside the native app', async () => {
  const webStorage = createWebStorage({ model: 'browser-model' });
  const storage = createConfigStorage({ webStorage, isNative: false });

  await storage.initialize();
  await storage.set('model', 'updated-browser-model');

  assert.equal(storage.get('model'), 'updated-browser-model');
  assert.equal(webStorage.getItem('model'), 'updated-browser-model');
});

test('serializes secret native writes so a slow earlier save cannot overwrite later secrets', async () => {
  let value = {};
  let callCount = 0;
  const nativeStorage = {
    async get() {
      return value;
    },
    async set(_key, next) {
      const snapshot = { ...next };
      const delay = callCount++ === 1 ? 20 : 0;
      await new Promise((resolve) => setTimeout(resolve, delay));
      value = snapshot;
    }
  };
  const storage = createConfigStorage({
    webStorage: createWebStorage(),
    nativeStorage,
    isNative: true
  });

  await storage.initialize();
  await Promise.all([
    storage.set('api_key', 'first-secret'),
    storage.set('tavily_api_key', 'second-secret')
  ]);

  assert.deepEqual(value, {
    api_key: 'first-secret',
    tavily_api_key: 'second-secret'
  });
});

test('an unchanged secure payload is never written again during startup', async () => {
  const nativeStorage = createNativeStorage({ api_key: 'stable-secret' });
  const storage = createConfigStorage({
    webStorage: createWebStorage({ theme: 'dark' }),
    nativeStorage,
    isNative: true
  });

  await storage.initialize();

  assert.equal(nativeStorage.setCalls(), 0);
  assert.equal(storage.get('api_key'), 'stable-secret');
  assert.equal(storage.get('theme'), 'dark');
});

test('persists the separate target, recommendation and calibration migration settings', () => {
  for (const key of [
    'reading_mode',
    'reading_word_marking',
    'home_learning_response_mode',
    'target_track_selection_required',
    'calibration_status',
    'lexicon_version',
    'exam_word_lookup_enabled'
  ]) {
    assert.ok(CONFIG_STORAGE_KEYS.includes(key), `${key} should survive the native-settings migration`);
  }
});
