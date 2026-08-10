import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { CONFIG_STORAGE_KEYS, createConfigStorage } from '../src/config-storage.mjs';

function createWebStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

test('tavily_api_key and web_research_mode are known config keys that persist through secure storage', async () => {
  assert.ok(CONFIG_STORAGE_KEYS.includes('tavily_api_key'));
  assert.ok(CONFIG_STORAGE_KEYS.includes('web_research_mode'));
  const webStorage = createWebStorage({ tavily_api_key: 'tvly-secret', web_research_mode: 'tavily' });
  const storage = createConfigStorage({ webStorage, isNative: false });

  await storage.initialize();
  assert.equal(storage.get('tavily_api_key'), 'tvly-secret');
  assert.equal(storage.get('web_research_mode'), 'tavily');
  await storage.set('tavily_api_key', 'tvly-updated');
  await storage.set('web_research_mode', 'off');
  assert.equal(webStorage.getItem('tavily_api_key'), 'tvly-updated');
  assert.equal(webStorage.getItem('web_research_mode'), 'off');
});

test('settings page exposes web research mode, native test, Tavily key field and tutorials', async () => {
  const source = (await readFile(new URL('../src/views/settings.js', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');

  assert.match(source, /settingsTavilyKey/);
  assert.match(source, /tavily_api_key/);
  assert.match(source, /settingsWebResearchMode/);
  assert.match(source, /联网检索/);
  assert.match(source, /testTavilyConnection/);
  assert.match(source, /toggleTavilyKeyVisibility/);
  assert.match(source, /testDeepSeekNativeConnection/);
  assert.match(source, /如何获取 Tavily API Key/);
  assert.match(source, /tavily\.com/);
  assert.match(source, /deepseek-v4-flash/);
  assert.match(source, /SettingsView\.testTavilyConnection\(\)/);
  assert.match(source, /SettingsView\.testDeepSeekNativeConnection\(\)/);
});

test('settings save persists the Tavily key and web research mode alongside existing API settings', async () => {
  const source = (await readFile(new URL('../src/views/settings.js', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
  const save = source.match(/save\(\) \{([\s\S]*?)\n  \},\n\n  \/\/ Load title translation cache info/s);
  assert.ok(save, 'SettingsView.save must stay inspectable');
  assert.match(save[1], /Config\.set\('tavily_api_key',\s*document\.getElementById\('settingsTavilyKey'\)\.value\.trim\(\)\)/);
  assert.match(save[1], /Config\.set\('web_research_mode',\s*document\.getElementById\('settingsWebResearchMode'\)\?\.value \|\| 'deepseek_native'\)/);
});
