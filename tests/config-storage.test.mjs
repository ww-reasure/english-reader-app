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

  return {
    async get() {
      return value;
    },
    async set(_key, next) {
      value = next;
    },
    value() {
      return value;
    }
  };
}

test('migrates known app settings from WebView storage to native storage once', async () => {
  const webStorage = createWebStorage({
    api_key: 'local-key',
    base_url: 'https://example.test/v1',
    model: 'example-model',
    theme: 'dark',
    unrelated_cache: 'do-not-migrate'
  });
  const nativeStorage = createNativeStorage();
  const storage = createConfigStorage({ webStorage, nativeStorage, isNative: true });

  await storage.initialize();

  assert.equal(storage.get('api_key'), 'local-key');
  assert.equal(storage.get('theme'), 'dark');
  assert.deepEqual(nativeStorage.value(), {
    api_key: 'local-key',
    base_url: 'https://example.test/v1',
    model: 'example-model',
    theme: 'dark'
  });
  assert.equal(webStorage.getItem('api_key'), null, 'the plaintext API key is removed after migration');
  assert.equal(webStorage.getItem('unrelated_cache'), 'do-not-migrate');
});

test('prefers native values and persists subsequent updates without writing plaintext fallback data', async () => {
  const webStorage = createWebStorage({ theme: 'light' });
  const nativeStorage = createNativeStorage({ theme: 'dark', model: 'native-model' });
  const storage = createConfigStorage({ webStorage, nativeStorage, isNative: true });

  await storage.initialize();
  await storage.set('theme', 'light');

  assert.equal(storage.get('theme'), 'light');
  assert.equal(webStorage.getItem('theme'), null);
  assert.deepEqual(nativeStorage.value(), { theme: 'light', model: 'native-model' });
});

test('uses web storage only outside the native app', async () => {
  const webStorage = createWebStorage({ model: 'browser-model' });
  const storage = createConfigStorage({ webStorage, isNative: false });

  await storage.initialize();
  await storage.set('model', 'updated-browser-model');

  assert.equal(storage.get('model'), 'updated-browser-model');
  assert.equal(webStorage.getItem('model'), 'updated-browser-model');
});

test('serializes native writes so a slow earlier save cannot overwrite later settings', async () => {
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
    storage.set('base_url', 'https://example.test/v1'),
    storage.set('model', 'example-model')
  ]);

  assert.deepEqual(value, {
    base_url: 'https://example.test/v1',
    model: 'example-model'
  });
});

test('persists the separate target, recommendation and calibration migration settings', () => {
  for (const key of ['reading_mode', 'target_track_selection_required', 'calibration_status', 'lexicon_version', 'exam_word_lookup_enabled']) {
    assert.ok(CONFIG_STORAGE_KEYS.includes(key), `${key} should survive the native-settings migration`);
  }
});
