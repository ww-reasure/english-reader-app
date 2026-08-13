import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const read = file => readFile(path.join(ROOT, file), 'utf8');

function buildFlashcardRuntime({ examplesDelayMs = 60 } = {}) {
  const source = `
const noop = () => {};
globalThis.window = globalThis;
const fakeEl = () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop }, setAttribute: noop, removeAttribute: noop, addEventListener: noop, removeEventListener: noop, querySelector: () => null, querySelectorAll: () => [], closest: () => null, textContent: '', getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }) });
globalThis.document = {
  body: fakeEl(),
  addEventListener: noop, removeEventListener: noop,
  querySelector: () => null, querySelectorAll: () => [],
  getElementById: () => null, createElement: fakeEl
};
const storage = new Map();
globalThis.localStorage = {
  get length() { return storage.size; },
  key: i => [...storage.keys()][i] ?? null,
  getItem: k => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k)
};
const sessionStore = new Map();
globalThis.sessionStorage = {
  getItem: k => (sessionStore.has(k) ? sessionStore.get(k) : null),
  setItem: (k, v) => sessionStore.set(k, String(v)),
  removeItem: k => sessionStore.delete(k)
};
globalThis.location = { hash: '' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.Audio = class { play(){} pause(){} };

const WORDS = [
  { id: 1, word: 'alpha', translation: '阿尔法', reviewRevision: 0, interval: 0 },
  { id: 2, word: 'beta', translation: '贝塔', reviewRevision: 0, interval: 0 }
];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const DB = {
  getAllLearnWords: async () => [],
  getAllWords: async () => [],
  findLearnWordById: async id => WORDS.find(word => word.id === id) || null,
  recordLearnWordPractice: async () => {},
  settleSessionReview: async (id, srs) => srs,
  updateLearnWordDefinition: async word => word,
  addReviewEvent: async () => {}
};
const SpacedRepetition = {
  getStatusDisplay: () => ({ label: '待复习', color: 'var(--state-review)', icon: 'x' }),
  getStatus: () => 'review',
  isStable: () => false,
  getDueCount: () => 0,
  getDueWords: () => [],
  getIntervalText: value => value ? String(value) + ' 天' : ''
};
const Dictionary = { lookup: async () => null };
const esc = value => String(value);
const Config = { get: () => '', hasApiKey: () => true };
const Modal = { showApiSettings: noop };
const API = {};
const ChatView = {};
const Examples = { getExamples: async () => { await delay(${examplesDelayMs}); return []; } };
const Affixes = {
  getAnalysis: async () => { await delay(${examplesDelayMs}); return null; },
  getRelatedWordDetails: () => [],
  enrichRelatedTranslations: async value => value,
  hasStructuredRoot: () => true,
  ensureStructuredRoot: async () => null
};
const Tooltip = { show: noop, hide: noop };
const AudioCache = { getAudio: async () => null, stop: noop };
const ExamCorpus = {
  getExamples: async () => { await delay(${examplesDelayMs}); return []; },
  lookupAll: async () => ({})
};
const normalizeTargetWords = words => words;
const createLexiconLoader = () => ({});
const createKnowledgeEvidenceBridge = () => ({ recordFlashcardRating: noop });
const requiresTargetTrackSelection = () => false;
const formatPhonetic = () => '';
const getDefinitionDisplayLines = word => (word && word.translation ? [{ label: '', glossZh: word.translation }] : []);
const getSavableTranslation = word => (word && word.translation) || '';
const ensureSavedWordDefinition = async word => word;
const ReviewQueue = {
  getDueWords: async () => [],
  revalidate: async () => ({ current: true, word: WORDS[0] })
};
const createSessionQueue = () => null;
const persistSessionQueue = async () => {};
const clearSessionQueue = async () => {};
const loadSessionQueue = async () => null;
const sessionDebtValue = () => 0;
const settleSessionReview = (word, quality) => ({ ...word });
const WordPhrases = {};
const WordSimilar = {};
const renderExamCorpusDetail = () => '';
const selectExamCorpusPresentation = () => null;
const WORD_STUDY_TABS = ['examples', 'root', 'phrases', 'similar', 'related'];
const isWordStudyTab = tab => WORD_STUDY_TABS.includes(tab);
const mergeWordStudyExamples = (left, right) => [...(left || []), ...(right || [])];
const normalizeWordStudyExample = example => example;
const renderWordStudyPanel = () => '<div class="panel"></div>';
const renderWordStudyTabs = () => '<nav></nav>';
const getFocusedWordStudyExamples = examples => examples || [];
const renderFocusedWordStudyExample = () => '<div class="example"></div>';
const getHorizontalSwipeDirection = () => null;
const renderWordStudyDefinitionLine = (line, className) => '<div class="' + className + '">' + esc(line?.glossZh || '') + '</div>';
`;
  return source;
}

