import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  DEFAULT_DEEPSEEK_MODEL,
  DEEPSEEK_MODEL_IDS,
  listDeepSeekModelPresets,
  modelCapabilities,
  resolveModelForRequest,
  resolveVisionDefaultMigration
} from '../src/components/deepseek-model-catalog.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('Vision Exp is the default and is the only built-in image model', () => {
  assert.equal(DEFAULT_DEEPSEEK_MODEL, 'deepseek-v4-flash-vision-exp');
  assert.deepEqual(DEEPSEEK_MODEL_IDS, [
    'deepseek-v4-flash-vision-exp',
    'deepseek-v4-flash',
    'deepseek-v4-pro'
  ]);
  assert.equal(modelCapabilities('deepseek-v4-flash-vision-exp').images, true);
  assert.equal(modelCapabilities('deepseek-v4-flash').images, false);
  assert.equal(listDeepSeekModelPresets()[0].experimental, true);
});

test('only the old implicit Flash default migrates', () => {
  assert.equal(resolveVisionDefaultMigration({
    model: 'deepseek-v4-flash', explicitSelection: false, migrated: false
  }).model, 'deepseek-v4-flash-vision-exp');
  assert.equal(resolveVisionDefaultMigration({
    model: 'deepseek-v4-flash', explicitSelection: true, migrated: false
  }).model, 'deepseek-v4-flash');
  assert.equal(resolveVisionDefaultMigration({
    model: 'deepseek-v4-pro', explicitSelection: false, migrated: false
  }).model, 'deepseek-v4-pro');
});

test('official DeepSeek may override a text model for one image turn but custom endpoints may not', () => {
  assert.equal(resolveModelForRequest({
    baseUrl: 'https://api.deepseek.com/v1', selectedModel: 'deepseek-v4-pro', hasImages: true
  }).model, 'deepseek-v4-flash-vision-exp');
  assert.equal(resolveModelForRequest({
    baseUrl: 'https://gateway.example/v1', selectedModel: 'custom-model', hasImages: true
  }).error, 'custom_model_image_capability_unknown');
});

test('settings and API modal use the shared catalog instead of duplicate preset lists', async () => {
  const [settings, modal, index, config, storage, api] = await Promise.all([
    read('../src/views/settings.js'),
    read('../src/components/modal.js'),
    read('../index.html'),
    read('../src/config.js'),
    read('../src/config-storage.mjs'),
    read('../src/api.js')
  ]);
  assert.match(settings, /deepseek-model-catalog/);
  assert.match(settings, /listDeepSeekModelPresets/);
  assert.match(modal, /deepseek-model-catalog/);
  assert.match(modal, /listDeepSeekModelPresets/);
  assert.doesNotMatch(index, /value="deepseek-v4-flash"/);
  assert.doesNotMatch(index, /value="deepseek-v4-pro"/);
  assert.match(config, /model:\s*DEFAULT_DEEPSEEK_MODEL/);
  assert.match(config, /model_selection_explicit/);
  assert.match(config, /vision_default_migration/);
  assert.match(storage, /model_selection_explicit/);
  assert.match(storage, /vision_default_migration/);
  assert.match(api, /deepseek-model-catalog/);
});
