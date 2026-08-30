import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const sourceUrl = new URL('../src/components/ai-analysis.js', import.meta.url);

async function loadAIAnalysis(mocks) {
  const source = await readFile(sourceUrl, 'utf8');
  const imports = `
    const { Tooltip, API, Dictionary, esc, debounce, SentenceAnalysisCache, Config, Modal,
      ConversationStore, LearningAgent, ContextBuilder, ChatService, DB, SpacedRepetition,
    renderLearningMarkdown, createCopyButton, bindMessageCopy } = globalThis.__aiAnalysisMocks;
  `;
  const testSource = source
    .replace(/^import .+;\r?\n/gm, '')
    .replace('window.AIAnalysis = AIAnalysis;', '');

  globalThis.__aiAnalysisMocks = mocks;
  globalThis.window = globalThis.window || {};
  const moduleSource = imports + testSource + '\n// test module ' + Math.random();
  return import('data:text/javascript;base64,' + Buffer.from(moduleSource).toString('base64'));
}

function createTarget(name) {
  const listeners = new Map();
  return {
    name,
    nodeType: 1,
    parentElement: null,
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    async emit(type, event) {
      return listeners.get(type)?.(event);
    },
    hasListener(type) {
      return listeners.has(type);
    }
  };
}

function baseMocks(overrides = {}) {
  const calls = { lookup: [], show: [] };
  return {
    calls,
    mocks: {
      Tooltip: {
        isVisible: () => false,
        getWordAtPoint: () => 'practice',
        beginLookup: (x, y) => ({ x, y }),
        show: async (lookupId, x, y, data) => calls.show.push({ lookupId, x, y, data }),
        hide: () => {}
      },
      API: {},
      Dictionary: {
        lookup: async word => {
          calls.lookup.push(word);
          return { word, translation: '练习' };
        }
      },
      esc: value => String(value),
      debounce: fn => fn,
      SentenceAnalysisCache: class {},
      Config: { hasApiKey: () => true },
      Modal: { showApiSettings: () => {} },
      ConversationStore: class {
        getSession() { return { messages: [], summary: '' }; }
        append() {}
        compact() {}
      },
      LearningAgent: class {},
      ContextBuilder: class {},
      ChatService: class {},
      DB: {},
      SpacedRepetition: {},
      renderLearningMarkdown: value => String(value),
      createCopyButton: () => ({ addEventListener() {} }),
      bindMessageCopy: () => () => {},
      ...overrides
    }
  };
}

test('first analysis details support word lookup while follow-up bubbles remain inert', async () => {
  const { calls, mocks } = baseMocks();
  const { AIAnalysis } = await loadAIAnalysis(mocks);
  const original = createTarget('original');
  const detail = createTarget('detail');
  const followup = createTarget('followup');
  const modal = {
    querySelector: () => original,
    querySelectorAll(selector) {
      return selector === '.ai-lookup-sentence, .ai-result-content'
        ? [original, detail]
        : [original, detail, followup];
    }
  };

  AIAnalysis.bindWordLookup(modal);
  await detail.emit('click', { clientX: 14, clientY: 18, stopPropagation() {} });

  assert.equal(detail.hasListener('click'), true);
  assert.equal(followup.hasListener('click'), false);
  assert.deepEqual(calls.lookup, ['practice']);
  assert.equal(calls.show.length, 1);
});

test('a selected analysis excerpt suppresses word lookup until the selection is handled', async () => {
  const { calls, mocks } = baseMocks();
  const { AIAnalysis } = await loadAIAnalysis(mocks);
  const detail = createTarget('detail');
  const textNode = { nodeType: 3, parentElement: detail };
  detail.contains = node => node === detail || node?.parentElement === detail;
  globalThis.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
  globalThis.window.getSelection = () => ({
    rangeCount: 1,
    isCollapsed: false,
    toString: () => 'the imitation sentence',
    getRangeAt: () => ({ startContainer: textNode, endContainer: textNode })
  });
  const modal = {
    querySelectorAll: () => [detail],
    querySelector: () => detail
  };

  AIAnalysis.bindWordLookup(modal);
  await detail.emit('click', { clientX: 14, clientY: 18, stopPropagation() {} });

  assert.deepEqual(calls.lookup, []);
  assert.equal(calls.show.length, 0);
  assert.equal(detail.hasListener('click'), true);
});

test('analysis modal source wires selection into the existing follow-up panel and clears it on close', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(source, /bindDetailSelection\(modal/);
  assert.match(source, /openFollowUpPanel\(modal,\s*excerpt/);
  assert.match(source, /analysis,\s*selectedExcerpt\s*\}/);
  assert.match(source, /createAnalysisContextSnapshot\(\)/);
  assert.match(source, /bindFollowUp\(modal, sentence, content, analysisContext\)/);
  assert.match(source, /closeResultModal\(\)/);
  assert.match(source, /clearDetailSelection\(\)/);
});

test('analysis results reuse the shared copy module without copying the original sentence or follow-up UI', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(source, /message-actions\.mjs/);
  assert.match(source, /data-copyable/);
  assert.match(source, /data-copy-content/);
  assert.match(source, /data-chat-selectable="true"/);
  assert.match(source, /createCopyButton\(\{\s*label:\s*['"]复制分析['"]/);
  assert.match(source, /bindMessageCopy\(modal/);
});

test('the selected-detail follow-up action remains reachable near the bottom of a mobile viewport', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(source, /const buttonTop = rect\.bottom \+ 8 > window\.innerHeight - 48/);
  assert.match(source, /button\.style\.top = buttonTop \+ 'px';/);
});

test('a late sentence analysis result cannot overwrite the current analysis request', async () => {
  const { mocks } = baseMocks();
  const { AIAnalysis } = await loadAIAnalysis(mocks);
  const resolvers = new Map();
  const renders = [];
  AIAnalysis.hideButton = () => {};
  AIAnalysis.showResult = (...args) => renders.push(args);
  AIAnalysis.analysisCache = {
    get: () => undefined,
    getOrCreate: sentence => new Promise(resolve => resolvers.set(sentence, resolve))
  };

  const first = AIAnalysis.analyze('First sentence.');
  const second = AIAnalysis.analyze('Second sentence.');
  resolvers.get('Second sentence.')('new result');
  await second;
  resolvers.get('First sentence.')('old result');
  await first;

  assert.equal(renders.some(([, content]) => content === 'old result'), false);
  assert.equal(renders.at(-1)[1], 'new result');
});
