/**
 * Flashcard View
 * Spaced repetition review mode using SM-2 algorithm
 * Uses learnWords table with SRS scheduling
 *
 * Flow:
 *   Card front (word only)
 *   ├── Click "认识" → next word (quality 5, knew without seeing translation)
 *   ├── Click "模糊" → auto-flip → show "下一词" (quality 3)
 *   ├── Click "忘了" → auto-flip → show "下一词" (quality 1)
 *   └── Click card to flip → "认识" disabled → must pick 模糊/忘了
 */

import { DB } from '../db.js';
import { SpacedRepetition } from '../spaced-repetition.js';
import { Dictionary } from '../dictionary.js';
import { esc } from '../helpers.js';
import { Config } from '../config.js';
import { Modal } from '../components/modal.js';
import { API } from '../api.js';
import { ChatView } from './chat.js';
import { Examples } from '../examples.js';
import { Affixes } from '../affixes.js';
import { Tooltip } from '../components/tooltip.js';
import { AudioCache } from '../audio-cache.js';
import { ExamCorpus } from '../exam-corpus-runtime.mjs';
import { normalizeTargetWords } from '../components/article-generation-tool.js';
import { createLexiconLoader } from '../lexicon-runtime.mjs';
import { createKnowledgeEvidenceBridge } from '../components/knowledge-evidence-bridge.mjs';
import { requiresTargetTrackSelection } from '../learning-track.mjs';
import { formatPhonetic, getDefinitionDisplayLines, getSavableTranslation } from '../components/definition-trust.mjs';
import { ensureSavedWordDefinition } from '../components/saved-word-definition.mjs';
import { ReviewQueue } from '../review-queue.js';
import { readPracticeSession } from '../review-practice.mjs';
import {
  createSessionQueue,
  persistSessionQueue,
  clearSessionQueue,
  loadSessionQueue,
  sessionDebtValue
} from '../review-session.mjs';
import { settleSessionReview } from '../recovery-scheduler.mjs';
import { WordPhrases } from '../components/word-phrases.js';
import { WordSimilar } from '../components/word-similar.js';
import { renderExamCorpusDetail, selectExamCorpusPresentation } from '../components/exam-corpus-presentation.mjs';
import {
  WORD_STUDY_TABS,
  isWordStudyTab,
  mergeWordStudyExamples,
  normalizeWordStudyExample,
  renderWordStudyPanel,
  renderWordStudyTabs
} from '../components/word-study-materials.mjs';
import {
  getFocusedWordStudyExamples,
  getHorizontalSwipeDirection,
  renderFocusedWordStudyExample,
  renderWordStudyDefinitionLine
} from '../components/word-study-stage.mjs';
import {
  REVIEW_PHASES,
  createReviewState,
  revealMeaning,
  startRating,
  finishRating,
  canCorrectKnownRating,
  startRatingCorrection,
  finishRatingCorrection,
  skipWord,
  nextWord
} from '../flashcard-flow.mjs';

const knowledgeEvidenceBridge = createKnowledgeEvidenceBridge({
  lexiconLoader: createLexiconLoader(),
  storage: DB
});

