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
import { bindLearningTextLookup } from '../components/reading-word-lookup.js';
import { AudioCache } from '../audio-cache.js';
import { ExamCorpus } from '../exam-corpus-runtime.mjs';
import { normalizeTargetWords } from '../components/article-generation-tool.js';
import { createLexiconLoader } from '../lexicon-runtime.mjs';
import { createKnowledgeEvidenceBridge } from '../components/knowledge-evidence-bridge.mjs';
import { requiresTargetTrackSelection } from '../learning-track.mjs';
import { formatPhonetic, getDefinitionDisplayLines, getSavableTranslation } from '../components/definition-trust.mjs';
import { ensureSavedWordDefinition } from '../components/saved-word-definition.mjs';
import { ReviewQueue } from '../review-queue.js';
import {
  clearPracticeSession,
  finalizePracticeSession,
  getPracticeProgress,
  readPracticeSession
} from '../review-practice.mjs';
import {
  createSessionQueue,
  persistSessionQueue,
  clearSessionQueue,
  loadSessionQueue,
  sessionDebtValue,
  ACTIVE_SESSION_KEY
} from '../review-session.mjs';
import { getReviewPersistence } from '../review-persistence.mjs';
import { summarizeReviewPersistenceStatus } from '../review-persistence-status.mjs';
import { settleSessionReview } from '../recovery-scheduler.mjs';
import { ActivityType } from '../learning-activity.mjs';
import { localDayKey } from '../learning-day.mjs';
import { StudySessionTimer } from '../study-session-timer.mjs';
import { createReviewSessionMetrics, mergeTodayReviewedWord } from '../review-session-metrics.mjs';
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

const numberOrZero = value => Math.max(0, Number(value) || 0);

function diagnosticLogger() {
  try {
    return globalThis?.__englishReaderDiagnosticLogger || null;
  } catch {
    return null;
  }
}

