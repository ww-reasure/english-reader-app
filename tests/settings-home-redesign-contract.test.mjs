import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const settingsSource = (await readFile(new URL('../src/views/settings.js', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
const shellSource = (await readFile(new URL('../src/components/app-shell.js', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
const cssSource = (await readFile(new URL('../css/style.css', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');

test('settings is a focused secondary page with a real back action', () => {
  assert.match(shellSource, /hash === '#\/settings'[\s\S]*?headerMode: 'back'[\s\S]*?backFallback: '#\/chat'[\s\S]*?tabletLayout: 'focus'/);
  assert.match(shellSource, /app-shell--settings/);
});

test('settings follows the selected preference overview and grouped information architecture', () => {
  assert.match(settingsSource, /settings-preference-overview/);
  assert.match(settingsSource, />学习偏好</);
  assert.match(settingsSource, /settings-preference-metrics/);
  assert.match(settingsSource, /settings-study-panel/);
  assert.match(settingsSource, />学习设置</);
  assert.match(settingsSource, /settings-target-grid/);
  assert.match(settingsSource, /settings-pressure-grid/);

  for (const label of ['外观', 'AI 与模型', '联网检索', '存储与缓存']) {
    assert.match(settingsSource, new RegExp(`<details[^>]*class="settings-disclosure[^"]*"[\\s\\S]*?>[\\s\\S]*?${label}`));
  }

  assert.doesNotMatch(settingsSource, /05 \/ WORKSPACE/);
  assert.doesNotMatch(settingsSource, /📊|🗂|🔊|📖|💡/u);
});

test('settings redesign preserves every interactive configuration contract', () => {
  for (const id of [
    'coverageSlider', 'coverageMin', 'coverageDisplay', 'coverageMax', 'coverageHint',
    'settingsApiKey', 'settingsBaseUrl', 'settingsModelPreset', 'settingsModelInput',
    'settingsWebResearchMode', 'webResearchModeStatus', 'settingsNativeTestBtn', 'deepSeekNativeStatus',
    'tavilyFields', 'settingsTavilyKey', 'tavilyKeyToggle', 'tavilyConnectionStatus',
    'titleTranslationCacheInfo', 'audioCacheInfo'
  ]) {
    assert.match(settingsSource, new RegExp(`id="${id}"`), `${id} must remain rendered`);
  }
  for (const name of ['targetTrack', 'readingMode', 'theme']) {
    assert.match(settingsSource, new RegExp(`name="${name}"`), `${name} control must remain rendered`);
  }
  assert.match(settingsSource, /name="homeLearningResponseMode"/);
  assert.match(settingsSource, /每次询问/);
  assert.match(settingsSource, /默认详细解析/);
  assert.match(settingsSource, /默认互动教学/);
  assert.match(settingsSource, /Config\.set\('home_learning_response_mode'/);
  assert.match(settingsSource, /SettingsView\.save\(\)/);
});

test('settings styles are compact, responsive, grouped and keep save reachable', () => {
  for (const selector of [
    '.app-shell--settings', '.settings-preference-overview', '.settings-preference-metrics',
    '.settings-study-panel', '.settings-target-grid', '.settings-pressure-grid',
    '.settings-disclosure', '.settings-disclosure-summary', '.settings-actions'
  ]) {
    assert.match(cssSource, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${selector} style is required`);
  }
  assert.match(cssSource, /\.settings-actions\s*\{[\s\S]*?position:\s*sticky/);
  assert.match(cssSource, /@media\s*\(max-width:\s*599px\)[\s\S]*?\.settings-preference-metrics/);
});