export const FlashcardView = {
  words: [],
  currentIndex: 0,
  ratingCounts: { 1: 0, 3: 0, 5: 0 },
  reviewedWords: [],       // Current session
  reviewState: createReviewState(),
  studyTab: 'examples',
  studyExampleIndex: 0,
  studyExamplesExpanded: false,
  studyDetails: { examples: [], rootAnalysis: null, examPresentation: null, loading: false, phrases: { status: 'idle', items: [] }, similar: { status: 'idle', items: [] } },
  cardSession: 0,
  container: null,
  currentTranslation: '',
  currentPhonetic: '',
  currentDefinitionLines: [],
  ratingAttempt: null,
  pendingKnowledgeEvidence: null,
  practiceScope: '',
  sessionQueue: null,
  studyNotice: '',
  _exampleLookupRoot: null,
  _exampleLookupHandler: null,
  _exampleLookupGlobalHandler: null,
  _exampleTooltipDismissCleanup: null,
  _studyInfoKeyHandler: null,
  _studyExampleTouchStartX: null,
  _studyExampleTouchStartY: null,
  _studyExampleKeyHandler: null,
  _cardPronunciationController: null,
  _phraseController: null,
  _similarController: null,
  _rootController: null,

  // Today's reviewed words (persisted across sessions)
  TODAY_KEY: 'todayReviewedWords',

  getTodayKey() {
    // Use local timezone (not UTC) so day resets at midnight local time
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },

  loadTodayWords() {
    try {
      const data = JSON.parse(localStorage.getItem(this.TODAY_KEY));
      if (data && data.date === this.getTodayKey()) return data.words;
    } catch {}
    return [];
  },

  saveTodayWords(words) {
    localStorage.setItem(this.TODAY_KEY, JSON.stringify({
      date: this.getTodayKey(),
      words
    }));
  },

  addTodayWord(wordData) {
    const today = this.loadTodayWords();
    const idx = today.findIndex(w => w.word === wordData.word);
    if (idx === -1) {
      today.push(wordData);
    } else {
      // 同词再次评分: 用最新 quality 覆盖(否则巩固词集会用陈旧评分)
      today[idx] = { ...today[idx], ...wordData };
    }
    this.saveTodayWords(today);
  },

  // Render flashcard view
  async render(container, requestedScope = '') {
    this.cleanupExampleWordLookup();
    this.container = container;
    this.practiceScope = '';
    const session = requestedScope ? readPracticeSession() : null;
    let practiceWords = null;
    if (session && session.scope === requestedScope) {
      practiceWords = [];
      for (const wordId of session.wordIds) {
        const word = await DB.findLearnWordById(wordId);
        if (word) practiceWords.push({ ...word, expectedRevision: Math.max(0, Number(word.reviewRevision) || 0) });
      }
    }
    const allWords = practiceWords ?? await DB.getAllLearnWords();
    const dueWords = practiceWords ?? await ReviewQueue.getDueWords();

    if (dueWords.length === 0) {
      const totalWords = allWords.length;
      const masteredCount = allWords.filter(w => SpacedRepetition.getStatus(w) === 'stable').length;
      container.innerHTML = `
        <section class="app-standard-page flashcard-review-shell flashcard-review-shell--empty" aria-labelledby="flashcardContentTitle">
          <div class="flashcard-container flashcard-content" data-flashcard-content="empty">
          <h2 id="flashcardContentTitle" class="sr-only">单词复习内容</h2>
          <div class="empty-state flashcard-empty-sheet">
            <p>${requestedScope && !session ? '这些词还没有进入学习词库，无法专项复习。' : '🎉 暂时没有需要复习的单词'}</p>
            ${totalWords > 0 ? `<p>共 ${totalWords} 个单词，${masteredCount} 个进入长期巩固</p>` : ''}
            <p>去阅读页面收藏新单词，或导入单词到学习词库。</p>
            <div style="display:flex;gap:12px;justify-content:center;margin-top:16px">
              <a href="${requestedScope && !session ? '#/vocab' : '#/chat'}" class="btn btn-primary">${requestedScope && !session ? '返回生词本' : '去阅读'}</a>
              <a href="#/learn-words" class="btn btn-outline">学习词库</a>
            </div>
          </div>
          </div>
        </section>`;
      return;
    }

    this.practiceScope = practiceWords ? session.scope : '';
    if (this.practiceScope) {
      this.sessionQueue = null;
    } else {
      const restored = await loadSessionQueue({ db: DB });
      if (restored && !restored.isEmpty()) {
        this.sessionQueue = restored;
      } else {
        if (restored) await clearSessionQueue({ db: DB });
        this.sessionQueue = createSessionQueue(dueWords.map(word => word.id));
        await this.persistCurrentSession();
      }
    }
    this.words = dueWords;
    this.currentIndex = 0;
    this.ratingCounts = { 1: 0, 3: 0, 5: 0 };
    this.reviewedWords = [];

    this.renderCard(container);
  },

  // Check how many words are due
  async getDueCount() {
    const allWords = await DB.getAllLearnWords();
    return SpacedRepetition.getDueCount(allWords);
  },

  async persistCurrentSession() {
    if (this.sessionQueue) await persistSessionQueue(this.sessionQueue, { db: DB });
  },

  // Render a single word at the start of its recall phase.
  async renderCard(container) {
    this.cleanupExampleWordLookup();
    this.cancelCardPronunciation();
    if (!this.practiceScope && this.sessionQueue) {
      if (this.sessionQueue.isEmpty()) {
        this.renderResult(container);
        return;
      }
      const wordId = this.sessionQueue.next();
      await this.persistCurrentSession();
      const queuedWord = await DB.findLearnWordById(wordId);
      if (!queuedWord) {
        return this.renderCard(container);
      }
      const queuedRevision = Math.max(0, Number(queuedWord.reviewRevision) || 0);
      const bufferRevision = this.sessionQueue.getExpectedRevision(wordId);
      this.words[this.currentIndex] = { ...queuedWord, expectedRevision: bufferRevision ?? queuedRevision };
      this.sessionQueue.syncExpectedRevision(wordId, this.words[this.currentIndex].expectedRevision);
    } else if (this.currentIndex >= this.words.length) {
      this.renderResult(container);
      return;
    }

    const session = ++this.cardSession;
    let word = this.words[this.currentIndex];
    if (!this.practiceScope) {
      const revisionCheck = await ReviewQueue.revalidate({ id: word.id, expectedRevision: word.expectedRevision });
      if (!revisionCheck.current) {
        this.currentIndex++;
        return this.renderCard(container);
      }
      word = { ...revisionCheck.word, expectedRevision: word.expectedRevision };
      this.words[this.currentIndex] = word;
    }
    this.reviewState = createReviewState();
    this.studyTab = 'examples';
    this.studyExampleIndex = 0;
    this.studyExamplesExpanded = false;
    this.cancelPhraseRequest();
    this.cancelSimilarRequest();
    this.cancelRootRequest();
    this.studyDetails = { examples: [], rootAnalysis: null, examPresentation: null, loading: false, phrases: { status: 'idle', items: [] }, similar: { status: 'idle', items: [] } };
    this.reviewNotice = '';
    this.studyNotice = '';
    this.ratingAttempt = null;
    this.pendingKnowledgeEvidence = null;

    word = await ensureSavedWordDefinition(word, {
      lookup: Dictionary.lookup.bind(Dictionary),
      update: DB.updateLearnWordDefinition.bind(DB)
    });
    this.words[this.currentIndex] = word;
    const definitionLines = getDefinitionDisplayLines(word);
    const translation = definitionLines[0]?.glossZh || getSavableTranslation(word) || '暂无翻译';
    const phonetic = formatPhonetic(word.phonetic);

    if (session !== this.cardSession) return;
    this.currentTranslation = translation;
    this.currentPhonetic = phonetic;
    this.currentDefinitionLines = definitionLines;
    this.renderRecall(container);
    this.startCardPronunciation(word.word, session);
  },

  cancelCardPronunciation() {
    this._cardPronunciationController?.abort();
    this._cardPronunciationController = null;
    AudioCache.stop();
  },

  startCardPronunciation(word, session) {
    const controller = new AbortController();
    this._cardPronunciationController = controller;
    void AudioCache.getAudio(word, { signal: controller.signal, silent: true })
      .catch(() => {})
      .finally(() => {
        if (this._cardPronunciationController === controller && session === this.cardSession) {
          this._cardPronunciationController = null;
        }
      });
  },

  renderProgress(phase) {
    const word = this.words[this.currentIndex];
    const statusInfo = SpacedRepetition.getStatusDisplay(word);
    const progress = Math.round((this.currentIndex / this.words.length) * 100);
    return `
      <div class="flashcard-progress-block">
      <div class="flashcard-progress">
        <span class="page-eyebrow">03 / ${phase}</span>
        <span class="flashcard-progress-count">${this.currentIndex + 1} / ${this.words.length}</span>
        <span class="flashcard-status-badge" style="--status-color:${statusInfo.color}">${statusInfo.icon} ${statusInfo.label}</span>
      </div>
      <div class="flashcard-progress-bar" aria-hidden="true">
        <div class="flashcard-progress-fill" style="width:${progress}%"></div>
      </div>
      </div>`;
  },

  renderRecall(container) {
    this.cleanupExampleWordLookup();
    const word = this.words[this.currentIndex];
    const { meaningRevealed, isSubmitting } = this.reviewState;
    const knownDisabled = meaningRevealed || isSubmitting;
    const submitLabel = isSubmitting ? '保存中…' : '';

    container.innerHTML = `
      <main class="app-standard-page flashcard-review-shell flashcard-review-shell--recall" aria-labelledby="flashcardContentTitle">
        <div class="flashcard-container flashcard-content" data-flashcard-content="recall">
          <h2 id="flashcardContentTitle" class="sr-only">单词回忆评分</h2>
          ${this.renderProgress('RECALL')}
          <section class="flashcard flashcard-recall-card flashcard-recall-stage" aria-live="polite">
            <div class="flashcard-front">
              <div class="flashcard-word">${esc(word.word)}</div>
              ${this.currentPhonetic ? `<div class="flashcard-phonetic">${esc(this.currentPhonetic)}</div>` : ''}
              ${meaningRevealed
                ? (this.currentDefinitionLines[0]
                    ? `${renderWordStudyDefinitionLine(this.currentDefinitionLines[0], 'flashcard-recall-meaning')}<p class="flashcard-hint">已查看释义，请按真实回忆选择“模糊”或“忘了”</p>`
                    : `<div class="flashcard-recall-meaning">${esc(this.currentTranslation)}</div><p class="flashcard-hint">已查看释义，请按真实回忆选择“模糊”或“忘了”</p>`)
                : `<button class="flashcard-reveal-btn" type="button" onclick="FlashcardView.showMeaning()">点击查看释义</button>`}
            </div>
          </section>
          ${this.reviewNotice ? `<p class="flashcard-review-notice" role="alert">${esc(this.reviewNotice)}</p>` : ''}
          <div class="flashcard-actions flashcard-rating-group" aria-label="回忆评分">
            <button class="flashcard-rating-btn flashcard-btn-knew" type="button" ${knownDisabled ? 'disabled' : ''}
              onclick="FlashcardView.submitRating(5)" title="未查看释义就认识"><i class="fa-regular fa-face-smile flashcard-rating-icon" aria-hidden="true"></i><span>${submitLabel || '认识'}</span></button>
            <button class="flashcard-rating-btn flashcard-btn-fuzzy" type="button" ${isSubmitting ? 'disabled' : ''}
              onclick="FlashcardView.submitRating(3)" title="记得不够确定"><i class="fa-regular fa-face-meh flashcard-rating-icon" aria-hidden="true"></i><span>${submitLabel || '模糊'}</span></button>
            <button class="flashcard-rating-btn flashcard-btn-forgot" type="button" ${isSubmitting ? 'disabled' : ''}
              onclick="FlashcardView.submitRating(1)" title="没有回忆起来"><i class="fa-regular fa-face-frown flashcard-rating-icon" aria-hidden="true"></i><span>${submitLabel || '忘了'}</span></button>
          </div>
          <div class="flashcard-skip">
            <button class="flashcard-skip-btn" type="button" ${isSubmitting ? 'disabled' : ''} onclick="FlashcardView.skip()">跳过</button>
          </div>
        </div>
      </main>`;
  },

  showMeaning() {
    const nextState = revealMeaning(this.reviewState);
    if (nextState === this.reviewState) return;
    this.reviewState = nextState;
    this.renderRecall(this.container);
  },

  async submitRating(quality) {
    const submittingState = startRating(this.reviewState, quality);
    if (!submittingState) return;

    const session = this.cardSession;
    this.reviewState = submittingState;
    this.renderRecall(this.container);

    try {
      await this.recordRating(quality);
    } catch {
      if (session !== this.cardSession) return;
      this.reviewState = {
        ...this.reviewState,
        pendingQuality: null,
        isSubmitting: false
      };
      this.reviewNotice = '评分保存失败，请重试。';
      this.renderRecall(this.container);
      return;
    }

    if (session !== this.cardSession) return;
    this.reviewState = finishRating(this.reviewState);
    this.studyDetails = { examples: [], rootAnalysis: null, examPresentation: null, loading: true, phrases: { status: 'idle', items: [] }, similar: { status: 'idle', items: [] } };
    this.renderStudy(this.container);
    this.loadStudyDetails(session);
  },

  renderStudy(container) {
    this.closeStudyInfo();
    this.cleanupExampleWordLookup();
    const word = this.words[this.currentIndex];

    const canCorrectRating = canCorrectKnownRating(this.reviewState);
    const isCorrecting = Boolean(this.reviewState.isCorrecting);
    const intervalText = word.interval ? SpacedRepetition.getIntervalText(word.interval) : '';
    container.innerHTML = `
      <main class="app-standard-page flashcard-review-shell flashcard-review-shell--study" aria-labelledby="flashcardStudyTitle">
        <div class="flashcard-container flashcard-content flashcard-study-container" data-flashcard-content="study">
          <h2 id="flashcardStudyTitle" class="sr-only">单词学习详情</h2>
          ${this.renderProgress('STUDY')}
          <section class="flashcard-study-sheet flashcard-study-pane" data-flashcard-pane="study">
            <header class="flashcard-study-head flashcard-study-masthead">
              <button class="flashcard-study-word" type="button" data-study-audio="${esc(word.word)}" title="播放发音">${esc(word.word)}</button>
              ${this.currentPhonetic ? `<button class="flashcard-phonetic flashcard-study-phonetic" type="button" data-study-audio="${esc(word.word)}" title="播放发音">${esc(this.currentPhonetic)}</button>` : ''}
              <div class="flashcard-study-definition-list">${this.currentDefinitionLines.length
                ? this.currentDefinitionLines.map((line) => renderWordStudyDefinitionLine(line, 'flashcard-study-translation')).join('')
                : `<div class="flashcard-study-translation">${esc(this.currentTranslation)}</div>`}</div>
              <button class="flashcard-study-info-trigger" type="button" data-study-info-open aria-haspopup="dialog" aria-expanded="false">
                <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                <span>考试信息与复习间隔</span>
              </button>
            </header>
            <nav class="flashcard-study-tabs" role="tablist" aria-label="学习资料">
              ${renderWordStudyTabs(this.studyTab)}
            </nav>
            <div class="flashcard-study-panel" role="tabpanel">
              ${this.renderStudyPanel()}
            </div>
          </section>
          <div class="flashcard-study-next flashcard-study-bottom-dock">
            ${this.studyNotice ? `<p class="flashcard-correction-notice" role="status">${esc(this.studyNotice)}</p>` : ''}
            <button class="flashcard-next-btn" type="button" onclick="FlashcardView.advanceToNextWord()">下一词</button>
            ${canCorrectRating || isCorrecting ? `<button class="flashcard-correction-btn" type="button" ${isCorrecting ? 'disabled' : ''} onclick="FlashcardView.correctMistakenKnown()">${isCorrecting ? '正在更正…' : '记错了'}</button>` : ''}
          </div>
        </div>
        <div id="wordTooltip" class="word-tooltip" style="display:none"></div>
        <div class="flashcard-study-info-overlay" data-study-info-overlay hidden>
          <button class="flashcard-study-info-backdrop" type="button" data-study-info-close aria-label="关闭考试信息"></button>
          <section class="flashcard-study-info-sheet" role="dialog" aria-modal="true" aria-labelledby="flashcardStudyInfoTitle">
            <header>
              <div>
                <p class="page-eyebrow">WORD DOSSIER</p>
                <h3 id="flashcardStudyInfoTitle">考试信息与复习间隔</h3>
              </div>
              <button class="flashcard-study-info-close" type="button" data-study-info-close aria-label="关闭考试信息"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
            </header>
            ${this.studyDetails.examPresentation
              ? `<div class="flashcard-study-exam-detail">${renderExamCorpusDetail(this.studyDetails.examPresentation, esc)}</div>`
              : '<p class="flashcard-study-info-empty">暂无对应考试频度数据。</p>'}
            <div class="flashcard-study-info-interval"><span>当前复习间隔</span><strong>${esc(intervalText || '未安排')}</strong></div>
          </section>
        </div>
      </main>`;

    this.bindStudyActions();
    if (this.studyTab === 'examples' && !this.studyDetails.loading) {
      this.bindExampleWordLookup();
    }
  },

  renderStudyPanel() {
    if (this.studyDetails.loading) {
      return '<div class="flashcard-study-loading">正在整理学习资料…</div>';
    }

    if (this.studyTab === 'examples' && !this.studyExamplesExpanded) {
      return this.renderFocusedStudyExample();
    }

    const materials = renderWordStudyPanel({
      activeTab: this.studyTab,
      examples: this.studyDetails.examples,
      rootAnalysis: this.studyDetails.rootAnalysis,
      phrases: this.studyDetails.phrases,
      similar: this.studyDetails.similar
    });
    if (this.studyTab !== 'examples') return materials;
    return `<div class="flashcard-study-all-examples-head">
      <button type="button" data-example-focus-one><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> 返回单句学习</button>
      <span>全部 ${this.studyDetails.examples.length} 句</span>
    </div>${materials}`;
  },

  renderFocusedStudyExample() {
    const examples = getFocusedWordStudyExamples(this.studyDetails.examples);
    if (!examples.length) return '<div class="word-study-empty flashcard-study-empty">暂无例句。</div>';

    this.studyExampleIndex = Math.min(Math.max(0, this.studyExampleIndex), examples.length - 1);
    return renderFocusedWordStudyExample({
      examples: this.studyDetails.examples,
      index: this.studyExampleIndex,
      targetWord: this.words[this.currentIndex]?.word || ''
    });
  },

  setStudyTab(tab) {
    if (this.reviewState.phase !== REVIEW_PHASES.STUDY || !isWordStudyTab(tab)) return;
    this.studyTab = tab;
    this.studyExamplesExpanded = false;
    this.renderStudy(this.container);
    if (tab === 'phrases' && this.studyDetails.phrases.status === 'idle') {
      void this.loadPhrases(this.cardSession);
    }
    if (tab === 'similar' && this.studyDetails.similar.status === 'idle') {
      void this.loadSimilar(this.cardSession);
    }
    if (tab === 'related') {
      void this.loadStructuredRoot(this.cardSession);
    }
  },

  bindStudyActions() {
    this.container?.querySelectorAll('[data-study-tab]').forEach(button => {
      button.addEventListener('click', () => this.setStudyTab(button.dataset.studyTab));
    });
    this.container?.querySelectorAll('[data-study-audio]').forEach(button => {
      button.addEventListener('click', () => {
        void AudioCache.getAudio(button.dataset.studyAudio).catch(() => {});
      });
    });
    this.container?.querySelector('[data-study-info-open]')?.addEventListener('click', () => {
      this.openStudyInfo();
    });
    this.container?.querySelectorAll('[data-study-info-close]').forEach(button => {
      button.addEventListener('click', () => this.closeStudyInfo());
    });
    this.container?.querySelectorAll('[data-example-translate]').forEach(button => {
      button.addEventListener('click', () => this.translateExample(Number.parseInt(button.dataset.exampleTranslate, 10), button));
    });
    this.container?.querySelectorAll('[data-example-select]').forEach(button => {
      button.addEventListener('click', () => this.selectStudyExample(Number.parseInt(button.dataset.exampleSelect, 10)));
    });
    this.container?.querySelector('[data-example-show-all]')?.addEventListener('click', () => {
      this.showAllStudyExamples();
    });
    this.container?.querySelector('[data-example-focus-one]')?.addEventListener('click', () => {
      this.showFocusedStudyExample();
    });
    const carousel = this.container?.querySelector('[data-example-carousel]');
    if (carousel) {
      carousel.addEventListener('touchstart', (event) => {
        this._studyExampleTouchStartX = event.touches?.[0]?.clientX ?? null;
        this._studyExampleTouchStartY = event.touches?.[0]?.clientY ?? null;
      }, { passive: true });
      carousel.addEventListener('touchend', (event) => {
        const startX = this._studyExampleTouchStartX;
        const startY = this._studyExampleTouchStartY;
        this._studyExampleTouchStartX = null;
        this._studyExampleTouchStartY = null;
        const endX = event.changedTouches?.[0]?.clientX;
        const endY = event.changedTouches?.[0]?.clientY;
        const direction = getHorizontalSwipeDirection({ startX, startY, endX, endY });
        if (!direction) return;
        this.selectStudyExample(this.studyExampleIndex + (direction === 'next' ? 1 : -1));
      }, { passive: true });
    }
    if (this._studyExampleKeyHandler) document.removeEventListener('keydown', this._studyExampleKeyHandler);
    this._studyExampleKeyHandler = (event) => {
      if (this.studyTab !== 'examples' || this.studyExamplesExpanded) return;
      if (event.target instanceof HTMLElement && event.target.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        this.selectStudyExample(this.studyExampleIndex + 1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        this.selectStudyExample(this.studyExampleIndex - 1);
      }
    };
    document.addEventListener('keydown', this._studyExampleKeyHandler);
    this.container?.querySelector('[data-retry-phrases]')?.addEventListener('click', () => {
      void this.loadPhrases(this.cardSession);
    });
    this.container?.querySelector('[data-retry-similar]')?.addEventListener('click', () => {
      void this.loadSimilar(this.cardSession);
    });
  },

  selectStudyExample(index) {
    const total = getFocusedWordStudyExamples(this.studyDetails.examples).length;
    if (!total) return;
    const nextIndex = Math.min(Math.max(0, index), total - 1);
    if (nextIndex === this.studyExampleIndex) return;
    this.studyExampleIndex = nextIndex;
    this.renderStudy(this.container);
  },

  showAllStudyExamples() {
    this.studyExamplesExpanded = true;
    this.renderStudy(this.container);
  },

  showFocusedStudyExample() {
    this.studyExamplesExpanded = false;
    this.renderStudy(this.container);
  },

  openStudyInfo() {
    const overlay = this.container?.querySelector('[data-study-info-overlay]');
    if (!overlay) return;
    overlay.hidden = false;
    this.container?.querySelector('[data-study-info-open]')?.setAttribute('aria-expanded', 'true');
    document.body.classList.add('flashcard-study-info-open');
    this._studyInfoKeyHandler = (event) => {
      if (event.key === 'Escape') this.closeStudyInfo();
    };
    document.addEventListener('keydown', this._studyInfoKeyHandler);
    overlay.querySelector('[data-study-info-close]')?.focus();
  },

  closeStudyInfo() {
    this.container?.querySelector('[data-study-info-overlay]')?.setAttribute('hidden', '');
    this.container?.querySelector('[data-study-info-open]')?.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('flashcard-study-info-open');
    if (this._studyInfoKeyHandler) {
      document.removeEventListener('keydown', this._studyInfoKeyHandler);
      this._studyInfoKeyHandler = null;
    }
  },

  bindExampleWordLookup() {
    const root = this.container?.querySelector('.flashcard-study-panel');
    if (!root) return;

    this._exampleLookupRoot = root;
    this._exampleLookupHandler = async (e) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target || target.closest('.example-translate-btn')) return;
      const wordTarget = target.closest('[data-word-study-word]');
      const sentence = target.closest('.flashcard-example-item p[data-example-text]');
      if (!sentence) return;

      const word = String(wordTarget?.dataset.wordStudyWord || Tooltip.getWordAtPoint(e) || '').trim();
      if (!word) return;

      e.stopPropagation();
      e.preventDefault();
      Tooltip.hide();
      const lookupId = Tooltip.beginLookup(e.clientX, e.clientY);
      try {
        const data = await Dictionary.lookup(word);
        await Tooltip.show(lookupId, e.clientX, e.clientY, data, false, {
          targetTrack: Config.get('exam_level') || '',
          contextSentence: sentence.textContent || ''
        });
      } catch {
        if (Tooltip.isCurrent(lookupId)) Tooltip.showError(lookupId, e.clientX, e.clientY);
      }
    };
    root.addEventListener('click', this._exampleLookupHandler);

    this._exampleLookupGlobalHandler = (e) => {
      const tooltip = document.getElementById('wordTooltip');
      if (!tooltip || tooltip.style.display === 'none' || tooltip.contains(e.target)) return;
      Tooltip.hide();
    };
    document.addEventListener('click', this._exampleLookupGlobalHandler);
    this._exampleTooltipDismissCleanup = Tooltip.attachAutoDismiss();
  },

  cleanupExampleWordLookup() {
    if (this._exampleLookupRoot && this._exampleLookupHandler) {
      this._exampleLookupRoot.removeEventListener('click', this._exampleLookupHandler);
    }
    if (this._exampleLookupGlobalHandler) {
      document.removeEventListener('click', this._exampleLookupGlobalHandler);
    }
    if (this._exampleTooltipDismissCleanup) {
      this._exampleTooltipDismissCleanup();
    }
    this._exampleLookupRoot = null;
    this._exampleLookupHandler = null;
    this._exampleLookupGlobalHandler = null;
    this._exampleTooltipDismissCleanup = null;
    Tooltip.hide();
  },

  async loadStudyDetails(session) {
    const word = this.words[this.currentIndex];
    const targetTrack = Config.get('exam_level') || '';
    const [examExamples, examples, rootAnalysis, examCorpus] = await Promise.all([
      ExamCorpus.getExamples(word.word, targetTrack).catch(() => []),
      Examples.getExamples(word.word).catch(() => []),
      Affixes.getAnalysis(word.word).catch(() => null),
      ExamCorpus.lookupAll(word.word).catch(() => ({}))
    ]);

    if (session !== this.cardSession || this.reviewState.phase !== REVIEW_PHASES.STUDY) return;
    const mergedExamples = mergeWordStudyExamples(examExamples, examples);
    this._currentExamples = mergedExamples;
    this.studyDetails = {
      ...this.studyDetails,
      examples: mergedExamples,
      rootAnalysis,
      examPresentation: selectExamCorpusPresentation(examCorpus, targetTrack),
      loading: false
    };
    this.renderStudy(this.container);
    this.loadRelatedTranslations(session, word.word, rootAnalysis);
    if (this.studyTab === 'related') void this.loadStructuredRoot(session);
  },

  async loadRelatedTranslations(session, word, rootAnalysis) {
    if (!rootAnalysis || Affixes.getRelatedWordDetails(rootAnalysis).every(item => item.translation)) return;
    const enriched = await Affixes.enrichRelatedTranslations(word, rootAnalysis).catch(() => rootAnalysis);
    if (session !== this.cardSession || this.reviewState.phase !== REVIEW_PHASES.STUDY || !enriched) return;
    this.studyDetails = { ...this.studyDetails, rootAnalysis: enriched };
    if (this.studyTab === 'related') this.renderStudy(this.container);
  },

  async loadStructuredRoot(session) {
    const word = this.words[this.currentIndex]?.word;
    const analysis = this.studyDetails.rootAnalysis;
    if (!word || !analysis || Affixes.hasStructuredRoot(analysis)) return;
    this.cancelRootRequest();
    const controller = new AbortController();
    this._rootController = controller;
    try {
      const enriched = await Affixes.ensureStructuredRoot(word, analysis, { signal: controller.signal });
      if (session !== this.cardSession || this.reviewState.phase !== REVIEW_PHASES.STUDY || controller.signal.aborted || !enriched) return;
      this.studyDetails = { ...this.studyDetails, rootAnalysis: enriched };
      if (this.studyTab === 'related') this.renderStudy(this.container);
    } catch {
      // Legacy cache content remains readable when structured enrichment is unavailable.
    } finally {
      if (this._rootController === controller) this._rootController = null;
    }
  },

  cancelRootRequest() {
    this._rootController?.abort();
    this._rootController = null;
  },

  async loadPhrases(session) {
    const word = this.words[this.currentIndex]?.word;
    if (!word || session !== this.cardSession) return;
    this.cancelPhraseRequest();
    const controller = new AbortController();
    this._phraseController = controller;
    this.studyDetails = { ...this.studyDetails, phrases: { status: 'loading', items: [] } };
    if (this.studyTab === 'phrases') this.renderStudy(this.container);
    try {
      const items = await WordPhrases.get(word, { signal: controller.signal });
      if (session !== this.cardSession || this.reviewState.phase !== REVIEW_PHASES.STUDY || controller.signal.aborted) return;
      this.studyDetails = { ...this.studyDetails, phrases: { status: 'ready', items } };
      if (this.studyTab === 'phrases') this.renderStudy(this.container);
    } catch (error) {
      if (session !== this.cardSession || error?.name === 'AbortError') return;
      this.studyDetails = { ...this.studyDetails, phrases: { status: 'error', items: [] } };
      if (this.studyTab === 'phrases') this.renderStudy(this.container);
    } finally {
      if (this._phraseController === controller) this._phraseController = null;
    }
  },

  cancelPhraseRequest() {
    this._phraseController?.abort();
    this._phraseController = null;
  },

  async loadSimilar(session) {
    const word = this.words[this.currentIndex]?.word;
    if (!word || session !== this.cardSession) return;
    this.cancelSimilarRequest();
    const controller = new AbortController();
    this._similarController = controller;
    this.studyDetails = { ...this.studyDetails, similar: { status: 'loading', items: [] } };
    if (this.studyTab === 'similar') this.renderStudy(this.container);
    try {
      const items = await WordSimilar.get(word, { signal: controller.signal });
      if (session !== this.cardSession || this.reviewState.phase !== REVIEW_PHASES.STUDY || controller.signal.aborted) return;
      this.studyDetails = { ...this.studyDetails, similar: { status: 'ready', items } };
      if (this.studyTab === 'similar') this.renderStudy(this.container);
    } catch (error) {
      if (session !== this.cardSession || error?.name === 'AbortError') return;
      this.studyDetails = { ...this.studyDetails, similar: { status: 'error', items: [] } };
      if (this.studyTab === 'similar') this.renderStudy(this.container);
    } finally {
      if (this._similarController === controller) this._similarController = null;
    }
  },

  cancelSimilarRequest() {
    this._similarController?.abort();
    this._similarController = null;
  },

  advanceToNextWord() {
    if (!nextWord(this.reviewState)) return;
    this.commitPendingKnowledgeEvidence();
    if (!this.practiceScope && this.sessionQueue) {
      this.currentIndex++;
      void this.persistCurrentSession();
    } else {
      this.currentIndex++;
    }
    this.renderCard(this.container);
  },

  restart() {
    if (!this.practiceScope) {
      void clearSessionQueue({ db: DB });
      this.sessionQueue = null;
    }
    this.render(this.container, this.practiceScope || '');
  },

  // Record a rating
  async recordRating(quality) {
    const word = this.words[this.currentIndex];
    const meaningRevealed = Boolean(this.reviewState.meaningRevealed);
    const attempt = {
      id: `flashcard:${this.cardSession}:${word.id}:${Date.now()}`,
      baseline: { ...word },
      initialQuality: quality
    };
    if (this.practiceScope) {
      await DB.recordLearnWordPractice(word.id, {
        rating: quality,
        sawAnswer: meaningRevealed,
        practiceScope: this.practiceScope
      });
    } else {
      const sessionDebt = this.sessionQueue?.getDebt(word.id) || 0;
      const srsData = settleSessionReview(attempt.baseline, quality, sessionDebt);
      const updatedWord = await DB.settleSessionReview(word.id, srsData, {
        rating: quality,
        source: 'flashcard',
        sawAnswer: meaningRevealed,
        attemptId: attempt.id,
        expectedRevision: word.expectedRevision,
        sessionDebt
      });
      Object.assign(word, updatedWord || srsData, { expectedRevision: updatedWord?.reviewRevision ?? word.expectedRevision });
      if (this.sessionQueue) {
        const outcome = this.sessionQueue.rate(word.id, quality, { expectedRevision: word.expectedRevision });
        await this.persistCurrentSession();
        if (outcome.reinserted) {
          this.reviewState = finishRating(this.reviewState);
          this.renderStudy(this.container);
          this.loadStudyDetails(this.cardSession);
          return;
        }
      }
    }
    this.ratingAttempt = attempt;
    this.pendingKnowledgeEvidence = {
      word: word.word,
      quality,
      meaningRevealed,
      attemptId: attempt.id,
      contextId: `flashcard-card:${this.cardSession}`
    };

    this.ratingCounts[quality] = (this.ratingCounts[quality] || 0) + 1;

    const wordData = {
      word: word.word,
      translation: getSavableTranslation(word) || getSavableTranslation({ translation: this.currentTranslation }),
      quality,
      attemptId: attempt.id
    };
    this.reviewedWords.push(wordData);

    // Persist to today's words
    this.addTodayWord(wordData);
  },

  async correctMistakenKnown() {
    const correctingState = startRatingCorrection(this.reviewState);
    const attempt = this.ratingAttempt;
    if (!correctingState || !attempt) return;

    const session = this.cardSession;
    const word = this.words[this.currentIndex];
    this.reviewState = correctingState;
    this.studyNotice = '';
    this.renderStudy(this.container);

    try {
      if (this.practiceScope) {
        await DB.recordLearnWordPractice(word.id, {
          rating: 1,
          sawAnswer: true,
          practiceScope: this.practiceScope
        });
      } else {
        const sessionDebt = (this.sessionQueue?.getDebt(word.id) || 0) + sessionDebtValue(1);
        const correctedSrs = settleSessionReview(attempt.baseline, 1, sessionDebt);
        const correctedWord = await DB.settleSessionReview(word.id, correctedSrs, {
          rating: 1,
          source: 'flashcard',
          sawAnswer: true,
          attemptId: attempt.id,
          expectedRevision: word.expectedRevision,
          sessionDebt
        });
        Object.assign(word, correctedWord || correctedSrs, { expectedRevision: correctedWord?.reviewRevision ?? word.expectedRevision });
        if (this.sessionQueue) {
          const outcome = this.sessionQueue.rate(word.id, 1, { expectedRevision: word.expectedRevision });
          await this.persistCurrentSession();
          if (outcome.reinserted) {
            this.reviewState = finishRatingCorrection(this.reviewState);
            this.studyNotice = '已更正为“忘了”，将隔 3 个词后再次出现。';
            this.renderStudy(this.container);
            return;
          }
        }
      }
      if (session !== this.cardSession) return;

      this.ratingCounts[5] = Math.max(0, (this.ratingCounts[5] || 0) - 1);
      this.ratingCounts[1] = (this.ratingCounts[1] || 0) + 1;
      const reviewed = this.reviewedWords.find(item => item.attemptId === attempt.id);
      if (reviewed) reviewed.quality = 1;
      this.addTodayWord({
        word: word.word,
        translation: getSavableTranslation(word) || getSavableTranslation({ translation: this.currentTranslation }),
        quality: 1,
        attemptId: attempt.id
      });
      if (this.pendingKnowledgeEvidence?.attemptId === attempt.id) {
        this.pendingKnowledgeEvidence = {
          ...this.pendingKnowledgeEvidence,
          quality: 1,
          meaningRevealed: true
        };
      }
      this.reviewState = finishRatingCorrection(this.reviewState);
      this.studyNotice = this.practiceScope ? '已更正为“忘了”。' : '已更正为“忘了”，将隔 3 个词后再次出现。';
      this.renderStudy(this.container);
    } catch {
      if (session !== this.cardSession) return;
      this.reviewState = { ...this.reviewState, isSubmitting: false, isCorrecting: false };
      this.studyNotice = '更正失败，请重试。';
      this.renderStudy(this.container);
    }
  },

  commitPendingKnowledgeEvidence() {
    if (this.practiceScope) return;
    const evidence = this.pendingKnowledgeEvidence;
    this.pendingKnowledgeEvidence = null;
    if (!evidence) return;
    // Mastery evidence is committed only after the user leaves this detail
    // view, so a mistaken “认识” can be corrected without a false success.
    void knowledgeEvidenceBridge.recordFlashcardRating({
      ...evidence,
      source: 'flashcard-review'
    });
  },

  // Skip current word (don't rate)
  skip() {
    if (!skipWord(this.reviewState)) return;
    this.currentIndex++;
    this.renderCard(this.container);
  },

  // Render completion result
  renderResult(container) {
    this.cleanupExampleWordLookup();
    // 专项练习完成即结束本次会话：清掉 sessionStorage 中的词表，
    // 避免再次进入同一入口时重复复习同一批词（正式复习队列不受影响）。
    const isPractice = Boolean(this.practiceScope);

    if (isPractice) {
      clearPracticeSession();
      this.practiceScope = '';
    }
    const total = this.ratingCounts[1] + this.ratingCounts[3] + this.ratingCounts[5];
    const accuracy = total > 0 ? Math.round((this.ratingCounts[5] + this.ratingCounts[3]) / total * 100) : 0;

    // Today's accumulated words (across multiple review sessions)
    const todayWords = this.loadTodayWords();
    const todayTotal = todayWords.length;
    const todayForgot = todayWords.filter(w => w.quality === 1).map(w => w.word);
    const todayFuzzy = todayWords.filter(w => w.quality === 3).map(w => w.word);
    const todayReinforce = [...todayForgot, ...todayFuzzy];
    const canGenerate = todayTotal >= 3;

    container.innerHTML = `
      <main class="app-standard-page flashcard-review-shell flashcard-review-shell--result" aria-labelledby="flashcardResultTitle">
      <div class="flashcard-container">
        <section class="flashcard-result flashcard-result-sheet">
          <h2 id="flashcardResultTitle">${isPractice ? '专项练习完成' : '复习完成'}</h2>
          ${isPractice ? '<p class="flashcard-result-hint">本次为专项练习，结果已记录，但不影响正式复习计划。</p>' : ''}
          <div class="flashcard-result-stats">
            <div class="flashcard-result-stat">
              <span class="flashcard-result-num">${total}</span>
              <span class="flashcard-result-label">总复习</span>
            </div>
            <div class="flashcard-result-stat">
              <span class="flashcard-result-num" style="color:var(--success)">${this.ratingCounts[5]}</span>
              <span class="flashcard-result-label">认识</span>
            </div>
            <div class="flashcard-result-stat">
              <span class="flashcard-result-num" style="color:var(--warning)">${this.ratingCounts[3]}</span>
              <span class="flashcard-result-label">模糊</span>
            </div>
            <div class="flashcard-result-stat">
              <span class="flashcard-result-num" style="color:var(--danger)">${this.ratingCounts[1]}</span>
              <span class="flashcard-result-label">忘记</span>
            </div>
          </div>
          <div class="flashcard-result-accuracy">
            正确率：${accuracy}%
          </div>
          <p class="flashcard-result-hint">
            ${accuracy >= 80 ? '💪 表现很好！继续保持。' : accuracy >= 50 ? '📖 还需要多复习，加油！' : '🔄 建议降低复习难度，循序渐进。'}
          </p>

          ${todayTotal > this.reviewedWords.length ? `
          <div class="flashcard-result-today">
            📅 今日累计复习：<strong>${todayTotal}</strong> 个单词（本轮 ${this.reviewedWords.length} 个）
          </div>` : ''}

          ${!isPractice && canGenerate ? `
          <div class="flashcard-result-generate">
            <h3>📝 巩固阅读</h3>
            <p class="flashcard-result-hint">使用今天复习的词汇生成阅读文章，在语境中巩固记忆${todayReinforce.length > 0 ? '（优先使用记不住的词）' : ''}</p>
            <div style="display:flex;gap:8px;justify-content:center;margin-top:10px;flex-wrap:wrap">
              <button class="btn btn-primary" onclick="FlashcardView.generateReviewArticle('all')">生成阅读（今日全部 ${todayTotal} 词）</button>
              ${todayReinforce.length > 0 && todayReinforce.length < todayTotal ? `
              <button class="btn btn-outline" onclick="FlashcardView.generateReviewArticle('weak')">重点巩固（${todayReinforce.length} 个薄弱词）</button>
              ` : ''}
            </div>
          </div>` : !isPractice && todayTotal > 0 ? `
          <div class="flashcard-result-generate">
            <p class="flashcard-result-hint">今日已复习 ${todayTotal} 个词，再复习 ${3 - todayTotal} 个即可生成巩固阅读</p>
          </div>` : ''}

          <div style="display:flex;gap:12px;justify-content:center;margin-top:16px;flex-wrap:wrap">
            <a href="${isPractice ? '#/vocab' : '#/chat'}" class="btn btn-outline">${isPractice ? '返回生词本' : '返回阅读'}</a>
            <a href="#/learn-words" class="btn btn-outline">词库管理</a>
            ${isPractice ? '' : '<button class="btn btn-outline" onclick="FlashcardView.restart()">再来一轮</button>'}
          </div>
        </section>
      </div>
      </main>`;
  },

  // Translate an example sentence
  async translateExample(index, btn) {
    const transEl = btn.closest('.word-study-example-item')?.querySelector(`[data-example-translation="${index}"]`);
    if (!transEl) return;

    // Toggle if already translated
    if (transEl.textContent) {
      transEl.textContent = '';
      btn.textContent = '译';
      return;
    }

    btn.textContent = '...';
    const example = normalizeWordStudyExample(this._currentExamples?.[index]);
    if (!example?.sentenceEn) return;

    try {
      const translation = example.translationZh || await API.translateSentence(example.sentenceEn);
      transEl.textContent = translation;
      btn.textContent = '收';
    } catch {
      btn.textContent = '译';
    }
  },

  ensureTargetTrackBeforeGeneration() {
    if (!requiresTargetTrackSelection(Config.get('exam_level'), Config.get('target_track_selection_required'))) {
      return false;
    }
    alert('生成巩固阅读前，请先选择目标考试。初测页面可选择四级、六级、考研英语一或考研英语二。');
    location.hash = '#/assessment';
    return true;
  },

  // Generate article using today's reviewed words
  async generateReviewArticle(mode) {
    if (this.ensureTargetTrackBeforeGeneration()) return;
    if (!Config.hasApiKey()) {
      Modal.showApiSettings();
      return;
    }

    // Use today's accumulated words (not just current session)
    const todayWords = this.loadTodayWords();

    let words;
    if (mode === 'weak') {
      words = todayWords.filter(w => w.quality <= 3).map(w => w.word);
    } else {
      words = todayWords.map(w => w.word);
    }

    const allWords = normalizeTargetWords(words, Number.POSITIVE_INFINITY);
    if (allWords.length < 2) {
      alert('词汇太少，无法生成文章');
      return;
    }

    location.hash = '#/chat';
    await new Promise(r => setTimeout(r, 100));
    return ChatView.generateReviewReadings({
      reviewWords: allWords,
      difficulty: Config.get('exam_level') || 'cet4',
      topic: '复习巩固',
      sourceLabel: mode === 'weak' ? '今日薄弱词' : '今日复习词'
    });
  },

  cleanup() {
    this.cancelCardPronunciation();
    this.cancelPhraseRequest();
    this.cancelSimilarRequest();
    this.cancelRootRequest();
    this.cleanupExampleWordLookup();
    this.closeStudyInfo();
    this.practiceScope = '';
    if (this._studyExampleKeyHandler) {
      document.removeEventListener('keydown', this._studyExampleKeyHandler);
      this._studyExampleKeyHandler = null;
    }
  }
};

window.FlashcardView = FlashcardView;
