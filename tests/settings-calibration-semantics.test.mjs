import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SETTINGS_URL = new URL('../src/views/settings.js', import.meta.url);

function dataModule(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

function createConfigModule(values) {
  return dataModule(`
    const values = ${JSON.stringify(values)};
    export const Config = { get: (key) => values[key] ?? '' };
  `);
}

function createSettingsDependencies(values) {
  return {
    config: createConfigModule(values),
    theme: dataModule('export const Theme = { apply() {} };'),
    audio: dataModule('export const AudioCache = { getCacheSize: async () => ({ count: 0, estimatedMB: 0 }), clearCache: async () => true };'),
    helpers: dataModule('export const esc = (value) => String(value ?? "");'),
    tracks: dataModule(`
      export const listSelectableTracks = () => [{ id: 'cet4', label: '四级', description: '四级导向阅读' }];
      export const normalizeSelectableTrack = (track) => track === 'cet4' ? track : null;
    `),
    profile: dataModule(`
      export const CHALLENGE_DETAILS = {
        support: { label: '巩固' }, standard: { label: '对标' }, stretch: { label: '加压' }
      };
      export const normalizeCoveragePreference = (mode, value) => {
        const ranges = { support: { min: 97, max: 98 }, standard: { min: 95, max: 97 }, stretch: { min: 92, max: 95 } };
        const range = ranges[mode] || ranges.standard;
        const coverage = Math.max(range.min, Math.min(range.max, Number(value) || range.min));
        return { challenge: mode, range, coverage };
      };
    `)
  };
}

async function renderSettings(values) {
  const source = await readFile(SETTINGS_URL, 'utf8');
  const dependencies = createSettingsDependencies(values);
  const adapted = source
    .replace("from '../config.js'", `from '${dependencies.config}'`)
    .replace("from '../theme.js'", `from '${dependencies.theme}'`)
    .replace("from '../audio-cache.js'", `from '${dependencies.audio}'`)
    .replace("from '../helpers.js'", `from '${dependencies.helpers}'`)
    .replace("from '../learning-track.mjs'", `from '${dependencies.tracks}'`)
    .replace("from '../difficulty-profile.mjs'", `from '${dependencies.profile}'`);

  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  globalThis.window = {};
  globalThis.document = {
    querySelectorAll: () => [],
    getElementById: () => null
  };

  try {
    const { SettingsView } = await import(dataModule(adapted));
    const container = { innerHTML: '' };
    SettingsView.render(container);
    return container.innerHTML;
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
}

function baseValues(overrides = {}) {
  return {
    theme: 'light',
    exam_level: 'cet4',
    reading_mode: 'standard',
    coverage: '96',
    calibration_status: 'new',
    assessment_done: 'false',
    assessment_date: '',
    api_key: '',
    base_url: '',
    model: '',
    ...overrides
  };
}

test('does not present legacy assessment_done data as calibrated coverage evidence', async () => {
  const html = await renderSettings(baseValues({
    calibration_status: 'legacy',
    assessment_done: 'true'
  }));

  assert.match(html, /历史测评记录/);
  assert.match(html, /旧版测评/);
  assert.doesNotMatch(html, /预计掌握覆盖/);
  assert.doesNotMatch(html, /已校准/);
});

test('does not let a stale assessment_done flag override a new calibration status', async () => {
  const html = await renderSettings(baseValues({
    calibration_status: 'new',
    assessment_done: 'true'
  }));

  assert.match(html, /历史测评记录/);
  assert.doesNotMatch(html, /预计掌握覆盖/);
  assert.doesNotMatch(html, /已校准/);
});

test('presents a completed current calibration as a recommendation while evidence is still collecting', async () => {
  const html = await renderSettings(baseValues({
    calibration_status: 'calibrated',
    assessment_done: 'true'
  }));

  assert.match(html, /初测后的材料建议/);
  assert.match(html, /当前推荐：<strong>对标<\/strong>/);
  assert.match(html, /证据收集中，暂不承诺实际覆盖。/);
  assert.doesNotMatch(html, /预计掌握覆盖/);
  assert.doesNotMatch(html, /已校准/);
});

test('labels the coverage control as a material target rather than learner mastery', async () => {
  const html = await renderSettings(baseValues());

  assert.match(html, /材料目标覆盖率/);
  assert.match(html, /用于设定生成材料的词汇压力/);
  assert.doesNotMatch(html, /预计已掌握词/);
  assert.doesNotMatch(html, /预计掌握覆盖/);
});

test('does not preselect CET-4 while a legacy graduate target requires an explicit new choice', async () => {
  const html = await renderSettings(baseValues({
    exam_level: 'graduate',
    target_track_selection_required: 'true'
  }));

  assert.match(html, /选择新的考研目标/);
  assert.doesNotMatch(html, /name="targetTrack" value="cet4" checked/);
  assert.doesNotMatch(html, /name="targetTrack" value="cet6" checked/);
  assert.doesNotMatch(html, /name="targetTrack" value="kaoyan1" checked/);
  assert.doesNotMatch(html, /name="targetTrack" value="kaoyan2" checked/);
});

test('states that target-track direction does not ship or treat unlicensed past papers as a word list', async () => {
  const html = await renderSettings(baseValues());

  assert.match(html, /不使用未授权历年题干或“真题词表”/);
  assert.match(html, /目标考试导向/);
});

test('describes the initial check as 24 stratified adaptive word-meaning questions', async () => {
  const html = await renderSettings(baseValues());

  assert.match(html, /24 道分层自适应词义题/);
});

test('makes the installed lexicon, local learning records, and exam-baseline limit visible', async () => {
  const html = await renderSettings(baseValues());

  assert.match(html, /离线词库与难度来源/);
  assert.match(html, /随 APK 安装/);
  assert.match(html, /IndexedDB/);
  assert.match(html, /NGSL/);
  assert.match(html, /NAWL/);
  assert.match(html, /CEFR-J/);
  assert.match(html, /Open English WordNet/);
  assert.match(html, /oewn-artifact-manifest\.json/);
  assert.match(html, /目标考试导向/);
  assert.match(html, /不把生成材料表述为真题等值/);
});