function diagnosticCorrelationId() {
  return `review:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function reviewRecoveryTransition(before = {}, after = {}, stubborn = false) {
  const beforeStage = Math.max(0, Math.trunc(Number(before.recoveryStage) || 0));
  const afterStage = Math.max(0, Math.trunc(Number(after.recoveryStage) || 0));
  const target = Math.max(afterStage, Math.trunc(Number(after.recoveryTarget) || 0));
  return {
    fragile: target === 1 ? 1 : 0,
    relearning: target === 2 ? 1 : 0,
    difficult: target >= 3 ? 1 : 0,
    reducedStages: afterStage < beforeStage ? 1 : 0,
    stubborn: stubborn || Number(after.stubbornUntil) > 0 ? 1 : 0
  };
}

export const FlashcardView = {
  words: [],
  currentIndex: 0,
  ratingCounts: { 1: 0, 3: 0, 5: 0 },
  skippedCount: 0,
  reviewedWords: [],       // Current session
  reviewedWordIds: new Set(),
  reviewMetrics: createReviewSessionMetrics(),
  recoverySummary: { fragile: 0, relearning: 0, difficult: 0, reducedStages: 0, stubborn: 0 },
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
  ratingCorrelationId: '',
  pendingKnowledgeEvidence: null,
  practiceScope: '',
  practiceWordIds: [],
  practiceCompletedWordIds: new Set(),
  practiceProgress: null,
  practiceMissingCount: 0,
  sessionQueue: null,
  reviewPersistence: null,
  wordCache: new Map(),
  reviewSessionId: '',
  reviewTimer: null,
  reviewSummarySaved: false,
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
  _definitionRequestToken: 0,
  _reviewPersistenceUnsubscribe: null,
  _resultPersistenceRetrying: false,

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
      if (data && data.date === this.getTodayKey() && Array.isArray(data.words)) return data.words;
    } catch {}
    return [];
  },

  saveTodayWords(words) {
    try {
      localStorage.setItem(this.TODAY_KEY, JSON.stringify({
        date: this.getTodayKey(),
        words
      }));
    } catch {
      // 复习结果的辅助汇总不可用时，评分本身仍应成功。
    }
  },

  addTodayWord(wordData) {
    const today = this.loadTodayWords();
    const idx = today.findIndex(w => w.word === wordData.word);
    if (idx === -1) {
      today.push(wordData);
    } else {
      today[idx] = mergeTodayReviewedWord(today[idx], wordData);
    }
    this.saveTodayWords(today);
  },

  recordAcceptedRating(word, quality, attempt) {
    this.reviewMetrics.recordRating({ attemptId: attempt.id, wordId: word.id, quality });
    this.ratingCounts[quality] = (this.ratingCounts[quality] || 0) + 1;
    this.reviewedWordIds.add(Number(word.id));
    const wordData = {
      word: word.word,
      translation: getSavableTranslation(word) || getSavableTranslation({ translation: this.currentTranslation }),
      quality,
      attemptId: attempt.id,
      ...this.reviewMetrics.getWordResult(word.id)
    };
    this.reviewedWords.push(wordData);
    this.addTodayWord(wordData);
  },

  recordCorrectedRating(word, attempt) {
    this.reviewMetrics.recordRating({ attemptId: attempt.id, wordId: word.id, quality: 1 });
    this.ratingCounts[5] = Math.max(0, (this.ratingCounts[5] || 0) - 1);
    this.ratingCounts[1] = (this.ratingCounts[1] || 0) + 1;
    this.reviewedWordIds.add(Number(word.id));
    const reviewed = this.reviewedWords.find(item => item.attemptId === attempt.id);
    if (reviewed) Object.assign(reviewed, {
      quality: 1,
      ...this.reviewMetrics.getWordResult(word.id)
    });
    this.addTodayWord({
      word: word.word,
      translation: getSavableTranslation(word) || getSavableTranslation({ translation: this.currentTranslation }),
      quality: 1,
      attemptId: attempt.id,
      ...this.reviewMetrics.getWordResult(word.id)
    });
  },

  resetReviewTelemetry() {
    this.skippedCount = 0;
    this.reviewedWordIds = new Set();
    this.recoverySummary = { fragile: 0, relearning: 0, difficult: 0, reducedStages: 0, stubborn: 0 };
    this.reviewSessionId = '';
    this.reviewTimer = null;
    this.reviewSummarySaved = false;
    this.ratingCorrelationId = '';
    this.reviewMetrics = createReviewSessionMetrics();
  },

  updatePracticeProgress() {
    if (!this.practiceScope) return;
    const completedWordIds = [...this.practiceCompletedWordIds]
      .map(id => Number(id))
      .filter(Number.isFinite);
    const totalCount = this.practiceWordIds.length;
    this.practiceProgress = {
      ...(this.practiceProgress || {}),
      scope: this.practiceScope,
      completedWordIds,
      completedCount: Math.min(totalCount, completedWordIds.length),
      totalCount,
      remainingCount: Math.max(0, totalCount - completedWordIds.length),
      done: totalCount > 0 && completedWordIds.length >= totalCount
    };
  },

  bindReviewPersistenceStatus() {
    this._reviewPersistenceUnsubscribe?.();
    this._reviewPersistenceUnsubscribe = this.reviewPersistence?.subscribe?.(event => {
      if (!event || !this.container) return;
      this.updateResultPersistenceStatus();
      // Result pages have their own global status indicator. Do not let a
      // late completion/failure event replace the result with the old card.
      if (this.container.querySelector?.('[data-review-persistence-status]')) return;
      if (!['rating_failed', 'rating_completed'].includes(event.type)) return;
      const currentWord = this.words[this.currentIndex];
      if (!currentWord || Number(event.wordId) !== Number(currentWord.id)) return;
      if (event.type === 'rating_failed') {
        this.studyNotice = '评分已记录但暂未保存，点击重试可继续同步。';
        if (this.reviewState.phase === REVIEW_PHASES.STUDY) this.renderStudy(this.container);
      }
      if (event.type === 'rating_completed' && (this.studyNotice.includes('暂未保存') || this.studyNotice.includes('重试'))) {
        this.studyNotice = '已保存';
        if (this.reviewState.phase === REVIEW_PHASES.STUDY) this.renderStudy(this.container);
      }
    }) || null;
  },

  updateResultPersistenceStatus() {
    const statusNode = this.container?.querySelector?.('[data-review-persistence-status]');
    if (!statusNode) return;
    if (this._resultPersistenceRetrying) {
      statusNode.dataset.status = 'saving';
      statusNode.innerHTML = '<span>正在重试保存…</span>';
      return;
    }
    const summary = summarizeReviewPersistenceStatus(this.reviewPersistence?.getStatus?.());
    statusNode.dataset.status = summary.state;
    const errorCodeBadge = summary.errorCodes?.length
      ? `<span class="review-persistence-codes">错误码 ${esc(summary.errorCodes.join('、'))}</span>`
      : '';
    statusNode.innerHTML = `<span>${summary.message}</span>${errorCodeBadge}${summary.retryable ? ' <button class="review-persistence-retry" type="button">重试</button>' : ''}`;
    const retryButton = statusNode.querySelector?.('.review-persistence-retry');
    retryButton?.addEventListener('click', () => { void this.retryResultPersistence(); });
  },

  async retryResultPersistence() {
    if (this._resultPersistenceRetrying || !this.reviewPersistence?.retryFailed) return;
    this._resultPersistenceRetrying = true;
    this.updateResultPersistenceStatus();
    try {
      await this.reviewPersistence.retryFailed();
      await this.reviewPersistence.flush?.({ timeoutMs: 5000 });
    } catch {
      // The failed journal rows remain durable and the final status render
      // exposes them as retryable instead of hiding the failure.
    } finally {
      this._resultPersistenceRetrying = false;
      this.updateResultPersistenceStatus();
    }
  },

  startReviewTimer({ practiceSession = null, persistedSession = null } = {}) {
    if (this.reviewTimer && !this.reviewSummarySaved) return;
    const mode = this.practiceScope ? 'practice' : 'flashcard';
    const seed = this.practiceScope
      ? practiceSession?.createdAt
      : persistedSession?.createdAt || this.sessionQueue?.snapshot?.().createdAt;
    this.reviewSessionId = `review:${mode}:${Number(seed) || Date.now()}`;
    this.reviewTimer = new StudySessionTimer({
      sessionId: this.reviewSessionId,
      mode: this.practiceScope ? 'practice' : 'flashcard'
    });
    this.reviewTimer.start({ contextKey: 'recall' });
    this.reviewSummarySaved = false;
  },

  noteReviewActivity() {
    this.reviewTimer?.noteActivity();
  },

  recordRecoveryTransition(before, after, stubborn = false) {
    const transition = reviewRecoveryTransition(before, after, stubborn);
    for (const key of Object.keys(this.recoverySummary)) {
      this.recoverySummary[key] += transition[key] || 0;
    }
  },

  async persistReviewSummary(requestedStatus, practiceCompleted = null) {
    if (!this.reviewTimer || this.reviewSummarySaved) return;

    const mode = this.practiceScope ? 'practice' : 'flashcard';
    const status = mode === 'practice' && practiceCompleted === false ? 'partial' : requestedStatus;
    const durationMs = Math.max(0, Math.round(this.reviewTimer.getActiveDuration()));
    const completedWordIds = mode === 'practice'
      ? [...this.practiceCompletedWordIds].map(Number).filter(Number.isFinite)
      : [...this.reviewedWordIds].map(Number).filter(Number.isFinite);
    const hasActivity = durationMs > 0 || completedWordIds.length > 0 || Object.values(this.ratingCounts).some(numberOrZero);

    this.reviewTimer.finish(status);
    this.reviewSummarySaved = true;
    if (status === 'partial' && !hasActivity) return;

    const occurredAt = Date.now();
    const metrics = this.reviewMetrics.summary();
    try {
      await DB.saveLearningActivity({
        id: `review-session-summary:${this.reviewSessionId}`,
        type: ActivityType.REVIEW_SESSION_SUMMARY,
        occurredAt,
        dayKey: localDayKey(occurredAt),
        sessionId: this.reviewSessionId,
        dedupeKey: `review-summary:${this.reviewSessionId}`,
        payload: {
          mode: this.practiceScope ? 'practice' : 'flashcard',
          scope: this.practiceScope || 'scheduled',
          status,
          durationMs,
          counts: {
            known: metrics.known,
            uncertain: metrics.uncertain,
            unknown: metrics.unknown,
            skipped: numberOrZero(this.skippedCount)
          },
          completedWordIds,
          recovery: { ...this.recoverySummary }
        }
      });
    } catch (error) {
      console.warn('复习活动汇总保存失败', error);
    }
  },

  // Render flashcard view
  async render(container, requestedScope = '') {
    await this.persistReviewSummary('partial');
    this.invalidateCardRequests();
    this.container = container;
    this.reviewPersistence = getReviewPersistence(DB);
    this.bindReviewPersistenceStatus();
    this.wordCache = new Map();
    this.resetReviewTelemetry();
    this.practiceScope = '';
    this.practiceWordIds = [];
    this.practiceCompletedWordIds = new Set();
    this.practiceProgress = null;
    this.practiceMissingCount = 0;
    const session = requestedScope ? readPracticeSession() : null;
    if (requestedScope && (!session || session.scope !== requestedScope)) {
      this.renderInvalidPracticeSession(container, '这次专项练习已失效或与当前入口不一致，请从我的词汇重新开始。');
      return;
    }

    let practiceWords = null;
    if (requestedScope) {
      const currentWordIds = [...new Set(session.wordIds.map(id => Number(id)).filter(Number.isFinite))];
      const expectedWordIds = [...new Set((session.expectedWordIds?.length ? session.expectedWordIds : currentWordIds)
        .map(id => Number(id)).filter(Number.isFinite))];
      const currentSet = new Set(currentWordIds);
      const loadedWords = (await DB.getLearnWordsByIds(expectedWordIds))
        .map(word => ({ ...word, expectedRevision: Math.max(0, Number(word.reviewRevision) || 0) }));
      this.practiceMissingCount = expectedWordIds.length - loadedWords.length;
      this.practiceWordIds = expectedWordIds.filter(id => loadedWords.some(word => Number(word.id) === id));
      if (!loadedWords.length) {
        clearPracticeSession();
        this.renderInvalidPracticeSession(container, '这组单词已不在我的词汇中，未产生完成记录。请返回我的词汇重新选择。');
        return;
      }
      this.practiceScope = requestedScope;
      try {
        this.practiceProgress = await getPracticeProgress({
          db: DB,
          scope: requestedScope,
          wordIds: this.practiceWordIds,
          now: Date.now()
        });
        this.practiceCompletedWordIds = new Set(this.practiceProgress.completedWordIds);
      } catch {
        // Progress is auxiliary UI state. A temporary read failure must not
        // make the practice card itself unavailable.
        this.practiceProgress = {
          scope: requestedScope,
          completedWordIds: [],
          completedCount: 0,
          totalCount: this.practiceWordIds.length,
          remainingCount: this.practiceWordIds.length,
          done: false
        };
      }
      practiceWords = loadedWords.filter(word => currentSet.has(Number(word.id)));
      if (!session.reviewAll) {
        practiceWords = practiceWords.filter(word => !this.practiceCompletedWordIds.has(Number(word.id)));
      }
      if (!practiceWords.length) {
        this.renderResult(container);
        return;
      }
    }
    const allWords = practiceWords ?? await DB.getAllLearnWords();
    const dueWords = practiceWords ?? await ReviewQueue.getDueWords({ words: allWords });
    this.wordCache = new Map(allWords.map(word => [Number(word.id), { ...word, expectedRevision: Math.max(0, Number(word.expectedRevision ?? word.reviewRevision) || 0) }]));
    let persistedSession = null;
    if (!requestedScope) {
      persistedSession = await (DB.getReviewSession
        ? DB.getReviewSession(ACTIVE_SESSION_KEY).catch(() => null)
        : null);
    }
    this.reviewMetrics = createReviewSessionMetrics({
      // 练习续练的结果页只统计本次实际展示的词；整组完成进度仍由
      // practiceCompletedWordIds/practiceWordIds 单独维护。
      originalWordIds: this.practiceScope
        ? practiceWords.map(word => word.id)
        : dueWords.map(word => word.id),
      snapshot: persistedSession?.reviewSessionMetrics || null
    });

    if (dueWords.length === 0) {
      const totalWords = allWords.length;
      const masteredCount = allWords.filter(w => SpacedRepetition.getStatus(w) === 'stable').length;
      container.innerHTML = `
        <section class="app-standard-page flashcard-review-shell flashcard-review-shell--empty" aria-labelledby="flashcardContentTitle">
          <div class="flashcard-container flashcard-content" data-flashcard-content="empty">
          <h2 id="flashcardContentTitle" class="sr-only">单词复习内容</h2>
          <div class="empty-state flashcard-empty-sheet">
            <p>🎉 暂时没有需要复习的单词</p>
            ${totalWords > 0 ? `<p>共 ${totalWords} 个单词，${masteredCount} 个进入长期巩固</p>` : ''}
            <p>去阅读页面收藏新单词，或导入单词到我的词汇。</p>
            <div style="display:flex;gap:12px;justify-content:center;margin-top:16px">
              <a href="#/chat" class="btn btn-primary">去阅读</a>
              <a href="#/vocab" class="btn btn-outline">我的词汇</a>
            </div>
          </div>
          </div>
        </section>`;
      return;
    }

    if (this.practiceScope) {
      this.sessionQueue = null;
    } else {
      const restored = await loadSessionQueue({ db: DB });
      if (restored && !restored.isEmpty()) {
        this.sessionQueue = restored;
      } else {
        if (restored) await clearSessionQueue({ db: DB });
        this.sessionQueue = createSessionQueue(dueWords.map(word => word.id));
        this.persistCurrentSession();
      }
    }
    this.words = dueWords;
    this.currentIndex = 0;
    this.ratingCounts = { 1: 0, 3: 0, 5: 0 };
    this.reviewedWords = [];
    this.startReviewTimer({ practiceSession: session, persistedSession: requestedScope ? null : persistedSession });

    this.renderCard(container);
  },

  renderInvalidPracticeSession(container, message) {
    container.innerHTML = `
      <section class="app-standard-page flashcard-review-shell flashcard-review-shell--empty" aria-labelledby="flashcardContentTitle">
        <div class="flashcard-container flashcard-content" data-flashcard-content="invalid-practice">
          <h2 id="flashcardContentTitle" class="sr-only">专项练习不可用</h2>
          <div class="empty-state flashcard-empty-sheet">
            <p>${esc(message)}</p>
            <p>没有任何单词被计为完成，正式复习计划也没有改变。</p>
            <div style="display:flex;gap:12px;justify-content:center;margin-top:16px">
              <a href="#/vocab" class="btn btn-primary">返回我的词汇</a>
              <a href="#/vocab" class="btn btn-outline">我的词汇</a>
            </div>
          </div>
        </div>
      </section>`;
  },

  // Check how many words are due
  async getDueCount() {
    const allWords = await DB.getAllLearnWords();
    return SpacedRepetition.getDueCount(allWords);
  },

  persistCurrentSession() {
    if (!this.sessionQueue) return null;
    const span = diagnosticLogger()?.beginSpan('review.session_persist', {
      category: 'review',
      correlationId: this.ratingCorrelationId || undefined,
      payload: { pendingCount: this.sessionQueue.getPendingCount?.() || 0 }
    });
    try {
      const result = this.reviewPersistence?.enqueueSession({
        key: ACTIVE_SESSION_KEY,
        snapshot: {
          ...this.sessionQueue.snapshot(),
          reviewSessionMetrics: this.reviewMetrics.snapshot()
        }
      });
      if (!result) throw new Error('复习会话后台保存不可用');
      span?.end({ payload: { ok: true, queued: true, sequence: result.sequence } });
      return result;
    } catch (error) {
      span?.end({
        level: 'error',
        payload: { ok: false, queued: false, errorName: error?.name || 'Error' }
      });
      // localStorage/journal may be unavailable in privacy mode. Keep the
      // original direct save as a last-resort async path without blocking the
      // card transition or creating an unhandled rejection.
      void persistSessionQueue(this.sessionQueue, { db: DB })
        .catch(saveError => diagnosticLogger()?.record('review.session_save_failed', {
          category: 'review',
          level: 'error',
          correlationId: this.ratingCorrelationId || undefined,
          payload: { errorName: saveError?.name || 'Error', fallback: true }
        }));
      return { accepted: false, fallback: true, error };
    }
  },

  // Render a single word at the start of its recall phase.
  async renderCard(container) {
    this.cleanupExampleWordLookup();
    this.cancelCardPronunciation();
    const session = ++this.cardSession;
    if (!this.practiceScope && this.sessionQueue) {
      if (this.sessionQueue.isEmpty()) {
        this.renderResult(container);
        return;
      }
      const wordId = this.sessionQueue.next();
      this.persistCurrentSession();
      let queuedWord = this.wordCache.get(Number(wordId)) || null;
      if (!queuedWord) {
        // This is only a recovery path for a stale/missing in-memory snapshot;
        // ordinary card changes never perform this read or revalidation.
        const revisionCheck = await ReviewQueue.revalidate({
          id: wordId,
          expectedRevision: this.sessionQueue.getExpectedRevision(wordId)
        });
        queuedWord = revisionCheck.current ? revisionCheck.word : null;
      }
      if (!queuedWord) {
        this.currentIndex += 1;
        return this.renderCard(container);
      }
      const queuedRevision = Math.max(0, Number(queuedWord.expectedRevision ?? queuedWord.reviewRevision) || 0);
      const bufferRevision = this.sessionQueue.getExpectedRevision(wordId);
      this.words[this.currentIndex] = { ...queuedWord, expectedRevision: bufferRevision ?? queuedRevision };
      this.wordCache.set(Number(wordId), { ...this.words[this.currentIndex] });
      this.sessionQueue.syncExpectedRevision(wordId, this.words[this.currentIndex].expectedRevision);
    } else if (this.currentIndex >= this.words.length) {
      this.renderResult(container);
      return;
    }

    let word = this.words[this.currentIndex] || this.wordCache.get(Number(this.words[this.currentIndex]?.id));
    if (!word) {
      this.renderResult(container);
      return;
    }
    word = { ...word };
    this.words[this.currentIndex] = word;
    this.wordCache.set(Number(word.id), word);
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

    const definitionLines = getDefinitionDisplayLines(word);
    const translation = definitionLines[0]?.glossZh || getSavableTranslation(word) || '暂无翻译';
    const phonetic = formatPhonetic(word.phonetic);

    if (session !== this.cardSession) return;
    this.currentTranslation = translation;
    this.currentPhonetic = phonetic;
    this.currentDefinitionLines = definitionLines;
    this.renderRecall(container);
    diagnosticLogger()?.record('review.card_rendered', {
      category: 'review',
      correlationId: this.ratingCorrelationId || undefined,
      payload: { phase: 'recall' },
      detail: { word: word.word, scope: this.practiceScope || 'scheduled' }
    });
    this.noteReviewActivity();
    this.startCardPronunciation(word.word, session);
    void this.hydrateWordDefinition(word, session);
  },

  async hydrateWordDefinition(word, session) {
    if (!word?.id) return;
    const enriched = await ensureSavedWordDefinition(word, {
      lookup: Dictionary.lookup.bind(Dictionary),
      update: DB.updateLearnWordDefinition.bind(DB)
    }).catch(() => word);
    if (session !== this.cardSession || !this.container) return;
    const current = this.words[this.currentIndex];
    if (!current || Number(current.id) !== Number(word.id)) return;
    const updated = { ...enriched, expectedRevision: current.expectedRevision };
    this.words[this.currentIndex] = updated;
    this.wordCache.set(Number(updated.id), updated);
    const definitionLines = getDefinitionDisplayLines(updated);
    this.currentTranslation = definitionLines[0]?.glossZh || getSavableTranslation(updated) || '暂无翻译';
    this.currentPhonetic = formatPhonetic(updated.phonetic);
    this.currentDefinitionLines = definitionLines;
    if (this.reviewState.phase === REVIEW_PHASES.RECALL) this.renderRecall(this.container);
    if (this.reviewState.phase === REVIEW_PHASES.STUDY) this.renderStudy(this.container);
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
    const isPractice = Boolean(this.practiceScope);
    const metrics = this.reviewMetrics.summary();
    const total = isPractice ? this.practiceWordIds.length : metrics.total;
    const completed = isPractice
      ? Math.min(total, this.practiceCompletedWordIds.size)
      : metrics.mastered;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
    const countLabel = isPractice
      ? `${completed} / ${total}`
      : `已学会 ${metrics.mastered} / ${metrics.total}`;
    return `
      <div class="flashcard-progress-block">
      <div class="flashcard-progress">
        <span class="page-eyebrow">03 / ${phase}</span>
        <span class="flashcard-progress-count">${countLabel}</span>
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
    this.noteReviewActivity();
    this.reviewState = nextState;
    this.renderRecall(this.container);
  },

  async submitRating(quality) {
    const submittingState = startRating(this.reviewState, quality);
    if (!submittingState) return;
    this.noteReviewActivity();

    const session = this.cardSession;
    const word = this.words[this.currentIndex];
    const correlationId = diagnosticCorrelationId();
    this.ratingCorrelationId = correlationId;
    const logger = diagnosticLogger();
    logger?.record('review.rating_clicked', {
      category: 'review',
      correlationId,
      payload: { quality, mode: this.practiceScope ? 'practice' : 'scheduled' },
      detail: { word: word?.word, scope: this.practiceScope || 'scheduled' }
    });
    logger?.record('review.rating_save_start', {
      category: 'review',
      correlationId,
      payload: { quality, mode: this.practiceScope ? 'practice' : 'scheduled' }
    });
    const saveSpan = logger?.beginSpan('review.rating_save', {
      category: 'review',
      correlationId,
      payload: { quality, mode: this.practiceScope ? 'practice' : 'scheduled' }
    });
    this.reviewState = submittingState;
    this.renderRecall(this.container);

    try {
      const ratingAcceptance = await this.recordRating(quality, { correlationId });
      saveSpan?.end({ payload: { ok: true } });
      logger?.record('review.ui_responded', {
        category: 'review',
        correlationId,
        payload: {
          quality,
          mode: this.practiceScope ? 'practice' : 'scheduled',
          persistence: ratingAcceptance?.persistence || 'unknown'
        }
      });
      logger?.record('review.rating_accepted', {
        category: 'review',
        correlationId,
        payload: {
          quality,
          mode: this.practiceScope ? 'practice' : 'scheduled',
          persistence: ratingAcceptance?.persistence || 'unknown'
        }
      });
    } catch (error) {
      saveSpan?.end({
        level: 'error',
        payload: { ok: false, errorName: error?.name || 'Error' }
      });
      logger?.record('review.rating_save_failed', {
        category: 'review',
        level: 'error',
        correlationId,
        payload: { quality, errorName: error?.name || 'Error' }
      });
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
    logger?.record('review.study_rendered', {
      category: 'review',
      correlationId,
      payload: { phase: 'study', quality }
    });
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
            ${this.renderStudyNotice()}
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

  renderStudyNotice() {
    if (!this.studyNotice) return '';
    const retryable = this.studyNotice.includes('暂未保存') || this.studyNotice.includes('保存失败');
    return `<p class="flashcard-correction-notice" role="status">${esc(this.studyNotice)}${retryable ? ' <button class="flashcard-save-retry" type="button" onclick="FlashcardView.retryPendingRatings()">重试保存</button>' : ''}</p>`;
  },

  async retryPendingRatings() {
    if (!this.reviewPersistence?.retryFailed) return;
    this.studyNotice = '正在重试保存…';
    if (this.reviewState.phase === REVIEW_PHASES.STUDY) this.renderStudy(this.container);
    try {
      const status = await this.reviewPersistence.retryFailed();
      if (!status.rating.failed) this.studyNotice = '已重新提交保存';
      else this.studyNotice = '仍有评分未保存，请稍后再次重试。';
    } catch {
      this.studyNotice = '保存重试失败，请稍后再次重试。';
    }
    if (this.container && this.reviewState.phase === REVIEW_PHASES.STUDY) this.renderStudy(this.container);
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
    this.noteReviewActivity();
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
        this.noteReviewActivity();
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
        this.noteReviewActivity();
        this.selectStudyExample(this.studyExampleIndex + 1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        this.noteReviewActivity();
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
    this.noteReviewActivity();
    this.studyExampleIndex = nextIndex;
    this.renderStudy(this.container);
  },

  showAllStudyExamples() {
    this.noteReviewActivity();
    this.studyExamplesExpanded = true;
    this.renderStudy(this.container);
  },

  showFocusedStudyExample() {
    this.noteReviewActivity();
    this.studyExamplesExpanded = false;
    this.renderStudy(this.container);
  },

  openStudyInfo() {
    const overlay = this.container?.querySelector('[data-study-info-overlay]');
    if (!overlay) return;
    this.noteReviewActivity();
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
    this.noteReviewActivity();
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
    this._exampleWordLookupCleanup = bindLearningTextLookup({
      root,
      closeBeforeLookup: false,
      getContextSentence: event => event.target?.closest?.('[data-example-text]')?.textContent || '',
      getTargetTrack: () => Config.get('exam_level') || '',
      lookupContext: { source: 'flashcard-study' }
    });
  },

  cleanupExampleWordLookup() {
    this._exampleWordLookupCleanup?.();
    this._exampleWordLookupCleanup = null;
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
    this.noteReviewActivity();
    this.commitPendingKnowledgeEvidence();
    if (!this.practiceScope && this.sessionQueue) {
      // A completed rating normally clears the active card in rate(). Keep
      // this defensive call so an explicit “next”/restored session cannot
      // leave the displayed card stranded in the checkpoint.
      this.sessionQueue.completeActive?.(this.words[this.currentIndex]?.id);
      this.currentIndex++;
      this.persistCurrentSession();
    } else {
      this.currentIndex++;
    }
    this.renderCard(this.container);
  },

  restart() {
    if (this.practiceScope) return;
    if (!this.practiceScope) {
      void clearSessionQueue({ db: DB });
      this.sessionQueue = null;
    }
    this.render(this.container, this.practiceScope || '');
  },

  // Record a rating
  async recordRating(quality, { correlationId = this.ratingCorrelationId } = {}) {
    const logger = diagnosticLogger();
    const word = this.words[this.currentIndex];
    let persistenceMode = this.practiceScope ? 'indexeddb-direct' : 'durable-journal';
    const meaningRevealed = Boolean(this.reviewState.meaningRevealed);
    const attempt = {
      id: `flashcard:${this.cardSession}:${word.id}:${Date.now()}`,
      baseline: { ...word },
      initialQuality: quality
    };
    let sessionResultRecorded = false;
    if (this.practiceScope) {
      const practiceSpan = logger?.beginSpan('review.practice_transaction', {
        category: 'review',
        correlationId,
        payload: { quality, scope: this.practiceScope }
      });
      try {
        await DB.recordLearnWordPractice(word.id, {
          rating: quality,
          sawAnswer: meaningRevealed,
          practiceScope: this.practiceScope
        });
        practiceSpan?.end({ payload: { ok: true } });
      } catch (error) {
        practiceSpan?.end({
          level: 'error',
          payload: { ok: false, errorName: error?.name || 'Error' }
        });
        throw error;
      }
      this.practiceCompletedWordIds.add(Number(word.id));
      this.updatePracticeProgress();
    } else {
      const expectedRevision = Math.max(0, Number(word.expectedRevision ?? word.reviewRevision) || 0);
      const outcome = this.sessionQueue?.rate(word.id, quality, {
        expectedRevision,
        now: Date.now()
      }) || { reinserted: false, stubborn: false };
      this.sessionQueue?.completeActive?.(word.id);
      const sessionDebt = this.sessionQueue?.getDebt(word.id) || 0;
      const srsData = settleSessionReview(attempt.baseline, quality, sessionDebt);
      const optimisticWord = {
        ...word,
        ...srsData,
        reviewRevision: expectedRevision + 1,
        expectedRevision: expectedRevision + 1
      };
      Object.assign(word, optimisticWord);
      this.wordCache.set(Number(word.id), { ...word });
      this.sessionQueue?.syncExpectedRevision(word.id, optimisticWord.expectedRevision);
      this.recordRecoveryTransition(attempt.baseline, optimisticWord, outcome.stubborn);
      const srsSpan = logger?.beginSpan('review.srs_transaction', {
        category: 'db',
        correlationId,
        payload: { quality, sessionDebt }
      });
      const event = {
        rating: quality,
        source: 'flashcard',
        sawAnswer: meaningRevealed,
        attemptId: attempt.id,
        expectedRevision,
        sessionDebt,
        correlationId
      };
      try {
        const queued = this.reviewPersistence?.enqueueRating({
          operationId: attempt.id,
          attemptId: attempt.id,
          wordId: word.id,
          expectedRevision,
          srsData,
          event,
          correlationId
        });
        if (!queued) throw new Error('正式复习后台保存不可用');
        srsSpan?.end({ payload: { ok: true, queued: true } });
      } catch (error) {
        // If the durable journal cannot be written, fall back to the old
        // awaited transaction so a rating is never acknowledged without a
        // local recovery path.
        persistenceMode = 'indexeddb-fallback';
        try {
          const updatedWord = await DB.settleSessionReview(word.id, srsData, { ...event }, {
            expectedRevision,
            attemptId: attempt.id,
            correlationId
          });
          Object.assign(word, updatedWord || optimisticWord, {
            expectedRevision: updatedWord?.reviewRevision ?? optimisticWord.expectedRevision
          });
          this.wordCache.set(Number(word.id), { ...word });
          srsSpan?.end({ payload: { ok: true, queued: false, fallback: true } });
        } catch (fallbackError) {
          srsSpan?.end({
            level: 'error',
            payload: { ok: false, fallback: true, errorName: fallbackError?.name || error?.name || 'Error' }
          });
          throw fallbackError;
        }
      }
      if (this.sessionQueue) {
        // Count the accepted rating before a weak answer takes the reinsert
        // path below. The queue controls exposures; metrics control results.
        this.recordAcceptedRating(word, quality, attempt);
        sessionResultRecorded = true;
        this.persistCurrentSession();
        if (outcome.reinserted) {
          this.reviewState = finishRating(this.reviewState);
          this.renderStudy(this.container);
          this.loadStudyDetails(this.cardSession);
          return { persistence: persistenceMode };
        }
      }
    }
    if (!sessionResultRecorded) this.recordAcceptedRating(word, quality, attempt);
    this.ratingAttempt = attempt;
    this.pendingKnowledgeEvidence = {
      word: word.word,
      quality,
      meaningRevealed,
      attemptId: attempt.id,
      contextId: `flashcard-card:${this.cardSession}`
    };

    return { persistence: persistenceMode };
  },

  async correctMistakenKnown() {
    const correctingState = startRatingCorrection(this.reviewState);
    const attempt = this.ratingAttempt;
    if (!correctingState || !attempt) return;
    this.noteReviewActivity();

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
        this.practiceCompletedWordIds.add(Number(word.id));
        this.updatePracticeProgress();
      } else {
        const sessionDebt = (this.sessionQueue?.getDebt(word.id) || 0) + sessionDebtValue(1);
        const correctedSrs = settleSessionReview(attempt.baseline, 1, sessionDebt);
        // The original rating is journaled asynchronously. Flush it before
        // the in-place correction so the audit event exists, then use the
        // dedicated correction API (a correction is not a second attempt).
        await this.reviewPersistence?.flush({ timeoutMs: 5000 });
        const correctedWord = await DB.correctLearnWordReview(word.id, correctedSrs, {
          attemptId: attempt.id,
          expectedRevision: Math.max(0, Number(word.reviewRevision) || 0),
          sawAnswer: true,
          correctionReason: 'mistaken-known'
        });
        this.recordRecoveryTransition(attempt.baseline, correctedWord || correctedSrs, this.sessionQueue?.isStubborn(word.id));
        Object.assign(word, correctedWord || correctedSrs, { expectedRevision: correctedWord?.reviewRevision ?? word.expectedRevision });
        this.wordCache.set(Number(word.id), { ...word });
        if (this.sessionQueue) {
          const outcome = this.sessionQueue.rate(word.id, 1, { expectedRevision: word.expectedRevision });
          this.recordCorrectedRating(word, attempt);
          this.persistCurrentSession();
          if (outcome.reinserted) {
            this.reviewState = finishRatingCorrection(this.reviewState);
            this.studyNotice = '已更正为“忘了”，将隔 3 个词后再次出现。';
            this.renderStudy(this.container);
            return;
          }
        }
      }
      if (session !== this.cardSession) return;

      if (!this.sessionQueue) this.recordCorrectedRating(word, attempt);
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
    this.noteReviewActivity();
    this.skippedCount += 1;
    if (!this.practiceScope && this.sessionQueue) {
      this.sessionQueue.completeActive?.(this.words[this.currentIndex]?.id);
    }
    this.currentIndex++;
    this.renderCard(this.container);
  },

  // Render completion result
  renderResult(container) {
    const isPractice = Boolean(this.practiceScope);
    const completedPracticeScope = this.practiceScope;
    this.invalidateCardRequests();
    if (!isPractice) {
      // Completion must not wait for storage. clearSession() also protects
      // against a checkpoint that was already in flight when the last card
      // was advanced.
      const clear = this.reviewPersistence?.clearSession
        ? this.reviewPersistence.clearSession({ key: ACTIVE_SESSION_KEY })
        : clearSessionQueue({ db: DB });
      void Promise.resolve(clear).catch(() => {});
    }
    const practiceCompleted = isPractice && finalizePracticeSession({
      scope: completedPracticeScope,
      expectedWordIds: this.practiceWordIds,
      completedWordIds: [...this.practiceCompletedWordIds]
    });
    void this.persistReviewSummary('completed', practiceCompleted);
    if (practiceCompleted) this.practiceScope = '';
    const metrics = this.reviewMetrics.summary();
    const total = metrics.total;
    const accuracy = metrics.masteryRate;
    const practiceRemaining = isPractice
      ? this.practiceWordIds.filter(id => !this.practiceCompletedWordIds.has(Number(id))).length
      : 0;
    // Today's accumulated words (across multiple review sessions)
    const todayWords = this.loadTodayWords();
    const todayTotal = todayWords.length;
    const todayForgot = todayWords.filter(w => (w.weakestQuality ?? w.quality) === 1).map(w => w.word);
    const todayFuzzy = todayWords.filter(w => (w.weakestQuality ?? w.quality) === 3).map(w => w.word);
    const todayReinforce = [...todayForgot, ...todayFuzzy];
    const canGenerate = todayTotal >= 3;

    container.innerHTML = `
      <main class="app-standard-page flashcard-review-shell flashcard-review-shell--result" aria-labelledby="flashcardResultTitle">
      <div class="flashcard-container">
        <section class="flashcard-result flashcard-result-sheet">
          <h2 id="flashcardResultTitle">${isPractice ? (practiceCompleted ? '专项练习完成' : '专项练习已结束') : '复习完成'}</h2>
          ${isPractice
            ? `<p class="flashcard-result-hint">${practiceCompleted
              ? '本轮全部单词已评分并记录完成。'
              : `还有 ${practiceRemaining} 个词未评分，本轮未标记完成。`}专项练习不影响正式复习计划。${this.practiceMissingCount > 0 ? ` ${this.practiceMissingCount} 个已从我的词汇移出的词已跳过。` : ''}</p>`
            : ''}
          <div class="flashcard-result-stats">
            <div class="flashcard-result-stat">
              <span class="flashcard-result-num">${total}</span>
              <span class="flashcard-result-label">总复习</span>
            </div>
            <div class="flashcard-result-stat">
              <span class="flashcard-result-num" style="color:var(--success)">${metrics.known}</span>
              <span class="flashcard-result-label">认识</span>
            </div>
            <div class="flashcard-result-stat">
              <span class="flashcard-result-num" style="color:var(--warning)">${metrics.uncertain}</span>
              <span class="flashcard-result-label">模糊</span>
            </div>
            <div class="flashcard-result-stat">
              <span class="flashcard-result-num" style="color:var(--danger)">${metrics.unknown}</span>
              <span class="flashcard-result-label">忘记</span>
            </div>
          </div>
          <div class="flashcard-result-accuracy">
            本轮学会率：${accuracy}%
          </div>
          <p class="flashcard-result-hint">
            ${accuracy >= 80 ? '💪 表现很好！继续保持。' : accuracy >= 50 ? '📖 还需要多复习，加油！' : '🔄 建议降低复习难度，循序渐进。'}结果按每个词本轮最弱一次评分归类；学会以至少一次“认识”为准。
          </p>

          ${!isPractice ? '<div class="review-persistence-status" data-review-persistence-status data-status="saving" role="status" aria-live="polite"></div>' : ''}

          ${todayTotal > metrics.rated ? `
          <div class="flashcard-result-today">
            📅 今日累计复习：<strong>${todayTotal}</strong> 个单词（本轮 ${metrics.rated} 个）
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
            <a href="${isPractice ? '#/vocab' : '#/chat'}" class="btn btn-outline">${isPractice ? '返回我的词汇' : '返回阅读'}</a>
            <a href="#/vocab" class="btn btn-outline">词汇管理</a>
            ${isPractice ? '' : '<button class="btn btn-outline" onclick="FlashcardView.restart()">再来一轮</button>'}
          </div>
        </section>
      </div>
      </main>`;

    if (!isPractice) {
      this._resultPersistenceRetrying = false;
      this.updateResultPersistenceStatus();
      try {
        const pendingFlush = this.reviewPersistence?.flush?.({ timeoutMs: 5000 });
        void Promise.resolve(pendingFlush)
          .then(() => this.updateResultPersistenceStatus())
          .catch(() => this.updateResultPersistenceStatus());
      } catch {
        this.updateResultPersistenceStatus();
      }
    }
  },

  invalidateCardRequests() {
    this.cardSession++;
    this.cancelCardPronunciation();
    this.cancelPhraseRequest();
    this.cancelSimilarRequest();
    this.cancelRootRequest();
    this.cleanupExampleWordLookup();
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
      words = todayWords.filter(w => (w.weakestQuality ?? w.quality) <= 3).map(w => w.word);
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
    this.invalidateCardRequests();
    void this.persistReviewSummary('partial');
    this._reviewPersistenceUnsubscribe?.();
    this._reviewPersistenceUnsubscribe = null;
    void this.reviewPersistence?.flush?.({ timeoutMs: 1500 }).catch(() => {});
    this.closeStudyInfo();
    this.practiceScope = '';
    this.practiceWordIds = [];
    this.practiceCompletedWordIds = new Set();
    this.practiceProgress = null;
    this.practiceMissingCount = 0;
    if (this._studyExampleKeyHandler) {
      document.removeEventListener('keydown', this._studyExampleKeyHandler);
      this._studyExampleKeyHandler = null;
    }
  }
};

window.FlashcardView = FlashcardView;
