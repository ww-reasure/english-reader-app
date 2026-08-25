import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const CONFIG_URL = new URL('../src/config.js', import.meta.url);
const STORAGE_URL = new URL('../src/config-storage.mjs', import.meta.url);
const TRACK_URL = new URL('../src/learning-track.mjs', import.meta.url);

function dataModule(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

function createWebStorage(values = {}) {
  const entries = new Map(Object.entries(values));
  return {
    getItem: key => entries.has(key) ? entries.get(key) : null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: key => entries.delete(key)
  };
}

async function loadConfig(values = {}) {
  const [configSource, storageSource, trackSource, catalogSource] = await Promise.all([
    readFile(CONFIG_URL, 'utf8'),
    readFile(STORAGE_URL, 'utf8'),
    readFile(TRACK_URL, 'utf8'),
    readFile(new URL('../src/components/deepseek-model-catalog.mjs', import.meta.url), 'utf8')
  ]);
  const storageModule = dataModule(storageSource);
  const trackModule = dataModule(trackSource);
  const catalogModule = dataModule(catalogSource);
  const source = configSource
    .replace("import { Capacitor } from '@capacitor/core';", 'const Capacitor = { isNativePlatform: () => false };')
    .replace("import { SecureStorage } from '@aparajita/capacitor-secure-storage';", 'const SecureStorage = null;')
    .replace("from './config-storage.mjs'", `from '${storageModule}'`)
    .replace("from './learning-track.mjs'", `from '${trackModule}'`)
    .replace("from './components/deepseek-model-catalog.mjs'", `from '${catalogModule}'`);
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = createWebStorage(values);
  try {
    const module = await import(dataModule(`${source}\n// test-instance:${Date.now()}-${Math.random()}`));
    await module.Config.initialize();
    return module.Config;
  } finally {
    globalThis.localStorage = previousStorage;
  }
}

test('fresh installs require an explicit target-track choice before reading generation', async () => {
  const config = await loadConfig();

  assert.equal(config.get('exam_level'), '');
  assert.equal(config.get('target_track_selection_required'), 'true');
});

test('an existing persisted current target migrates without unnecessarily asking again', async () => {
  const config = await loadConfig({ exam_level: 'cet6' });

  assert.equal(config.get('exam_level'), 'cet6');
  assert.equal(config.get('target_track_selection_required'), 'false');
});

test('the legacy graduate target still requires a new English I or English II choice', async () => {
  const config = await loadConfig({ exam_level: 'graduate', target_track_selection_required: 'false' });

  assert.equal(config.get('target_track_selection_required'), 'true');
});