async function loadRuntime({ examplesDelayMs } = {}) {
  const [flashcardSource, flowSource, practiceSource] = await Promise.all([
    read('src/views/flashcard.js'),
    read('src/flashcard-flow.mjs'),
    read('src/review-practice.mjs')
  ]);
  const stripped = flashcardSource.replace(/^import[\s\S]*?;\s*\r?\n/gm, '');
  const bundle = `${buildFlashcardRuntime({ examplesDelayMs })}
${flowSource.replace(/^export /gm, '')}
${practiceSource.replace(/^export /gm, '')}
${stripped}`;
  return import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}`);
}

function installPracticeSession(scope = 'today_added', wordIds = [1, 2]) {
  globalThis.sessionStorage.setItem('review-practice-session-v1', JSON.stringify({
    scope,
    wordIds,
    skipped: 0,
    createdAt: Date.now()
  }));
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('practice review completes on the last word without leaking a stale study render', async () => {
  const { FlashcardView } = await loadRuntime({ examplesDelayMs: 60 });
  const unhandled = [];
  const onUnhandled = error => unhandled.push(error && error.message);
  process.on('unhandledRejection', onUnhandled);

  try {
    installPracticeSession();
    const container = {
      innerHTML: '',
      querySelector: () => null,
      querySelectorAll: () => [],
      setAttribute: () => {},
      removeAttribute: () => {},
      addEventListener: () => {},
      removeEventListener: () => {}
    };

    await FlashcardView.render(container, 'today_added');
    assert.equal(FlashcardView.words.length, 2);

    // 第 1 个词：评分后立即推进（资料加载仍在飞行）
    await FlashcardView.submitRating(5);
    FlashcardView.advanceToNextWord();
    await wait(120);
    assert.equal(container.innerHTML.includes('flashcard-recall-stage'), true, '第 2 个词正常显示回忆卡');

    // 最后一个词：评分后立即点“下一词”，完成页必须出现
    await FlashcardView.submitRating(5);
    FlashcardView.advanceToNextWord();
    assert.equal(container.innerHTML.includes('专项练习完成'), true, '最后一个词点下一词后进入完成页');

    // 等飞行中的资料加载全部落定：不得用越界词渲染学习卡、不得抛出未处理拒绝
    await wait(150);
    assert.equal(container.innerHTML.includes('专项练习完成'), true, '完成页不被异步资料加载覆盖');
    assert.equal(container.innerHTML.includes('flashcard-study-pane'), false, '完成页之后不再回写学习卡');
    assert.deepEqual(unhandled, [], '无未处理拒绝');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('completion path invalidates in-flight async study loads via the session counter', async () => {
  const source = await read('src/views/flashcard.js');

  assert.match(source, /import \{ readPracticeSession, clearPracticeSession, markPracticeScopeDone \} from '..\/review-practice\.mjs';/);
  assert.match(source, /this\.cardSession\+\+;\s*\r?\n\s*this\.renderResult\(container\)/);
  assert.match(source, /if \(!word \|\| session !== this\.cardSession\) return;/);
});
