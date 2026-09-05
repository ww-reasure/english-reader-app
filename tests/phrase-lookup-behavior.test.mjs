import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

// 行为级验证 bindLearningTextLookup 的词组优先分支：
// 命中词组 → showPhrase（带等级）且不走单词查词；解析为空 → 回落单词查词；
// 解析期间用户再次点击（代数推进）→ 迟到的词组卡被丢弃。

async function loadLookupModule() {
  const source = await readFile(new URL('../src/components/reading-word-lookup.js', import.meta.url), 'utf8');
  const dependencies = `
    const { Tooltip, ContextualSense, getDefinitionSenses, Dictionary, getContextSentenceAtPoint, bindSentenceLongPress } = globalThis.__phraseLookupMocks;
  `;
  const body = source
    .replace(/^import .+;\r?\n/gm, '')
    .replace(/^export \{.+;\r?\n/gm, '');
  return import(`data:text/javascript;base64,${Buffer.from(dependencies + body + `\n// ${Math.random()}`).toString('base64')}`);
}

function createRoot() {
  const listeners = new Map();
  return {
    addEventListener(type, handler, options) {
      const entries = listeners.get(type) || [];
      entries.push({ handler, capture: options === true || options?.capture === true });
      listeners.set(type, entries);
    },
    removeEventListener(type, handler) {
      listeners.set(type, (listeners.get(type) || []).filter(entry => entry.handler !== handler));
    },
    contains(target) {
      return Boolean(target?.inside);
    },
    async emit(type, event) {
      const entries = [...(listeners.get(type) || [])].sort((left, right) => Number(right.capture) - Number(left.capture));
      for (const entry of entries) {
        await entry.handler(event);
        if (event.immediateStopped) break;
      }
    }
  };
}

function createPhraseSpan(phraseId) {
  const surface = { inside: true };
  const target = {
    inside: true,
    nodeType: 1,
    dataset: { keyPhraseId: phraseId },
    closest(selector) {
      if (selector === '[data-key-phrase-id]') return target;
      if (selector === '[data-learning-text="click"]') return surface;
      return null;
    }
  };
  return target;
}

function createEnvironment({ phraseData, dictionaryCalls = [] }) {
  const showPhraseCalls = [];
  const tooltip = {
    calls: { showPhrase: showPhraseCalls, show: [], beginLookup: [] },
    beginLookup: (x, y) => {
      tooltip.calls.beginLookup.push({ x, y });
      return tooltip.calls.beginLookup.length;
    },
    isCurrent: () => true,
    isVisible: () => false,
    hide: () => {},
    contains: () => false,
    showError: () => true,
    show: async (...args) => {
      tooltip.calls.show.push(args);
      return true;
    },
    showPhrase: (lookupId, x, y, data) => {
      showPhraseCalls.push({ lookupId, x, y, data });
      return true;
    },
    getWordAtPoint: () => 'deal',
    attachAutoDismiss: () => () => {}
  };
  const dictionary = { lookup: async word => { dictionaryCalls.push(word); return { word, found: true }; } };
  globalThis.__phraseLookupMocks = {
    Tooltip: tooltip,
    ContextualSense: { resolve: async () => null },
    getDefinitionSenses: () => [],
    Dictionary: dictionary,
    getContextSentenceAtPoint: () => '',
    bindSentenceLongPress: () => () => {}
  };
  globalThis.window = { getSelection: () => ({ isCollapsed: true }) };
  globalThis.document = { addEventListener: () => {}, removeEventListener: () => {} };
  return { tooltip, dictionaryCalls, showPhraseCalls };
}

const baseEvent = target => ({
  type: 'click',
  target,
  clientX: 10,
  clientY: 10,
  stopPropagation() {}
});

test('clicking a key phrase shows the phrase card and skips single-word lookup', async () => {
  const { dictionaryCalls, showPhraseCalls } = createEnvironment({});
  const { bindLearningTextLookup } = await loadLookupModule();
  const root = createRoot();
  const cleanup = bindLearningTextLookup({
    root,
    tooltip: globalThis.__phraseLookupMocks.Tooltip,
    resolveKeyPhrase: async () => ({ phrase: 'deal with', glossZh: '处理', tracks: ['cet4', 'kaoyan'] })
  });
  const span = createPhraseSpan('deal with');
  await root.emit('click', baseEvent(span));
  assert.equal(showPhraseCalls.length, 1);
  assert.deepEqual(showPhraseCalls[0].data, { phrase: 'deal with', glossZh: '处理', tracks: ['cet4', 'kaoyan'] });
  assert.deepEqual(dictionaryCalls, [], 'single-word dictionary must not be consulted');
  cleanup();
});

test('an unresolvable phrase falls back to single-word lookup', async () => {
  const { dictionaryCalls, showPhraseCalls } = createEnvironment({});
  const { bindLearningTextLookup } = await loadLookupModule();
  const root = createRoot();
  const cleanup = bindLearningTextLookup({
    root,
    tooltip: globalThis.__phraseLookupMocks.Tooltip,
    resolveKeyPhrase: async () => null
  });
  const span = createPhraseSpan('not in pack');
  await root.emit('click', baseEvent(span));
  assert.deepEqual(showPhraseCalls, []);
  assert.deepEqual(dictionaryCalls, ['deal']);
  cleanup();
});

test('a late phrase resolution is discarded once the user clicked again', async () => {
  const { showPhraseCalls } = createEnvironment({});
  const { bindLearningTextLookup } = await loadLookupModule();
  const root = createRoot();
  let releaseFirst;
  let call = 0;
  const cleanup = bindLearningTextLookup({
    root,
    tooltip: globalThis.__phraseLookupMocks.Tooltip,
    resolveKeyPhrase: () => {
      call += 1;
      if (call === 1) {
        return new Promise(resolve => { releaseFirst = () => resolve({ phrase: 'slow first', glossZh: '', tracks: [] }); });
      }
      return Promise.resolve({ phrase: 'second phrase', glossZh: '', tracks: [] });
    }
  });
  const first = root.emit('click', baseEvent(createPhraseSpan('slow phrase')));
  await root.emit('click', baseEvent(createPhraseSpan('second phrase')));
  releaseFirst();
  await first;
  assert.equal(showPhraseCalls.length, 1);
  assert.equal(showPhraseCalls[0].data.phrase, 'second phrase');
  cleanup();
});

test('a rejecting resolveKeyPhrase falls back to word lookup instead of throwing', async () => {
  const { dictionaryCalls, showPhraseCalls } = createEnvironment({});
  const { bindLearningTextLookup } = await loadLookupModule();
  const root = createRoot();
  const cleanup = bindLearningTextLookup({
    root,
    tooltip: globalThis.__phraseLookupMocks.Tooltip,
    resolveKeyPhrase: async () => { throw new Error('pack broken'); }
  });
  await root.emit('click', baseEvent(createPhraseSpan('deal with')));
  assert.deepEqual(showPhraseCalls, []);
  assert.deepEqual(dictionaryCalls, ['deal']);
  cleanup();
});
