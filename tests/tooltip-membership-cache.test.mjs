import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadTooltip(mocks) {
  const source = await readFile(new URL('../src/components/tooltip.js', import.meta.url), 'utf8');
  const dependencies = `
    const { DB, Config, getStemForm, esc, AudioCache, TooltipSession,
      formatPartOfSpeech, formatPhonetic, getDefinitionPreview, getDefinitionSenses,
      getSavableTranslation, DEFINITION_SCHEMA_VERSION, renderTooltipWordBadges,
      WordStudyDetail, WordStudyDetailCache, getRangeAtPoint } = globalThis.__tooltipMembershipMocks;
  `;
  const body = source.replace(/^import .+;\r?\n/gm, '').replace('window.Tooltip = Tooltip;', '');
  globalThis.__tooltipMembershipMocks = mocks;
  globalThis.window = {};
  return import(`data:text/javascript;base64,${Buffer.from(dependencies + body + `\n// ${Math.random()}`).toString('base64')}`);
}

function iterableRows(rows, onIterate) {
  return {
    [Symbol.iterator]() {
      onIterate();
      return rows[Symbol.iterator]();
    }
  };
}

test('tooltip membership reuses a revision index and never scans getAllWords per lookup', async () => {
  let revision = 3;
  let iterations = 0;
  let getAllCalls = 0;
  let rows = [{ word: 'derive' }, { word: 'retain' }];
  const mocks = {
    DB: {
      getAllWords: async () => { getAllCalls += 1; return []; },
      getUnifiedVocabularySnapshot: async () => ({
        revision,
        data: iterableRows(rows, () => { iterations += 1; })
      })
    },
    Config: { get: () => '' },
    getStemForm: value => String(value || '').trim().toLowerCase(),
    esc: value => String(value),
    AudioCache: {},
    TooltipSession: class { begin() { return 1; } isCurrent() { return true; } dismiss() {} },
    formatPartOfSpeech: value => value,
    formatPhonetic: value => value,
    getDefinitionPreview: () => ({ visibleLines: [], additionalLines: [], total: 0 }),
    getDefinitionSenses: () => [],
    getSavableTranslation: () => '',
    DEFINITION_SCHEMA_VERSION: 1,
    renderTooltipWordBadges: () => '',
    WordStudyDetail: { open() {} },
    WordStudyDetailCache: { prefetch: async () => null },
    getRangeAtPoint: () => null
  };
  const { Tooltip } = await loadTooltip(mocks);

  assert.equal(await Tooltip.isWordSaved('derive'), true);
  assert.equal(await Tooltip.isWordSaved('retain'), true);
  assert.equal(iterations, 1, 'one revision builds the membership index once');
  assert.equal(getAllCalls, 0, 'point lookup must not trigger a full vocabulary scan');

  revision = 4;
  rows = [{ word: 'practice' }];
  assert.equal(await Tooltip.isWordSaved('practice'), true);
  assert.equal(await Tooltip.isWordSaved('derive'), false);
  assert.equal(iterations, 2, 'a new revision replaces the index exactly once');
  assert.equal(getAllCalls, 0);
});

test('compact tooltip shows one immediate meaning and keeps the remaining senses behind expansion', async () => {
  const tooltipElement = {
    innerHTML: '',
    style: {},
    getBoundingClientRect: () => ({ width: 280, height: 220 }),
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const definitions = [
    { label: 'v.', glossZh: '练习' },
    { label: 'n.', glossZh: '实践' },
    { label: 'adj.', glossZh: '惯常的' },
    { label: 'n.', glossZh: '惯例' }
  ];
  const mocks = {
    DB: {},
    Config: { get: () => '' },
    getStemForm: value => String(value || '').toLowerCase(),
    esc: value => String(value),
    AudioCache: {},
    TooltipSession: class { begin() { return 9; } isCurrent() { return true; } dismiss() {} },
    formatPartOfSpeech: value => value,
    formatPhonetic: value => value,
    getDefinitionPreview: () => ({ visibleLines: definitions.slice(0, 3), additionalLines: definitions.slice(3), total: 4 }),
    getDefinitionSenses: () => definitions,
    getSavableTranslation: () => '练习',
    DEFINITION_SCHEMA_VERSION: 1,
    renderTooltipWordBadges: () => '',
    WordStudyDetail: { open() {} },
    WordStudyDetailCache: { prefetch: async () => null },
    getRangeAtPoint: () => null
  };
  globalThis.document = {
    getElementById: () => tooltipElement,
    querySelector: () => null,
    createRange: () => ({})
  };
  globalThis.window = { innerWidth: 400, innerHeight: 800 };
  const { Tooltip } = await loadTooltip(mocks);
  Tooltip.isWordSaved = async () => true;

  const lookupId = Tooltip.beginLookup(20, 30);
  await Tooltip.show(lookupId, 20, 30, {
    word: 'practice',
    phonetic: '/ˈpræktɪs/',
    found: true
  }, false, { density: 'compact' });

  const immediateDefinitions = tooltipElement.innerHTML.match(/class="tooltip-translation definition-line"/g) || [];
  assert.equal(immediateDefinitions.length, 1);
  assert.match(tooltipElement.innerHTML, /展开更多释义（4）/);
  assert.match(tooltipElement.innerHTML, /data-tooltip-density="compact"/);
});

test('tooltip error card exposes a retry button without invoking it automatically', async () => {
  const listeners = new Map();
  const retryButton = {
    addEventListener(type, handler) { listeners.set(`retry:${type}`, handler); }
  };
  const closeButton = {
    addEventListener(type, handler) { listeners.set(`close:${type}`, handler); }
  };
  const tooltipElement = {
    innerHTML: '',
    style: {},
    getBoundingClientRect: () => ({ width: 280, height: 90 }),
    querySelector(selector) {
      if (selector === '.tooltip-retry') return retryButton;
      if (selector === '.tooltip-close') return closeButton;
      return null;
    }
  };
  const mocks = {
    DB: {},
    Config: { get: () => '' },
    getStemForm: value => value,
    esc: value => String(value),
    AudioCache: {},
    TooltipSession: class { begin() { return 5; } isCurrent() { return true; } dismiss() {} },
    formatPartOfSpeech: value => value,
    formatPhonetic: value => value,
    getDefinitionPreview: () => ({ visibleLines: [], additionalLines: [], total: 0 }),
    getDefinitionSenses: () => [],
    getSavableTranslation: () => '',
    DEFINITION_SCHEMA_VERSION: 1,
    renderTooltipWordBadges: () => '',
    WordStudyDetail: { open() {} },
    WordStudyDetailCache: { prefetch: async () => null },
    getRangeAtPoint: () => null
  };
  globalThis.document = { getElementById: () => tooltipElement };
  globalThis.window = { innerWidth: 400, innerHeight: 800 };
  const { Tooltip } = await loadTooltip(mocks);
  let retryCount = 0;

  Tooltip.showError(5, 20, 30, '网络不可用', () => { retryCount += 1; });

  assert.match(tooltipElement.innerHTML, /class="tooltip-retry"/);
  assert.equal(retryCount, 0, 'an error must never trigger an automatic fallback');
  listeners.get('retry:click')({ preventDefault() {}, stopPropagation() {} });
  assert.equal(retryCount, 1);
});
