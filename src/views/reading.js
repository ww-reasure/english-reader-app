/**
 * Reading View
 * Article reading with auto-timer, word lookup, and completion summary
 */

import { DB } from '../db.js';
import { DIFFICULTY_LABELS, esc, escAttr, getStemForm, ReadingTimer } from '../helpers.js';
import { Tooltip } from '../components/tooltip.js';
import { AIAnalysis } from '../components/ai-analysis.js';
import { AudioCache } from '../audio-cache.js';
import { Config, ARTICLE_SERVER_URL } from '../config.js';
import { Modal } from '../components/modal.js';
import { API } from '../api.js';
import { ChatView } from './chat.js';
import { SpacedRepetition } from '../spaced-repetition.js';
import { settleSessionReview } from '../recovery-scheduler.mjs';
import { normalizeTargetWords } from '../components/article-generation-tool.js';
import { createKnowledgeProfileRepository } from '../knowledge-profile.mjs';
import { applyReadingEaseFeedback, evaluateReadingSession } from '../calibration-engine.mjs';
import { createLexiconLoader } from '../lexicon-runtime.mjs';
import { createKnowledgeEvidenceBridge } from '../components/knowledge-evidence-bridge.mjs';
import { requiresTargetTrackSelection } from '../learning-track.mjs';
import { getDefinitionSenses, getSavableTranslation } from '../components/definition-trust.mjs';
import { DEFINITION_SCHEMA_VERSION } from '../components/saved-word-definition.mjs';
import { SentenceGuide } from '../components/sentence-guide.js';
import { resolveArticleTrack } from '../cloud-article-metadata.mjs';
import { buildExactWordFormIndex, renderExactWordMarking, renderPhraseAwareMarking, matchKeyPhraseAt } from '../components/word-marking.mjs';
import { KeyPhraseLibrary } from '../key-phrase-library.mjs';
import { scheduleAfterFirstPaint } from '../first-paint-scheduler.mjs';
import { bindLearningTextLookup, getContextSentenceAtPoint } from '../components/reading-word-lookup.js';
import { exportArticlePdf } from '../components/article-pdf.mjs';
import { splitSentences } from '../components/sentence-selection.mjs';
import { localDayKey } from '../learning-day.mjs';
import { ActivityType } from '../learning-activity.mjs';
import {
  contentFingerprint,
  createReadingProgressSession,
  formatReadingDuration,
  normalizeReadingProgress
} from '../reading-progress.mjs';
import { createReadingActivityTracker } from '../reading-activity.mjs';

const knowledgeEvidenceBridge = createKnowledgeEvidenceBridge({
  lexiconLoader: createLexiconLoader(),
  storage: DB
});
const readingLexiconLoader = createLexiconLoader();

function diagnosticLogger() {
  return globalThis.__englishReaderDiagnosticLogger || null;
}

export const ReadingView = {
  timer: null,
  articleData: null,
  clickedWords: [],
  cycleReviewRatings: [],
  reviewMode: false,
  reviewWordsMap: new Map(), // stem -> word data
  learningWordsMap: new Map(),
  learningWords: [],
  learningWordFormIndex: new Map(),
  reviewWordFormIndex: new Map(),
  wordMarkingSession: 0,
  wordMarkingEnabled: false,
  phraseHighlightingEnabled: false,
  keyPhraseMatcher: null,
  englishParagraphs: [],
  paragraphTranslations: [], // 按英文段落索引对齐，允许书架文章乱序按段翻译
  guideSentences: [],
  guideVisited: new Set(),
  guideIndex: 0,
  guidePayload: null,
  guideError: '',
  guideSession: 0,
  guideAbortController: null,
  guideModeUsed: false,
  sentenceSegmentsByParagraph: [],
  sentenceColorsEnabled: false,
  readingMode: 'full',
  readingProgress: null,
  readingProgressSession: null,
  persistedGuideVisited: new Set(),
  sessionGuideVisited: new Set(),
  readingProgressFinalizing: false,
  readingProgressSaveStatus: null,
  readingProgressCompletion: null,
  readingCompletionSummary: null,
  readingActivityTracker: null,
  readingActivitySaveStatus: null,
  readingActivityCompletionPending: false,
  incompleteReadingQualification: null,
  readingUserScrollProgress: 0,
  _guideWordLookupCleanup: null,
  _viewportResizeHandler: null,
  _viewportResizeFrame: null,
  _learningActivitySequence: 0,
  _pagehideHandler: null,
  _readingActionsKeydownHandler: null,

  goBack() {
    if (window.Router?.back?.()) return;
    history.back();
  },

  _getParagraphTranslations(article, enParas) {
    // 新格式保存稀疏数组，避免“先翻第3段”后刷新时发生段落错配
    if (Array.isArray(article.paragraphTranslations)) {
      return enParas.map((_, i) => article.paragraphTranslations[i] || '');
    }
    // 兼容 AI 生成文章的旧全文 translation（通常是连续完整段落）
    const legacy = this._splitParas(article.translation);
    return enParas.map((_, i) => legacy[i] || '');
  },

  _syncTranslationText() {
    return this.paragraphTranslations.join('\n\n');
  },

  // 安全切段：防空崩溃。云端已清洗杂段,这里只做防空,保留所有 \n\n 段(含真小标题)
  _splitParas(content) {
    return (content || '').split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  },

  _splitGuideSentences(paragraph) {
    return splitSentences(paragraph).filter(segment => /[a-z]/i.test(segment.text));
  },

  _renderGuideSource(sentence) {
    const source = String(sentence || '');
    // 与 word-marking.mjs 的 TOKEN_PATTERN 保持一致（含 en dash –），避免两个表面分词漂移。
    const tokenPattern = /[A-Za-z]+(?:['’–-][A-Za-z]+)*/gu;
    const matches = [...source.matchAll(tokenPattern)];
    const matcher = this.phraseHighlightingEnabled ? this.keyPhraseMatcher : null;
    let cursor = 0;
    let html = '';
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      const start = match.index ?? cursor;
      html += esc(source.slice(cursor, start));
      const hit = matcher ? matchKeyPhraseAt(matcher, matches, index, source) : null;
      if (hit) {
        const last = matches[index + hit.tokenCount - 1];
        const end = last.index + last[0].length;
        let inner = '';
        let innerCursor = start;
        for (let step = 0; step < hit.tokenCount; step += 1) {
          const tokenMatch = matches[index + step];
          inner += esc(source.slice(innerCursor, tokenMatch.index));
          inner += `<span class="sentence-guide-word" data-word-lookup-token="${escAttr(tokenMatch[0])}" role="button" tabindex="0" title="点击查词">${esc(tokenMatch[0])}</span>`;
          innerCursor = tokenMatch.index + tokenMatch[0].length;
        }
        const gloss = hit.entry?.glossZh || '';
        html += `<span class="key-phrase" data-key-phrase-id="${escAttr(hit.id)}"${gloss ? ` title="${escAttr(gloss)}"` : ''}>${inner}</span>`;
        cursor = end;
        index += hit.tokenCount - 1;
        continue;
      }
      html += `<span class="sentence-guide-word" data-word-lookup-token="${escAttr(match[0])}" role="button" tabindex="0" title="点击查词">${esc(match[0])}</span>`;
      cursor = start + match[0].length;
    }
    return html + esc(source.slice(cursor));
  },

  _renderMarkedText(text) {
    if (this.phraseHighlightingEnabled && this.keyPhraseMatcher) {
      if (this.reviewMode) {
        return renderPhraseAwareMarking(text, this.keyPhraseMatcher, {
          wordIndex: this.reviewWordFormIndex,
          className: word => {
            const stem = word?.stem || getStemForm(word?.word || '');
            const wordData = this.reviewWordsMap.get(stem);
            const status = SpacedRepetition.getStatus(wordData);
            return status === 'new' ? 'review-word review-new' : 'review-word review-learning';
          },
          isActive: word => {
            const stem = word?.stem || getStemForm(word?.word || '');
            const wordData = this.reviewWordsMap.get(stem);
            if (!wordData) return false;
            return SpacedRepetition.getStatus(wordData) !== 'stable';
          }
        });
      }
      if (this.wordMarkingEnabled) {
        return renderPhraseAwareMarking(text, this.keyPhraseMatcher, {
          wordIndex: this.learningWordFormIndex,
          className: 'learning-word',
          isActive: word => {
            const stem = word?.stem || getStemForm(word?.word || '');
            const wordData = this.learningWordsMap.get(stem);
            if (!wordData) return false;
            const status = SpacedRepetition.getStatus(wordData);
            return status === 'new' || status === 'learning';
          }
        });
      }
      return renderPhraseAwareMarking(text, this.keyPhraseMatcher, {});
    }
    if (this.reviewMode) return this._highlightReviewWords(text);
    if (this.wordMarkingEnabled) return this._highlightLearningWords(text);
    return esc(text);
  },

  _renderParagraphContent(paragraphIndex) {
    const paragraph = String(this.englishParagraphs[paragraphIndex] || '');
    const segments = this.sentenceSegmentsByParagraph[paragraphIndex] || splitSentences(paragraph);
    if (!segments.length) return this._renderMarkedText(paragraph);
    let cursor = 0;
    let html = '';
    segments.forEach((segment, sentenceIndex) => {
      html += esc(paragraph.slice(cursor, segment.start));
      const colorClass = this.sentenceColorsEnabled ? ` sentence-color-${sentenceIndex % 4 + 1}` : '';
      html += `<span class="reading-sentence${colorClass}" data-sentence-index="${sentenceIndex}" data-sentence-start="${segment.start}" data-sentence-end="${segment.end}" data-sentence-text="${escAttr(segment.text)}">${this._renderMarkedText(segment.text)}</span>`;
      cursor = segment.end;
    });
    return html + esc(paragraph.slice(cursor));
  },

  _rerenderEnglishParagraphs() {
    this.container?.querySelectorAll?.('#articleBody .paragraph-pair').forEach((pair, index) => {
      const english = pair.querySelector?.('.en-paragraph');
      if (english && this.englishParagraphs[index] != null) english.innerHTML = this._renderParagraphContent(index);
    });
  },

  getSentenceGuideProgress() {
    if (!this.guideSentences.length) return 0;
    return Math.min(1, this.guideVisited.size / this.guideSentences.length);
  },

  _readingCompletionMarkerKey(articleId) {
    return `english-reader:reading-completion-pending:${String(articleId)}`;
  },

  _getReadingCompletionMarker(articleId) {
    try {
      const raw = globalThis.localStorage?.getItem(this._readingCompletionMarkerKey(articleId));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  _markReadingCompletionPending(snapshot) {
    try {
      globalThis.localStorage?.setItem(this._readingCompletionMarkerKey(snapshot.articleId), JSON.stringify({
        articleId: snapshot.articleId,
        contentFingerprint: snapshot.contentFingerprint,
        completionId: snapshot.completionId || null,
        updatedAt: snapshot.updatedAt
      }));
    } catch (error) {
      diagnosticLogger()?.record('reading.progress_completion_marker_failed', {
        category: 'reading',
        level: 'error',
        payload: { articleId: snapshot?.articleId, message: String(error?.message || error) }
      });
    }
  },

  _clearReadingCompletionPending(snapshot) {
    try {
      globalThis.localStorage?.removeItem(this._readingCompletionMarkerKey(snapshot.articleId));
    } catch (error) {
      diagnosticLogger()?.record('reading.progress_completion_marker_clear_failed', {
        category: 'reading',
        level: 'error',
        payload: { articleId: snapshot?.articleId, message: String(error?.message || error) }
      });
    }
  },

  async _loadReadingProgress(article, { isCurrent = () => true } = {}) {
    this.readingProgress = null;
    this.persistedGuideVisited = new Set();
    this.sessionGuideVisited = new Set();
    this.cycleReviewRatings = [];
    this.readingProgressFinalizing = false;
    this.readingProgressSaveStatus = null;
    this.readingProgressCompletion = null;
    this.readingCompletionSummary = null;
    this.readingActivityTracker = null;
    this.readingActivitySaveStatus = null;
    this.readingActivityCompletionPending = false;
    this.incompleteReadingQualification = null;
    const bodyFingerprint = contentFingerprint(article?.content || '');
    let stored = null;
    let completionCleanupError = null;
    try {
      stored = await DB.getReadingProgress(article.id);
    } catch (error) {
      diagnosticLogger()?.record('reading.progress_read_failed', {
        category: 'reading',
        level: 'error',
        payload: { articleId: article.id, message: String(error?.message || error) }
      });
    }
    if (!isCurrent()) return false;

    const completionMarker = this._getReadingCompletionMarker(article.id);
    if (completionMarker) {
      const storedIsNewerProgress = stored?.status === 'in_progress'
        && Number(stored.updatedAt) > Number(completionMarker.updatedAt || 0);
      if (storedIsNewerProgress) {
        // A newer in-progress snapshot is allowed to supersede a stale
        // completion marker left by an older app session.
        this._clearReadingCompletionPending({ articleId: article.id });
      } else {
        try {
          await DB.deleteReadingProgress(article.id);
          if (!isCurrent()) return false;
          this._clearReadingCompletionPending({ articleId: article.id });
          stored = null;
        } catch (error) {
          // A completed article must not be presented as resumable while its
          // cleanup is retried on a later open.
          stored = null;
          completionCleanupError = error;
          diagnosticLogger()?.record('reading.progress_completion_cleanup_retry_failed', {
            category: 'reading',
            level: 'error',
            payload: { articleId: article.id, message: String(error?.message || error) }
          });
        }
      }
    }

    if (stored?.status === 'completed_pending_cleanup') {
      try {
        await DB.deleteReadingProgress(article.id);
        if (!isCurrent()) return false;
        this._clearReadingCompletionPending({ articleId: article.id });
        stored = null;
      } catch (error) {
        // Terminal completion markers are never resumable.  Keep the marker
        // until a later open can retry deletion, but do not surface a resume
        // card for an article whose completion facts already exist.
        stored = null;
        completionCleanupError = error;
        diagnosticLogger()?.record('reading.progress_completion_cleanup_retry_failed', {
          category: 'reading',
          level: 'error',
          payload: { articleId: article.id, message: String(error?.message || error) }
        });
      }
    }

    const progress = normalizeReadingProgress(stored, {
      articleId: article.id,
      contentFingerprint: bodyFingerprint,
      totalSentences: this.guideSentences.length
    });
    if (stored && !progress && stored.contentFingerprint && stored.contentFingerprint !== bodyFingerprint) {
      try {
        await DB.deleteReadingProgress(article.id);
        if (!isCurrent()) return false;
      } catch (error) {
        diagnosticLogger()?.record('reading.progress_delete_failed', {
          category: 'reading',
          level: 'error',
          payload: { articleId: article.id, message: String(error?.message || error) }
        });
      }
    }

    if (!isCurrent()) return false;

    this.readingProgress = progress;
    this.persistedGuideVisited = new Set(progress?.guide?.visitedIndexes || []);
    this.sessionGuideVisited = new Set();
    this.guideVisited = new Set(this.persistedGuideVisited);
    if (completionCleanupError) {
      this.readingProgressCompletion = {
        factsRecorded: true,
        cleanupPending: true,
        error: completionCleanupError
      };
      // Do not create a normal session that could overwrite the terminal
      // snapshot before its cleanup succeeds.  The article remains viewable,
      // and retryReadingProgressCleanup() can operate without a session.
      this.readingProgressSession = null;
      return true;
    }
    this.readingProgressSession = createReadingProgressSession({
      articleId: article.id,
      content: article.content || '',
      persisted: progress,
      reviewMode: this.reviewMode,
      save: snapshot => DB.saveReadingProgress(snapshot),
      remove: id => DB.deleteReadingProgress(id),
      markCompletionPending: snapshot => this._markReadingCompletionPending(snapshot),
      clearCompletionPending: snapshot => this._clearReadingCompletionPending(snapshot),
      onError: error => diagnosticLogger()?.record('reading.progress_save_failed', {
        category: 'reading',
        level: 'error',
        payload: { articleId: article.id, message: String(error?.message || error) }
      })
    });
    this.cycleReviewRatings = this.readingProgressSession.getReviewRatings?.() || [];
    const completionId = this.readingProgressSession.getCompletionId?.();
    this.readingActivityTracker = createReadingActivityTracker({
      db: DB,
      articleId: article.id,
      articleTitle: article.title || '',
      completionId,
      onError: error => diagnosticLogger()?.record('reading.activity_save_failed', {
        category: 'reading',
        level: 'error',
        payload: { articleId: article.id, message: String(error?.message || error) }
      })
    });
    try {
      await this.readingActivityTracker.initialize();
    } catch (error) {
      // The tracker is best-effort during page setup.  An actual activity
      // write is still attempted at the next checkpoint or explicit exit.
      diagnosticLogger()?.record('reading.activity_initialize_failed', {
        category: 'reading',
        level: 'error',
        payload: { articleId: article.id, message: String(error?.message || error) }
      });
    }
    return isCurrent();
  },

  _isRenderCurrent(session, articleId, container) {
    return session === this.wordMarkingSession
      && this.articleData?.id === articleId
      && this.container === container;
  },

  _scheduleAfterFirstPaint(callback) {
    scheduleAfterFirstPaint(callback);
  },

  async _startPostPaintEnhancements({ article, container, session, learnWordsPromise }) {
    const isCurrent = () => this._isRenderCurrent(session, article.id, container);
    if (!isCurrent()) return;

    const progressTask = this._loadReadingProgress(article, { isCurrent }).then(loaded => {
      if (!loaded || !isCurrent()) return;
      const resumeHost = container.querySelector?.('[data-reading-resume-host]');
      if (resumeHost) resumeHost.innerHTML = this._renderResumeCard();
      this.autoStartTimer();
    });

    const vocabularyTask = (async () => {
      let learnWords = [];
      try {
        learnWords = await learnWordsPromise;
      } catch (error) {
        diagnosticLogger()?.record('reading.vocabulary_read_failed', {
          category: 'reading',
          level: 'error',
          payload: { articleId: article.id, message: String(error?.message || error) }
        });
      }
      if (!isCurrent()) return;
      this.learningWords = learnWords;
      learnWords.forEach(word => {
        const stem = getStemForm(String(word.word || '').toLowerCase());
        this.learningWordsMap.set(stem, word);
        if (this.reviewMode) this.reviewWordsMap.set(stem, word);
      });
      if (this.reviewMode || this.wordMarkingEnabled) {
        const exactWords = learnWords.map(word => ({
          ...word,
          stem: getStemForm(String(word.word || '').toLowerCase())
        }));
        const exactIndex = await buildExactWordFormIndex(exactWords, {
          loadCore: readingLexiconLoader.loadCore
        });
        if (!isCurrent()) return;
        this.learningWordFormIndex = exactIndex;
        this.reviewWordFormIndex = exactIndex;
        this._rerenderEnglishParagraphs();
      }
    })();

    const phraseTask = (async () => {
      if (!this.phraseHighlightingEnabled) return;
      try {
        const matcher = await KeyPhraseLibrary.getMatcher({
          targetTrack: resolveArticleTrack(article).targetTrack
        });
        if (!isCurrent() || !this.phraseHighlightingEnabled) return;
        this.keyPhraseMatcher = matcher;
        // 顺手预热跨包等级索引，点击词组时词组卡即时可显示等级与释义。
        void KeyPhraseLibrary.getPhraseIndex().catch(() => {});
        this._rerenderEnglishParagraphs();
        this._applyPhraseMarkingToTitle(article);
      } catch (error) {
        // 词组包加载失败只降级为不高亮，不影响正文阅读。
        diagnosticLogger()?.record('reading.key_phrase_load_failed', {
          category: 'reading',
          level: 'warn',
          payload: { articleId: article.id, message: String(error?.message || error) }
        });
      }
    })();

    await Promise.allSettled([progressTask, vocabularyTask, phraseTask]);
    if (!isCurrent()) return;
    AudioCache.preloadWords(article.content).catch(() => {});
    diagnosticLogger()?.record('reading.enhancements_ready', {
      category: 'reading',
      payload: { articleId: article.id, vocabularyCount: this.learningWords.length }
    });
  },

  _renderResumeCard() {
    const progress = this.readingProgress;
    if (!progress) return '';
    const fullPercent = Math.round((Number(progress.full?.maxProgress) || 0) * 100);
    const guideCount = progress.guide?.visitedIndexes?.length || 0;
    const guideTotal = progress.guide?.totalSentences || this.guideSentences.length || 0;
    const modeLabel = progress.lastMode === 'guide' ? '逐句导读' : '全文阅读';
    const resumeLabel = progress.lastMode === 'guide' ? '继续逐句导读' : '继续上次阅读';
    return `
      <section class="reading-resume-card" id="readingResumeCard" aria-label="继续上次阅读">
        <div class="reading-resume-copy">
          <p class="page-eyebrow">CONTINUE READING</p>
          <h2>继续上次阅读</h2>
          <p>上次停在 ${modeLabel} · 正文约 ${fullPercent}%${guideTotal ? ` · 已导读 ${guideCount}/${guideTotal} 句` : ''} · 累计有效阅读 ${formatReadingDuration(progress.activeSeconds)}</p>
        </div>
        <div class="reading-resume-actions">
          <button class="btn btn-primary" type="button" onclick="ReadingView.continueReading()">${resumeLabel}</button>
          <button class="btn btn-outline" type="button" onclick="ReadingView.startFromBeginning()">从头查看</button>
        </div>
      </section>`;
  },

  _getReadingAnchor() {
    const scroller = this._readingScrollTarget || document.scrollingElement || document.documentElement;
    const pairs = [...(this.container?.querySelectorAll?.('#articleBody .paragraph-pair') || [])];
    if (!pairs.length) return { paragraphIndex: 0, sentenceIndex: 0 };
    const scrollerRect = scroller?.getBoundingClientRect?.();
    const top = (scrollerRect?.top || 0) + (Number(scroller?.clientHeight) || window.innerHeight || 0) * 0.3;
    let selected = null;
    pairs.forEach((pair, paragraphIndex) => {
      const sentences = [...(pair.querySelectorAll?.('.reading-sentence') || [])];
      sentences.forEach((sentence, sentenceIndex) => {
        const rect = sentence.getBoundingClientRect?.();
        if (rect && rect.top <= top) selected = { paragraphIndex, sentenceIndex };
      });
    });
    return selected || { paragraphIndex: 0, sentenceIndex: 0 };
  },

  _readingProgressInput() {
    const mode = this.readingMode === 'guide' ? 'guide' : 'full';
    return {
      activeSeconds: this.timer?.elapsed || 0,
      mode,
      fullProgress: this.readingScrollDepth || 0,
      fullAnchor: this._getReadingAnchor(),
      guideIndex: mode === 'guide' ? this.guideIndex : undefined,
      totalSentenceCount: this.guideSentences.length
    };
  },

  _recordReadingProgressActivity(activity = {}) {
    if (!this.readingProgressSession || this.readingProgressFinalizing) return;
    const state = this.readingProgressSession.recordActivity({
      ...activity,
      mode: activity.mode || (this.readingMode === 'guide' ? 'guide' : 'full'),
      activeSeconds: activity.activeSeconds ?? this.timer?.elapsed ?? 0,
      fullProgress: activity.fullProgress ?? this.readingScrollDepth,
      fullAnchor: activity.fullAnchor || this._getReadingAnchor(),
      totalSentenceCount: this.guideSentences.length
    });
    this.persistedGuideVisited = new Set(state.persistedGuideVisited || []);
    this.sessionGuideVisited = new Set(state.sessionGuideVisited || []);
    const sessionGuideVisitedCount = Number(state.sessionGuideVisitedCount ?? this.sessionGuideVisited.size);
    const progressSnapshot = this.readingProgressSession.getSnapshot?.() || {};
    this.readingActivityTracker?.record({
      phase: state.phase,
      active: state.phase === 'active',
      elapsedSeconds: this.timer?.elapsed || 0,
      nowMs: Date.now(),
      maxContentProgress: Number(progressSnapshot.full?.maxProgress) || this.readingScrollDepth || 0,
      guideVisitedIndexes: state.sessionGuideVisited || [],
      totalSentences: this.guideSentences.length,
      mode: this.readingMode
    });
    if (state.phase === 'active' || sessionGuideVisitedCount >= 2) this._scheduleReadingProgressCheckpoint();
  },

  async _flushReadingActivity({ markCompleted = false } = {}) {
    const tracker = this.readingActivityTracker;
    if (!tracker) return { ok: true, skipped: true };
    try {
      if (markCompleted) await tracker.markCompleted({ nowMs: Date.now() });
      const result = await tracker.flush();
      this.readingActivitySaveStatus = 'saved';
      if (markCompleted) this.readingActivityCompletionPending = false;
      return { ok: true, ...(result || {}) };
    } catch (error) {
      this.readingActivitySaveStatus = 'failed';
      diagnosticLogger()?.record('reading.activity_flush_failed', {
        category: 'reading',
        level: 'error',
        payload: {
          articleId: this.articleData?.id,
          completionId: this.readingProgressSession?.getCompletionId?.() || null,
          message: String(error?.message || error)
        }
      });
      return { ok: false, error };
    }
  },

  _scheduleReadingProgressCheckpoint() {
    if (!this.readingProgressSession || this.readingProgressFinalizing) return;
    this.readingProgressSession.scheduleCheckpoint(this._readingProgressInput(), 3000);
  },

  _checkpointReadingProgress({ force = false } = {}) {
    if (!this.readingProgressSession || this.readingProgressFinalizing) return Promise.resolve({ ok: false, skipped: true });
    const input = this._readingProgressInput();
    if (force) {
      this.readingProgressSession.cancelScheduledCheckpoint?.();
      return this.readingProgressSession.checkpoint(input)
        .then(snapshot => ({ ok: true, snapshot }))
        .catch(error => {
          diagnosticLogger()?.record('reading.progress_checkpoint_failed', {
            category: 'reading',
            level: 'error',
            payload: { articleId: this.articleData?.id, message: String(error?.message || error) }
          });
          return { ok: false, error };
        });
    }
    this.readingProgressSession.scheduleCheckpoint(input, 3000);
    return Promise.resolve({ ok: false, scheduled: true });
  },

  async _retryReadingProgressCleanup({ showFailure = true } = {}) {
    const session = this.readingProgressSession;
    if (!session) {
      if (!this.readingProgressCompletion?.cleanupPending || this.articleData?.id == null) {
        this.readingProgressFinalizing = false;
        return false;
      }
      this.readingProgressFinalizing = true;
      try {
        await DB.deleteReadingProgress(this.articleData.id);
        this._clearReadingCompletionPending({ articleId: this.articleData.id });
        this.readingProgress = null;
        this.readingProgressCompletion = { factsRecorded: true, cleanupPending: false };
        this.readingProgressFinalizing = false;
        return true;
      } catch (caught) {
        this.readingProgressFinalizing = false;
        this.readingProgressCompletion = {
          factsRecorded: true,
          cleanupPending: true,
          error: caught
        };
        diagnosticLogger()?.record('reading.progress_completion_cleanup_retry_failed', {
          category: 'reading',
          level: 'error',
          payload: { articleId: this.articleData?.id, message: String(caught?.message || caught) }
        });
        if (showFailure) this._showReadingProgressCleanupFailure();
        return false;
      }
    }
    this.readingProgressFinalizing = true;
    let succeeded = false;
    let error = null;
    try {
      await session.complete();
      succeeded = Boolean(session.getCompletionState?.().cleanupCompleted ?? true);
    } catch (caught) {
      error = caught;
      diagnosticLogger()?.record('reading.progress_complete_failed', {
        category: 'reading',
        level: 'error',
        payload: { articleId: this.articleData?.id, message: String(caught?.message || caught) }
      });
    }
    if (succeeded) {
      this.readingProgress = null;
      this.readingProgressSession = null;
      this.readingProgressCompletion = { factsRecorded: true, cleanupPending: false };
    } else {
      this.readingProgressCompletion = {
        factsRecorded: true,
        cleanupPending: true,
        error
      };
    }
    this.readingProgressFinalizing = false;
    if (!succeeded && showFailure) this._showReadingProgressCleanupFailure();
    return succeeded;
  },

  async retryReadingProgressCleanup() {
    const succeeded = await this._retryReadingProgressCleanup({ showFailure: true });
    if (succeeded && this.readingCompletionSummary) {
      const summary = this.readingCompletionSummary;
      this.readingCompletionSummary = null;
      await this.showSummary(summary.elapsed, summary.wpm, summary.readingQualification);
    }
    return succeeded;
  },

  _hideResumeCard() {
    const card = document.getElementById('readingResumeCard');
    if (card) card.style.display = 'none';
  },

  _scrollToReadingResume(progress) {
    const paragraphIndex = Math.max(0, Number(progress?.paragraphIndex) || 0);
    const sentenceIndex = Math.max(0, Number(progress?.sentenceIndex) || 0);
    const target = this.container?.querySelector?.(
      `.paragraph-pair[data-paragraph-index="${paragraphIndex}"] .reading-sentence[data-sentence-index="${sentenceIndex}"]`
    ) || this.container?.querySelector?.(`.paragraph-pair[data-paragraph-index="${paragraphIndex}"]`);
    if (target?.scrollIntoView) target.scrollIntoView({ block: 'start' });
    else {
      const scroller = this._readingScrollTarget || document.scrollingElement || document.documentElement;
      const maxScroll = Math.max(0, (Number(scroller?.scrollHeight) || 0) - (Number(scroller?.clientHeight) || 0));
      scroller.scrollTop = maxScroll * Math.min(1, Math.max(0, Number(this.readingProgress?.full?.maxProgress) || 0));
    }
  },

  continueReading() {
    const progress = this.readingProgressSession?.getResume?.();
    this._hideResumeCard();
    this.readingProgressSession?.activate('explicit_resume');
    if (progress?.lastMode === 'guide' && this.guideSentences.length) {
      this.guideModeUsed = true;
      this.readingMode = 'guide';
      this.guideIndex = Math.max(0, Math.min(this.guideSentences.length - 1, Number(progress.guide?.lastIndex) || 0));
      void this.openSentenceGuide();
    } else {
      this.readingMode = 'full';
      this._scrollToReadingResume(progress?.full);
    }
    this._recordReadingProgressActivity({ explicitResume: true });
    void this._checkpointReadingProgress({ force: true });
  },

  startFromBeginning() {
    this._hideResumeCard();
    this.readingMode = 'full';
    const scroller = this._readingScrollTarget || document.scrollingElement || document.documentElement;
    if (scroller) scroller.scrollTop = 0;
  },

  _getSentenceGuideActionLabel() {
    const visitedCount = this.readingProgress?.guide?.visitedIndexes?.length || 0;
    return visitedCount > 0 ? '继续逐句导读' : '逐句导读';
  },

  _renderReadingActionsMenu(article) {
    const researchSources = Array.isArray(article?.researchSources)
      ? article.researchSources.slice(0, 5)
      : [];
    return `
      <div id="readingActionsOverlay" class="modal-overlay reading-actions-overlay" style="display:none" aria-hidden="true" onclick="ReadingView.handleReadingActionsBackdrop(event)">
        <section class="reading-actions-sheet" role="dialog" aria-modal="true" aria-labelledby="readingActionsTitle">
          <header class="reading-actions-head">
            <div>
              <p class="page-eyebrow">READING TOOLS</p>
              <h2 id="readingActionsTitle">阅读工具</h2>
            </div>
            <button class="modal-close" type="button" onclick="ReadingView.closeReadingActions()" aria-label="关闭阅读工具">×</button>
          </header>
          <div class="reading-actions-list">
            <button class="reading-action-item" type="button" onclick="ReadingView.toggleTranslation()" id="translateBtn" aria-pressed="false">
              <span class="reading-action-item-main"><i class="fa-solid fa-language" aria-hidden="true"></i><span>全文翻译</span></span>
              <span class="reading-action-state">未显示</span>
            </button>
            <button class="reading-action-item" type="button" id="sentenceColorBtn" onclick="ReadingView.toggleSentenceColors()" aria-pressed="${this.sentenceColorsEnabled}" aria-label="句子配色：${this.sentenceColorsEnabled ? '开' : '关'}">
              <span class="reading-action-item-main"><i class="fa-solid fa-palette" aria-hidden="true"></i><span>句子配色</span></span>
              <span class="reading-action-state">${this.sentenceColorsEnabled ? '开启' : '关闭'}</span>
            </button>
            ${!this.reviewMode ? `
              <button class="reading-action-item" type="button" id="wordMarkingBtn" onclick="ReadingView.toggleWordMarking()" role="switch" aria-checked="${this.wordMarkingEnabled}" aria-label="词汇标记：${this.wordMarkingEnabled ? '开' : '关'}">
                <span class="reading-action-item-main"><i class="fa-solid fa-highlighter" aria-hidden="true"></i><span>词汇标记</span></span>
                <span class="reading-action-state">${this.wordMarkingEnabled ? '开启' : '关闭'}</span>
              </button>` : `
              <div class="reading-action-item reading-action-item-static" role="status" aria-label="词汇标记：复习模式已开启">
                <span class="reading-action-item-main"><i class="fa-solid fa-highlighter" aria-hidden="true"></i><span>词汇标记</span></span>
                <span class="reading-action-state">复习模式 · 已开启</span>
              </div>`}
            <button class="reading-action-item" type="button" id="phraseHighlightBtn" onclick="ReadingView.togglePhraseHighlighting()" role="switch" aria-checked="${this.phraseHighlightingEnabled}" aria-label="重点词组：${this.phraseHighlightingEnabled ? '开' : '关'}">
              <span class="reading-action-item-main"><i class="fa-solid fa-tags" aria-hidden="true"></i><span>重点词组</span></span>
              <span class="reading-action-state">${this.phraseHighlightingEnabled ? '开启' : '关闭'}</span>
            </button>
            <button class="reading-action-item" type="button" id="exportPdfBtn" onclick="ReadingView.exportArticlePdf()">
              <span class="reading-action-item-main"><i class="fa-solid fa-file-arrow-down" aria-hidden="true"></i><span>导出 PDF</span></span>
              <span class="reading-action-state">就绪</span>
              <span class="reading-action-chevron" aria-hidden="true">›</span>
            </button>
            ${researchSources.length ? `
              <details class="reading-research-sources reading-action-details" data-research-sources>
                <summary><span class="reading-action-item-main"><i class="fa-solid fa-globe" aria-hidden="true"></i><span>资料来源（联网检索）</span></span><span class="reading-action-chevron" aria-hidden="true">›</span></summary>
                <ul>
                  ${researchSources.map(source => `<li><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title || source.domain)}</a><small>${esc(source.domain)}${source.publishedAt ? ` · ${esc(source.publishedAt)}` : ''}</small></li>`).join('')}
                </ul>
              </details>` : ''}
          </div>
        </section>
      </div>`;
  },

  toggleReadingActions() {
    const overlay = this.container?.querySelector?.('#readingActionsOverlay')
      || (typeof document !== 'undefined' ? document.getElementById('readingActionsOverlay') : null);
    if (!overlay) return false;
    const isOpen = overlay.style.display !== 'none' && overlay.getAttribute('aria-hidden') !== 'true';
    if (isOpen) {
      this.closeReadingActions();
      return false;
    }

    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
    const moreButton = this.container?.querySelector?.('#readingMoreBtn')
      || (typeof document !== 'undefined' ? document.getElementById('readingMoreBtn') : null);
    moreButton?.setAttribute('aria-expanded', 'true');
    moreButton?.setAttribute('aria-label', '关闭阅读工具');
    moreButton?.classList.add('is-open');

    if (typeof document !== 'undefined') {
      if (this._readingActionsKeydownHandler) {
        document.removeEventListener('keydown', this._readingActionsKeydownHandler);
      }
      this._readingActionsKeydownHandler = event => {
        if (event.key === 'Escape') this.closeReadingActions();
      };
      document.addEventListener('keydown', this._readingActionsKeydownHandler);
    }
    return true;
  },

  closeReadingActions() {
    if (typeof document !== 'undefined' && this._readingActionsKeydownHandler) {
      document.removeEventListener('keydown', this._readingActionsKeydownHandler);
    }
    this._readingActionsKeydownHandler = null;
    const overlay = this.container?.querySelector?.('#readingActionsOverlay')
      || (typeof document !== 'undefined' ? document.getElementById('readingActionsOverlay') : null);
    if (overlay) {
      overlay.style.display = 'none';
      overlay.setAttribute('aria-hidden', 'true');
    }
    const moreButton = this.container?.querySelector?.('#readingMoreBtn')
      || (typeof document !== 'undefined' ? document.getElementById('readingMoreBtn') : null);
    moreButton?.setAttribute('aria-expanded', 'false');
    moreButton?.setAttribute('aria-label', '打开阅读工具');
    moreButton?.classList.remove('is-open');
  },

  handleReadingActionsBackdrop(event) {
    if (event?.target === event?.currentTarget) this.closeReadingActions();
  },

  _syncHeaderFavorite(article) {
    const button = typeof document !== 'undefined' ? document.getElementById('favBtn') : null;
    if (!button) return;
    const favorite = Boolean(article?.favorite);
    button.classList.toggle('is-active', favorite);
    button.setAttribute('aria-pressed', String(favorite));
    button.setAttribute('aria-label', favorite ? '取消收藏文章' : '收藏文章');
    button.setAttribute('title', favorite ? '取消收藏文章' : '收藏文章');
    const icon = button.querySelector?.('i');
    if (icon) {
      icon.classList.toggle('fa-solid', favorite);
      icon.classList.toggle('fa-regular', !favorite);
    }
  },

  _renderTitleText(article) {
    const title = String(article?.title || '文章');
    if (this.phraseHighlightingEnabled && this.keyPhraseMatcher) {
      return renderPhraseAwareMarking(title, this.keyPhraseMatcher, {});
    }
    return esc(title);
  },

  _applyPhraseMarkingToTitle(article) {
    if (!article) return;
    const titleNode = this.container?.querySelector?.('#readingTitleLookup .reading-title');
    // 总是按当前状态重写：开启且 matcher 就绪 → 词组标注；关闭或未加载 → 纯转义标题。
    // 不能在关闭路径早退，否则标题残留词组高亮而正文已清除。
    if (titleNode) titleNode.innerHTML = this._renderTitleText(article);
  },

  _renderArticleTitle(article) {
    const titleZh = String(article.titleZh || '').trim();
    return `
      <div class="reading-title-row">
        <div id="readingTitleLookup" class="reading-title-lookup">
          <h1 class="reading-title" data-learning-text="click" title="点击标题中的英文单词查释义">${this._renderTitleText(article)}</h1>
          ${titleZh ? `<div class="reading-title-translation">
            <button type="button" class="btn-paragraph-translate reading-title-translate" aria-expanded="false" onclick="ReadingView.toggleTitleTranslation(this)">译</button>
            <p class="zh-paragraph reading-title-zh" data-word-lookup="disabled" style="display:none">${esc(titleZh)}</p>
          </div>` : ''}
        </div>
      </div>`;
  },

  async exportArticlePdf() {
    const article = this.articleData || {};
    if (!String(article.content || '').trim()) {
      alert('这篇文章没有可导出的正文内容');
      return;
    }
    const button = document.getElementById('exportPdfBtn');
    const state = button?.querySelector('.reading-action-state');
    const originalState = state?.textContent || '就绪';
    if (button) {
      button.disabled = true;
    }
    if (state) state.textContent = '导出中…';
    try {
      const track = resolveArticleTrack(article).targetTrack;
      const result = await exportArticlePdf(article, { track });
      if (!result.ok) throw new Error(result.error);
      if (button) button.disabled = false;
      if (state) state.textContent = originalState;
      this.closeReadingActions();
      if (result.platform === 'web') alert('PDF 已生成，开始下载：' + result.fileName);
    } catch (error) {
      if (button) button.disabled = false;
      if (state) state.textContent = originalState;
      alert('导出 PDF 失败：' + String(error?.message || error));
    }
  },

  async cleanup({ skipProgressCheckpoint = false } = {}) {
    // Invalidate post-paint vocabulary/progress work before releasing any
    // resources. Late work from an abandoned article must not bind itself to
    // the next route or to a newly opened article.
    this.wordMarkingSession += 1;
    this.closeReadingActions();
    this.closeSentenceGuide({ restoreReading: false, checkpoint: false });
    let progressCheckpointFailed = false;
    let activitySaveFailed = false;
    if (this.readingProgressSession && !this.readingProgressFinalizing) {
      if (this.readingProgressCompletion?.factsRecorded) {
        progressCheckpointFailed = !(await this._retryReadingProgressCleanup({ showFailure: false }));
      } else if (!skipProgressCheckpoint) {
        this._recordReadingProgressActivity(this._readingProgressInput());
        this.timer?.stop();
        const checkpointResult = await this._checkpointReadingProgress({ force: true });
        progressCheckpointFailed = !checkpointResult.ok;
      }
    }
    const activityResult = await this._flushReadingActivity({
      markCompleted: Boolean(this.readingActivityCompletionPending)
    });
    activitySaveFailed = !activityResult.ok;
    this._clearSentenceColors();
    this.sentenceColorsEnabled = false;
    this._wordLookupCleanup?.();
    this._wordLookupCleanup = null;
    if (this._reviewRatedHandler) {
      document.removeEventListener('review-rated', this._reviewRatedHandler);
      this._reviewRatedHandler = null;
    }
    Tooltip.hide();
    AIAnalysis.clearArticleContext();
    if (this._resumeHandler) {
      document.removeEventListener('touchstart', this._resumeHandler);
      this._resumeHandler = null;
    }
    if (this._readingScrollTarget && this._scrollProgressHandler) {
      this._readingScrollTarget.removeEventListener('scroll', this._scrollProgressHandler);
    }
    this._readingScrollTarget = null;
    this._scrollProgressHandler = null;
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }
    if (this._pagehideHandler && typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this._pagehideHandler);
      this._pagehideHandler = null;
    }
    if (this._viewportResizeHandler && typeof window !== 'undefined') {
      window.removeEventListener('resize', this._viewportResizeHandler);
      window.removeEventListener('orientationchange', this._viewportResizeHandler);
    }
    this._viewportResizeHandler = null;
    if (this._viewportResizeFrame != null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(this._viewportResizeFrame);
    }
    this._viewportResizeFrame = null;
    if (this.timer) { this.timer.stop(); this.timer = null; }
    if (!this.readingProgressCompletion?.cleanupPending && !progressCheckpointFailed && !activitySaveFailed) {
      this.readingProgressSession = null;
    }
    if (!this.readingProgressCompletion?.cleanupPending && !progressCheckpointFailed && !activitySaveFailed) {
      this.readingActivityTracker = null;
    }
    return {
      progressSaved: !progressCheckpointFailed && !activitySaveFailed,
      activitySaved: !activitySaveFailed,
      cleanupPending: Boolean(this.readingProgressCompletion?.cleanupPending),
      checkpointFailed: progressCheckpointFailed || activitySaveFailed
    };
  },

  async render(container, articleId) {
    await this.cleanup();
    this.container = container;
    const session = ++this.wordMarkingSession;
    const learnWordsPromise = (typeof DB.getUnifiedVocabularySnapshot === 'function'
      ? DB.getUnifiedVocabularySnapshot().then(snapshot => snapshot.data)
      : DB.getAllLearnWords()).catch(error => {
      diagnosticLogger()?.record('reading.vocabulary_read_failed', {
        category: 'reading',
        level: 'error',
        payload: { articleId, message: String(error?.message || error) }
      });
      return [];
    });
    const renderSpan = diagnosticLogger()?.beginSpan('reading.render', {
      category: 'reading',
      correlationId: `reading-render:${articleId || 'unknown'}:${Date.now()}`,
      payload: { articleId }
    });
    this.clickedWords = [];
    this.cycleReviewRatings = [];
    this.readingScrollDepth = 0;
    this.reviewWordsMap = new Map();
    this.learningWordsMap = new Map();
    this.learningWords = [];
    this.learningWordFormIndex = new Map();
    this.reviewWordFormIndex = new Map();
    // 词组 matcher 随文章重置：旧文章的 track 可能与本文不同，phraseTask 会按需重载。
    this.keyPhraseMatcher = null;
    this.wordMarkingEnabled = Config.get('reading_word_marking') === 'true';
    this.phraseHighlightingEnabled = Config.get('reading_phrase_highlighting') === 'true';
    this.englishParagraphs = [];
    this.guideSentences = [];
    this.guideVisited = new Set();
    this.guideIndex = 0;
    this.guidePayload = null;
    this.guideError = '';
    this.guideModeUsed = false;
    this.readingMode = 'full';
    this.readingProgress = null;
    this.readingProgressSession = null;
    this.persistedGuideVisited = new Set();
    this.sessionGuideVisited = new Set();
    this.readingUserScrollProgress = 0;
    this.readingProgressFinalizing = false;
    this.readingProgressSaveStatus = null;
    this.readingProgressCompletion = null;
    this.readingCompletionSummary = null;
    this.readingActivityTracker = null;
    this.readingActivitySaveStatus = null;
    this.readingActivityCompletionPending = false;
    this.incompleteReadingQualification = null;
    this.sentenceSegmentsByParagraph = [];
    this.sentenceColorsEnabled = false;
    const article = await DB.getArticle(articleId);
    if (!article) {
      container.innerHTML = '<div class="empty-state">文章不存在</div>';
      renderSpan?.end({ level: 'error', payload: { reason: 'article_not_found' } });
      return;
    }
    this.articleData = article;
    this._syncHeaderFavorite(article);
    AIAnalysis.setArticleContext({ id: article.id, title: article.title }, '');
    this.reviewMode = !!article.reviewMode;

    // 空 content 防护: 云端分段在修/抓取异常时可能存入空正文
    if (!article.content || !article.content.trim()) {
      container.innerHTML = `
        <div class="reading-container">
          <header class="reading-header" data-reading-header="article">
            ${this._renderArticleTitle(article)}
          </header>
          ${this._renderReadingActionsMenu(article)}
          <div class="reading-layout" data-reading-layout="article">
            <section class="reading-content-pane" data-reading-pane="content" aria-label="文章正文">
              <div class="empty-state">⏳ 文章正文尚未就绪，请稍后重试或重新打开</div>
            </section>
          </div>
          <div id="readingAiPanelHost" class="reading-ai-panel-host" data-reading-ai-panel="side" aria-hidden="true"></div>
        </div>
        <div id="wordTooltip" class="word-tooltip" style="display:none"></div>`;
      this.initInteractions();
      this._bindViewportLifecycle();
      renderSpan?.end({ payload: { articleId: article.id, wordCount: 0, empty: true } });
      diagnosticLogger()?.record('reading.rendered', {
        category: 'reading',
        payload: { articleId: article.id, wordCount: 0, empty: true }
      });
      return;
    }

    const enParas = this._splitParas(article.content);
    this.englishParagraphs = enParas;
    this.paragraphTranslations = this._getParagraphTranslations(article, enParas);
    this.sentenceSegmentsByParagraph = enParas.map(paragraph => splitSentences(paragraph));
    this.guideSentences = enParas.flatMap((paragraph, paragraphIndex) => this._splitGuideSentences(paragraph)
      .map(segment => ({
        sentence: segment.text,
        paragraph,
        paragraphIndex,
        sourceStart: segment.start,
        sourceEnd: segment.end
      })));
    const articleTrack = resolveArticleTrack(article);

    let parasHTML = '';
    enParas.forEach((p, i) => {
      const zhText = this.paragraphTranslations[i] || '';
      const hasTranslation = !!zhText.trim();
      const paraHTML = this._renderParagraphContent(i);
      parasHTML += `
        <div class="paragraph-pair" data-paragraph-index="${i}">
          <p class="en-paragraph" data-learning-text="click">${paraHTML}</p>
          <button class="btn-paragraph-translate" data-paragraph-index="${i}" onclick="ReadingView.toggleParagraph(this)">译</button>
          ${hasTranslation ? `<p class="zh-paragraph" data-word-lookup="disabled" style="display:none">${esc(zhText.trim())}</p>` : ''}
        </div>`;
    });

    container.innerHTML = `
      <div class="reading-container">
        <header class="reading-header" data-reading-header="article">
          <p class="page-eyebrow">02 / READING NOTE</p>
          ${this._renderArticleTitle(article)}
          <div class="reading-meta">
            <span class="badge badge-${articleTrack.badgeClass}">${esc(articleTrack.primaryLabel)}</span>
            ${articleTrack.baselineLabel ? `<span class="meta-item reading-baseline-label">${esc(articleTrack.baselineLabel)}</span>` : ''}
            ${article.challenge ? `<span class="meta-item">${esc(article.challenge === 'support' ? '基础' : article.challenge === 'stretch' ? '进阶' : '标准')}练习</span>` : ''}
            ${article.difficultyReport?.passed ? `<span class="meta-item">✓ 难度校验通过</span>` : ''}
            <span class="meta-item">${article.wordCount} 词</span>
            <span class="meta-item">${esc(article.topic)}</span>
          </div>
          <div class="reading-primary-actions" aria-label="阅读主操作">
            <button class="btn btn-primary reading-guide-primary-btn" type="button" onclick="ReadingView.openSentenceGuide()">${this._getSentenceGuideActionLabel()}</button>
          </div>
          <div class="reading-timer-bar collapsed" id="timerBar" onclick="this.classList.toggle('collapsed')">
            <span class="timer-toggle" title="点击展开/折叠计时">⏱</span>
            <div class="timer-expanded">
              <span id="timerDisplay" class="timer-display">0:00</span>
              <div class="timer-progress"><div id="timerProgress" class="timer-progress-fill"></div></div>
              <span id="timerWpm" class="timer-wpm"></span>
              <span id="timerStatus" class="timer-status"></span>
            </div>
          </div>
          <div class="reading-hint">${this.reviewMode ? '复习标记词：点击后记录你的掌握程度' : '点击单词查释义；选中句子可以请求 AI 分析'}</div>
        </header>
        <div data-reading-resume-host>${this._renderResumeCard()}</div>
        <div class="reading-layout" data-reading-layout="article">
          <section class="reading-content-pane" data-reading-pane="content" aria-label="文章正文">
            <div id="articleBody" class="article-body">${parasHTML}</div>
            <div class="reading-finish-bar">
              <button class="btn btn-success btn-lg" onclick="ReadingView.finishReading()">✓ 阅读完成</button>
            </div>
          </section>
        </div>
        <div id="readingAiPanelHost" class="reading-ai-panel-host" data-reading-ai-panel="side" aria-hidden="true"></div>
        ${this._renderReadingActionsMenu(article)}
      </div>
      <div id="wordTooltip" class="word-tooltip" style="display:none"></div>
      <div id="readingSummary" class="modal-overlay" style="display:none"></div>
      <div id="sentenceGuideModal" class="modal-overlay sentence-guide-overlay" style="display:none"></div>`;

    this.initInteractions();
    this._bindViewportLifecycle();
    renderSpan?.end({ payload: { articleId: article.id, wordCount: article.wordCount || 0, paragraphCount: enParas.length } });
    diagnosticLogger()?.record('reading.rendered', {
      category: 'reading',
      payload: { articleId: article.id, wordCount: article.wordCount || 0, paragraphCount: enParas.length, reviewMode: this.reviewMode }
    });
    this._scheduleAfterFirstPaint(() => {
      void this._startPostPaintEnhancements({ article, container, session, learnWordsPromise });
    });
  },

  _recordReadingLookup({ word, data, reviewWord, lookupId, source = 'reading-word-lookup', collect = true }) {
    const stem = getStemForm(word.toLowerCase());
    void knowledgeEvidenceBridge.recordLookup({
      word,
      source,
      articleId: this.articleData?.id,
      attemptId: `${source}:${this.articleData?.id || 'article'}:${lookupId}`,
      contextId: `tooltip:${lookupId}`
    });
    if (!collect || this.clickedWords.some(item => item.stem === stem)) return;
    this.clickedWords.push({
      word: word.toLowerCase(),
      stem,
      translation: getSavableTranslation(data),
      phonetic: data.phonetic || '',
      pos: data.pos || '',
      definitionSenses: getDefinitionSenses(data),
      definitionSchemaVersion: DEFINITION_SCHEMA_VERSION,
      definitionLexiconVersion: data.lexiconVersion || '',
      freqLevel: data.freqLevel || 'unknown',
      isReviewWord: reviewWord,
      quality: reviewWord ? 3 : null,
      explicitRating: false
    });
  },

  _readingLookupContext(source = 'reading') {
    const articleId = this.articleData?.id ?? null;
    return {
      source,
      articleId,
      articleTitle: this.articleData?.title || '',
      sessionId: `reading:${articleId || 'article'}:${this.wordMarkingSession}`
    };
  },

  _recordReadingLookupActivity({ lemma, lookupId, lookupContext = {} }) {
    const occurredAt = Date.now();
    const normalizedLemma = String(lemma || '').trim().toLowerCase();
    const sessionId = String(lookupContext.sessionId || this._readingLookupContext().sessionId);
    const bucket = Math.floor(occurredAt / 2000);
    const dedupeKey = `lookup:${sessionId}:${normalizedLemma}:${bucket}`;
    diagnosticLogger()?.record('reading.word_lookup', {
      category: 'reading',
      detail: { word: normalizedLemma },
      payload: { articleId: lookupContext.articleId ?? this.articleData?.id ?? null, lookupId }
    });
    try {
      void DB.saveLearningActivity({
        id: `reading-lookup:${dedupeKey}`,
        type: ActivityType.READING_WORD_LOOKUP,
        occurredAt,
        dayKey: localDayKey(occurredAt),
        sessionId,
        dedupeKey,
        payload: {
          lemma: normalizedLemma,
          lookupId,
          source: lookupContext.source || 'reading',
          articleId: lookupContext.articleId ?? this.articleData?.id ?? null,
          articleTitle: lookupContext.articleTitle || this.articleData?.title || ''
        }
      }).catch(error => console.warn('Reading lookup telemetry failed.', error));
    } catch (error) {
      console.warn('Reading lookup telemetry failed.', error);
    }
  },

  _recordReadingWordSaved({ sessionId, ...provenance }) {
    const occurredAt = Date.now();
    const resolvedSessionId = String(sessionId || this._readingLookupContext().sessionId);
    const lemma = String(provenance.lemma || '').trim().toLowerCase();
    diagnosticLogger()?.record('reading.word_saved', {
      category: 'reading',
      detail: { word: lemma },
      payload: { articleId: provenance.articleId ?? this.articleData?.id ?? null, createdLearnWord: Boolean(provenance.createdLearnWord) }
    });
    try {
      void DB.saveLearningActivity({
        id: `reading-saved:${resolvedSessionId}:${lemma}:${occurredAt}:${++this._learningActivitySequence}`,
        type: ActivityType.READING_WORD_SAVED,
        occurredAt,
        dayKey: localDayKey(occurredAt),
        sessionId: resolvedSessionId,
        payload: {
          ...provenance,
          lemma,
          createdLearnWord: Boolean(provenance.createdLearnWord),
          source: provenance.source || 'reading',
          articleId: provenance.articleId ?? this.articleData?.id ?? null,
          articleTitle: provenance.articleTitle || this.articleData?.title || ''
        }
      }).catch(error => console.warn('Reading save telemetry failed.', error));
    } catch (error) {
      console.warn('Reading save telemetry failed.', error);
    }
  },

  initInteractions() {
    const articleBody = document.getElementById('articleBody');
    const titleLookupHost = document.getElementById('readingTitleLookup');
    if (!articleBody && !titleLookupHost) return;
    const articleTrack = resolveArticleTrack(this.articleData || {});

    const lookupRoot = this.container?.querySelector('.reading-container') || articleBody || titleLookupHost;
    this._wordLookupCleanup = bindLearningTextLookup({
      root: lookupRoot,
      getContextSentence: event => this.getLookupSentence(event) || (event.target.closest?.('#readingTitleLookup') ? this.articleData?.title || '' : ''),
      getTargetTrack: () => articleTrack.targetTrack,
      isReviewWord: word => this.reviewMode && this.reviewWordsMap.has(getStemForm(word.toLowerCase())),
      shouldIgnoreClick: event => {
        if (!event.target?.closest?.('#articleBody') || !AIAnalysis.ignoreNextArticleClick) return false;
        AIAnalysis.ignoreNextArticleClick = false;
        return true;
      },
      resolveKeyPhrase: phraseId => KeyPhraseLibrary.getPhraseById(phraseId, {
        targetTrack: articleTrack.targetTrack
      }),
      onHide: () => AIAnalysis.hideButton(),
      lookupContext: () => this._readingLookupContext('reading'),
      onLookupResolved: payload => this._recordReadingLookupActivity(payload),
      onWordSaved: provenance => this._recordReadingWordSaved({
        ...provenance,
        sessionId: this._readingLookupContext('reading').sessionId
      }),
      onShown: ({ event, word, data, reviewWord, lookupId }) => {
        if (event?.target?.closest?.('#articleBody')) {
          this._recordReadingProgressActivity({ bodyLookup: true });
        }
        this._recordReadingLookup({
          word,
          data,
          reviewWord,
          lookupId,
          collect: Boolean(event?.target?.closest?.('#articleBody'))
        });
      }
    });

    // Listen for review rating events from tooltip
    this._reviewRatedHandler = (e) => {
      const quality = Number(e.detail?.quality);
      const stem = getStemForm(String(e.detail?.stem || '').toLowerCase());
      const existing = this.clickedWords.find(w => w.stem === stem);
      if (existing) {
        existing.quality = quality;
        existing.explicitRating = true;
      }
      if (!this.reviewMode || !this.readingProgressSession) return;
      const reviewWord = this.reviewWordsMap.get(stem);
      const phase = this.readingProgressSession.getState?.().phase;
      if (phase === 'preview' || phase === 'resume') {
        this.readingProgressSession.activate('review_rating');
      }
      const recorded = this.readingProgressSession.recordReviewRating?.({
        wordId: reviewWord?.id || existing?.wordId || null,
        stem,
        quality
      });
      if (recorded) {
        this.cycleReviewRatings = this.readingProgressSession.getReviewRatings?.() || [];
        this._recordReadingProgressActivity({ mode: this.readingMode });
      }
    };
    document.addEventListener('review-rated', this._reviewRatedHandler);

    if (articleBody) AIAnalysis.initSelectionDetection(articleBody);
  },

  getLookupSentence(e) {
    return getContextSentenceAtPoint(e, this.container);
  },

  async openSentenceGuide() {
    if (!this.guideSentences.length) {
      alert('当前文章还没有可导读的英文句子。');
      return;
    }
    this.guideModeUsed = true;
    this.readingMode = 'guide';
    this._recordReadingProgressActivity({ mode: 'guide' });
    const overlay = document.getElementById('sentenceGuideModal');
    if (overlay) overlay.style.display = 'flex';
    await this.showSentenceGuide(this.guideIndex || 0);
  },

  closeSentenceGuide({ restoreReading = true, checkpoint = true } = {}) {
    this._guideWordLookupCleanup?.();
    this._guideWordLookupCleanup = null;
    if (this.guideAbortController) {
      this.guideAbortController.abort();
      this.guideAbortController = null;
    }
    this.guideSession += 1;
    const overlay = document.getElementById('sentenceGuideModal');
    if (overlay) {
      overlay.style.display = 'none';
      overlay.innerHTML = '';
    }
    if (restoreReading) this.readingMode = 'full';
    if (checkpoint) void this._checkpointReadingProgress({ force: true });
  },

  async showSentenceGuide(index) {
    const nextIndex = Math.max(0, Math.min(this.guideSentences.length - 1, Number(index) || 0));
    this.guideIndex = nextIndex;
    this.guideVisited.add(nextIndex);
    this._recordReadingProgressActivity({ mode: 'guide', guideIndex: nextIndex });
    await this.loadSentenceGuide();
  },

  async previousSentenceGuide() {
    if (this.guideIndex <= 0) return;
    await this.showSentenceGuide(this.guideIndex - 1);
  },

  async nextSentenceGuide() {
    if (this.guideIndex >= this.guideSentences.length - 1) return;
    await this.showSentenceGuide(this.guideIndex + 1);
  },

  renderSentenceGuide() {
    const overlay = document.getElementById('sentenceGuideModal');
    const current = this.guideSentences[this.guideIndex];
    if (!overlay || !current) return;
    this._guideWordLookupCleanup?.();
    this._guideWordLookupCleanup = null;
    const guide = this.guidePayload;
    const loading = !!this.guideAbortController && !guide && !this.guideError;
    const chunks = guide?.chunks?.length
      ? `<div class="sentence-guide-chunks">${guide.chunks.map(chunk => `<p><strong>${esc(chunk.source)}</strong><span>${esc(chunk.glossZh)}</span></p>`).join('')}</div>`
      : '';
    const grammar = guide?.grammar?.length
      ? `<section class="sentence-guide-section"><h3>语法提示</h3><ul>${guide.grammar.map(item => `<li>${esc(item)}</li>`).join('')}</ul></section>`
      : '';
    const keywords = guide?.keywords?.length
      ? `<section class="sentence-guide-section"><h3>本句重点词</h3><div class="sentence-guide-keywords">${guide.keywords.map(item => `<span><b>${esc(item.word)}</b>${esc(item.glossZh)}</span>`).join('')}</div></section>`
      : '';
    const status = loading
      ? '<div class="sentence-guide-status">正在分析这一句…</div>'
      : this.guideError
        ? `<div class="sentence-guide-status sentence-guide-error">${esc(this.guideError)}<button type="button" class="btn btn-outline btn-sm" onclick="ReadingView.loadSentenceGuide()">重试</button></div>`
        : `<section class="sentence-guide-section sentence-guide-translation"><h3>自然意译</h3><p>${esc(guide?.translationZh || '导读暂不可用')}</p></section>${chunks}${grammar}${keywords}`;

    overlay.innerHTML = `
      <section class="sentence-guide-sheet" role="dialog" aria-modal="true" aria-labelledby="sentenceGuideTitle">
        <header class="sentence-guide-head">
          <div><p class="page-eyebrow">SLOW READING</p><h2 id="sentenceGuideTitle">逐句导读 <span>${this.guideIndex + 1} / ${this.guideSentences.length}</span></h2></div>
          <button class="modal-close" type="button" onclick="ReadingView.closeSentenceGuide()" aria-label="关闭逐句导读">×</button>
        </header>
        <div class="sentence-guide-body">
          <p class="sentence-guide-source" data-learning-text="click">${this._renderGuideSource(current.sentence)}</p>
          ${status}
        </div>
        <footer class="sentence-guide-actions">
          <button class="btn btn-outline" type="button" onclick="ReadingView.previousSentenceGuide()" ${this.guideIndex === 0 ? 'disabled' : ''}>上一句</button>
          <button class="btn btn-outline" type="button" onclick="ReadingView.closeSentenceGuide()">返回全文</button>
          <button class="btn btn-primary" type="button" onclick="ReadingView.nextSentenceGuide()" ${this.guideIndex >= this.guideSentences.length - 1 ? 'disabled' : ''}>下一句</button>
        </footer>
      </section>`;

    const source = overlay.querySelector?.('.sentence-guide-source');
    if (source) {
      this._guideWordLookupCleanup = bindLearningTextLookup({
        root: source,
        surface: 'guide',
        getContextSentence: () => current.sentence,
        getTargetTrack: () => resolveArticleTrack(this.articleData || {}).targetTrack,
        resolveKeyPhrase: phraseId => KeyPhraseLibrary.getPhraseById(phraseId, {
          targetTrack: resolveArticleTrack(this.articleData || {}).targetTrack
        }),
        isReviewWord: word => this.reviewMode && this.reviewWordsMap.has(getStemForm(word.toLowerCase())),
        onHide: () => AIAnalysis.hideButton(),
        lookupContext: () => this._readingLookupContext('reading-guide'),
        onLookupResolved: payload => this._recordReadingLookupActivity(payload),
        onWordSaved: provenance => this._recordReadingWordSaved({
          ...provenance,
          sessionId: this._readingLookupContext('reading-guide').sessionId
        }),
        onShown: ({ word, data, reviewWord, lookupId }) => {
          this._recordReadingProgressActivity({ mode: 'guide', bodyLookup: true });
          this._recordReadingLookup({
            word,
            data,
            reviewWord,
            lookupId,
            source: 'reading-guide-word-lookup',
            collect: true
          });
        }
      });
    }
  },

  async loadSentenceGuide() {
    const current = this.guideSentences[this.guideIndex];
    if (!current) return;
    if (this.guideAbortController) this.guideAbortController.abort();
    const controller = new AbortController();
    const session = ++this.guideSession;
    this.guideAbortController = controller;
    this.guidePayload = null;
    this.guideError = '';
    this.renderSentenceGuide();

    try {
      const guide = await SentenceGuide.get({
        sentence: current.sentence,
        paragraph: current.paragraph,
        article: this.articleData,
        targetTrack: this.articleData?.targetTrack || this.articleData?.difficulty || '',
        signal: controller.signal
      });
      if (session !== this.guideSession || controller.signal.aborted) return;
      this.guidePayload = guide;
    } catch (error) {
      if (session !== this.guideSession || controller.signal.aborted) return;
      this.guideError = '这一句暂时无法完成导读。';
      console.warn('Sentence guide unavailable.', error);
    } finally {
      if (session === this.guideSession) this.guideAbortController = null;
    }
    if (session === this.guideSession) this.renderSentenceGuide();
  },

  async toggleWordMarking() {
    if (this.reviewMode) return;
    this.wordMarkingEnabled = !this.wordMarkingEnabled;
    Config.set('reading_word_marking', this.wordMarkingEnabled ? 'true' : 'false');
    const session = ++this.wordMarkingSession;
    const button = document.getElementById('wordMarkingBtn');
    if (button) button.setAttribute('aria-busy', this.wordMarkingEnabled ? 'true' : 'false');
    if (this.wordMarkingEnabled && !this.learningWordFormIndex.size) {
      const exactWords = this.learningWords.map(word => ({
        ...word,
        stem: getStemForm(String(word.word || '').toLowerCase())
      }));
      this.learningWordFormIndex = await buildExactWordFormIndex(exactWords, {
        loadCore: readingLexiconLoader.loadCore
      });
      if (session !== this.wordMarkingSession || !this.wordMarkingEnabled) return;
    }
    this._rerenderEnglishParagraphs();
    if (button) {
      button.removeAttribute('aria-busy');
      button.classList.toggle('is-active', this.wordMarkingEnabled);
      button.setAttribute('aria-checked', String(this.wordMarkingEnabled));
      button.setAttribute('aria-label', `词汇标记：${this.wordMarkingEnabled ? '开' : '关'}`);
      const state = button.querySelector('.reading-action-state');
      if (state) state.textContent = this.wordMarkingEnabled ? '开启' : '关闭';
    }
  },

  async togglePhraseHighlighting() {
    // 会话守卫：等待期间发生换页/重渲（wordMarkingSession 变化）就放弃本次续体，
    // 避免用 A 文章的错轨 matcher 覆盖 B 文章状态（phraseTask 有 isCurrent，这里必须对等）。
    const session = this.wordMarkingSession;
    this.phraseHighlightingEnabled = !this.phraseHighlightingEnabled;
    Config.set('reading_phrase_highlighting', this.phraseHighlightingEnabled ? 'true' : 'false');
    const button = document.getElementById('phraseHighlightBtn');
    if (button) button.setAttribute('aria-busy', 'true');
    if (this.phraseHighlightingEnabled && !this.keyPhraseMatcher) {
      try {
        const matcher = await KeyPhraseLibrary.getMatcher({
          targetTrack: resolveArticleTrack(this.articleData || {}).targetTrack
        });
        if (session !== this.wordMarkingSession) return;
        this.keyPhraseMatcher = matcher;
      } catch (error) {
        // 包缺失/网络失败时保持不高亮，开关状态本身照常切换。
        diagnosticLogger()?.record('reading.key_phrase_load_failed', {
          category: 'reading',
          level: 'warn',
          payload: { message: String(error?.message || error) }
        });
      }
    }
    if (session !== this.wordMarkingSession) return;
    if (!this.phraseHighlightingEnabled) this.keyPhraseMatcher = null;
    this._rerenderEnglishParagraphs();
    this._applyPhraseMarkingToTitle(this.articleData);
    // 逐句导读弹层若开着，即时刷新当前句的词组标注（绑定是委托的，无需重绑）。
    if (this._guideWordLookupCleanup) {
      const current = this.guideSentences[this.guideIndex];
      const sourceHost = document.querySelector('#sentenceGuideModal .sentence-guide-source');
      if (current && sourceHost) sourceHost.innerHTML = this._renderGuideSource(current.sentence);
    }
    if (button) {
      button.removeAttribute('aria-busy');
      button.setAttribute('aria-checked', String(this.phraseHighlightingEnabled));
      button.setAttribute('aria-label', `重点词组：${this.phraseHighlightingEnabled ? '开' : '关'}`);
      const state = button.querySelector('.reading-action-state');
      if (state) state.textContent = this.phraseHighlightingEnabled ? '开启' : '关闭';
    }
  },

  _clearSentenceColors() {
    this.container?.querySelectorAll?.('#articleBody .reading-sentence').forEach(node => {
      node.classList?.remove?.('sentence-color-1', 'sentence-color-2', 'sentence-color-3', 'sentence-color-4');
    });
    const button = this.container?.querySelector?.('#sentenceColorBtn') || document.getElementById?.('sentenceColorBtn');
    if (button) {
      button.classList.remove('is-active');
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-label', '句子配色：关');
      const state = button.querySelector('.reading-action-state');
      if (state) state.textContent = '关闭';
    }
  },

  toggleSentenceColors() {
    if (!this.sentenceSegmentsByParagraph.some(segments => segments.length)) return false;
    this.sentenceColorsEnabled = !this.sentenceColorsEnabled;
    this._rerenderEnglishParagraphs();
    const button = this.container?.querySelector?.('#sentenceColorBtn') || document.getElementById?.('sentenceColorBtn');
    if (button) {
      button.classList.toggle('is-active', this.sentenceColorsEnabled);
      button.setAttribute('aria-pressed', String(this.sentenceColorsEnabled));
      button.setAttribute('aria-label', `句子配色：${this.sentenceColorsEnabled ? '开' : '关'}`);
      const state = button.querySelector('.reading-action-state');
      if (state) state.textContent = this.sentenceColorsEnabled ? '开启' : '关闭';
    }
    return this.sentenceColorsEnabled;
  },

  _highlightLearningWords(text) {
    if (!this.learningWordFormIndex.size) return esc(text);
    return renderExactWordMarking(text, this.learningWordFormIndex, 'learning-word', word => {
      const stem = word?.stem || getStemForm(word?.word || '');
      const wordData = this.learningWordsMap.get(stem);
      if (!wordData) return false;
      const status = SpacedRepetition.getStatus(wordData);
      return status === 'new' || status === 'learning';
    });
  },

  // Highlight review words in text
  _highlightReviewWords(text) {
    if (!this.reviewWordFormIndex.size) return esc(text);
    return renderExactWordMarking(text, this.reviewWordFormIndex, word => {
      const stem = word?.stem || getStemForm(word?.word || '');
      const wordData = this.reviewWordsMap.get(stem);
      const status = SpacedRepetition.getStatus(wordData);
      return status === 'new' ? 'review-word review-new' : 'review-word review-learning';
    }, word => {
      const stem = word?.stem || getStemForm(word?.word || '');
      const wordData = this.reviewWordsMap.get(stem);
      if (!wordData) return false;
      const status = SpacedRepetition.getStatus(wordData);
      return status !== 'stable';
    });
  },

  // Update SRS ratings after review reading.  The completion id is stable for
  // the whole reading cycle, so a retry after a crash replays each word's
  // attempt instead of advancing it a second time.
  async _updateReviewSRS(completionId) {
    const stableCompletionId = String(
      completionId || this.readingProgressSession?.getCompletionId?.() || ''
    ).trim();
    if (!stableCompletionId) throw new Error('阅读复习缺少稳定 completionId');
    const learnWords = await DB.getAllLearnWords();
    const contextualStems = new Set(
      [...document.querySelectorAll('#articleBody .review-word')].map(el => el.dataset.stem).filter(Boolean)
    );
    const cycleRatings = new Map();
    for (const rating of Array.isArray(this.cycleReviewRatings) ? this.cycleReviewRatings : []) {
      const wordId = Number(rating?.wordId);
      const stem = getStemForm(String(rating?.stem || '').toLowerCase());
      if (Number.isInteger(wordId) && wordId > 0) cycleRatings.set(`id:${wordId}`, rating);
      else if (stem) cycleRatings.set(`stem:${stem}`, rating);
    }

    for (const word of learnWords) {
      const stem = getStemForm(word.word.toLowerCase());
      if (!contextualStems.has(stem)) continue;

      const clicked = cycleRatings.get(`id:${word.id}`) || cycleRatings.get(`stem:${stem}`);
      const attemptId = `${stableCompletionId}:word:${word.id}`;
      if (!clicked) {
        await DB.addReviewEventOnce({
          wordId: word.id,
          source: 'reading',
          contextExposure: true,
          completionId: stableCompletionId,
          attemptId
        }, { attemptId });
        continue;
      }

      const quality = Number(clicked.quality);
      const sessionDebt = quality === 1 ? 2 : quality === 3 ? 1 : 0;
      const srsData = settleSessionReview(word, quality, sessionDebt);
      await DB.settleSessionReview(word.id, srsData, {
        rating: clicked.quality,
        source: 'reading',
        sawAnswer: true,
        contextExposure: false,
        sessionDebt,
        completionId: stableCompletionId,
        attemptId
      });
    }
  },

  // ===== Timer =====
  _bindViewportLifecycle() {
    if (typeof window === 'undefined') return;
    if (this._viewportResizeHandler) {
      window.removeEventListener('resize', this._viewportResizeHandler);
      window.removeEventListener('orientationchange', this._viewportResizeHandler);
    }
    this._viewportResizeHandler = () => this._handleViewportChange();
    window.addEventListener('resize', this._viewportResizeHandler, { passive: true });
    window.addEventListener('orientationchange', this._viewportResizeHandler, { passive: true });
  },

  _handleViewportChange() {
    if (this._viewportResizeFrame != null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(this._viewportResizeFrame);
    }
    const refresh = () => {
      this._viewportResizeFrame = null;
      if (!this.container) return;
      // Let the new viewport/grid settle before measuring completion progress.
      this._updateReadingScrollDepth();
      // A tooltip or selection action is positioned in viewport coordinates. It
      // is safer to dismiss it after rotation than to leave a stale overlay.
      if (Tooltip.isVisible()) Tooltip.hide();
      AIAnalysis.hideButton();
    };
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      this._viewportResizeFrame = window.requestAnimationFrame(refresh);
    } else {
      refresh();
    }
  },

  autoStartTimer() {
    const wordCount = this.articleData?.wordCount || 300;
    this.timer = new ReadingTimer(wordCount);

    this.timer.onTick = (elapsed, wpm) => {
      const display = document.getElementById('timerDisplay');
      const wpmEl = document.getElementById('timerWpm');
      const statusEl = document.getElementById('timerStatus');
      if (display) display.textContent = this.timer.getDisplay();
      if (wpmEl) wpmEl.textContent = wpm + ' 词/分';
      if (statusEl) statusEl.textContent = this.timer.isPaused ? '⏸ 已暂停' : '';
      this._recordReadingProgressActivity({ activeSeconds: elapsed });
      if (elapsed > 0 && elapsed % 15 === 0) {
        void this._checkpointReadingProgress({ force: true });
        void this._flushReadingActivity();
      }
    };

    this.timer.start();

    // Count only foreground reading time. Page Visibility is especially
    // important on Android where an activity can remain mounted in background.
    this._resumeHandler = () => { if (this.timer?.isPaused) this.timer.resume(); };
    this._visibilityHandler = () => {
      if (!this.timer) return;
      if (document.hidden) {
        this._recordReadingProgressActivity(this._readingProgressInput());
        void this._checkpointReadingProgress({ force: true });
        void this._flushReadingActivity();
        this.timer.pauseForVisibility();
      }
      else this.timer.resume();
    };
    this._readingScrollTarget = document.querySelector('.app-page-outlet') || document.scrollingElement || document.documentElement;
    this._scrollProgressHandler = () => {
      this._updateReadingScrollDepth({ didUserScroll: true });
      this._resumeHandler();
    };
    this._pagehideHandler = () => {
      this._recordReadingProgressActivity(this._readingProgressInput());
      void this._checkpointReadingProgress({ force: true });
      void this._flushReadingActivity();
    };
    document.addEventListener('touchstart', this._resumeHandler, { passive: true });
    document.addEventListener('visibilitychange', this._visibilityHandler);
    window.addEventListener('pagehide', this._pagehideHandler, { passive: true });
    this._readingScrollTarget?.addEventListener('scroll', this._scrollProgressHandler, { passive: true });
    this._updateReadingScrollDepth();
  },

  _updateReadingScrollDepth({ didUserScroll = false } = {}) {
    const scroller = this._readingScrollTarget || document.scrollingElement || document.documentElement;
    const scrollHeight = Number(scroller?.scrollHeight) || 0;
    const clientHeight = Number(scroller?.clientHeight) || 0;
    const scrollTop = Number(scroller?.scrollTop) || 0;
    const actualScrollProgress = Math.min(1, Math.max(0, scrollTop / Math.max(1, scrollHeight - clientHeight)));
    if (scrollHeight <= clientHeight) {
      this.readingScrollDepth = 1;
      if (didUserScroll) this._recordReadingProgressActivity({ actualScrollProgress, didUserScroll: true, fullProgress: 1 });
      return this.readingScrollDepth;
    }
    this.readingScrollDepth = Math.max(this.readingScrollDepth || 0, Math.min(1, (scrollTop + clientHeight) / scrollHeight));
    if (didUserScroll) {
      this.readingUserScrollProgress = Math.max(this.readingUserScrollProgress || 0, actualScrollProgress);
      this._recordReadingProgressActivity({ actualScrollProgress, didUserScroll: true, fullProgress: this.readingScrollDepth });
    }
    return this.readingScrollDepth;
  },

  showIncompleteReadingPrompt(qualification) {
    const existing = document.getElementById('readingIncompletePrompt');
    const overlay = existing || document.createElement('div');
    overlay.id = 'readingIncompletePrompt';
    overlay.className = 'modal-overlay';
    const phase = this.readingProgressSession?.getState?.().phase || 'preview';
    const checkpointFailed = phase === 'active'
      && (this.readingProgressSaveStatus === 'failed' || this.readingActivitySaveStatus === 'failed');
    const hasDurableProgress = !checkpointFailed && (
      phase === 'active'
        ? this.readingProgressSaveStatus === 'saved' && this.readingActivitySaveStatus === 'saved'
        : this.readingProgressSaveStatus === 'saved' || Boolean(this.readingProgress)
    );

    const details = [];
    if (qualification.missingProgress > 0) {
      details.push(`正文还需浏览约 ${Math.ceil(qualification.missingProgress * 100)}%`);
    }
    if (qualification.missingSeconds > 0) {
      details.push(`前台有效阅读还差约 ${qualification.missingSeconds} 秒`);
    }

    const progressMessage = checkpointFailed
      ? '阅读进度或阅读时长暂未保存成功，请重试后再退出。'
      : hasDurableProgress
        ? '本次阅读时间和进度已保存，但不会计入完成篇数和能力校准。'
        : '尚未形成有效阅读进度，本次不会记录，也不会计入完成篇数和能力校准。';
    const exitAction = checkpointFailed
      ? '<button class="btn btn-outline" type="button" onclick="ReadingView.retryReadingProgressSave()">重试保存</button>'
      : `<button class="btn btn-outline" type="button" onclick="ReadingView.exitWithoutCounting()">${hasDurableProgress ? '保存进度并退出' : '退出阅读'}</button>`;

    overlay.innerHTML = `
      <div class="modal modal-compact" role="dialog" aria-modal="true" aria-labelledby="incompleteReadingTitle">
        <h2 id="incompleteReadingTitle">尚未达到阅读完成条件</h2>
        <p class="text-muted">${details.join('；') || '请继续阅读后再完成。'}</p>
        <p class="text-muted">${progressMessage}</p>
        <div class="modal-actions">
          ${exitAction}
          <button class="btn btn-primary" type="button" onclick="ReadingView.dismissIncompleteReadingPrompt()">继续阅读</button>
        </div>
      </div>`;
    overlay.style.display = 'flex';
    if (!existing) document.body.appendChild(overlay);
  },

  _showReadingActivitySaveFailure() {
    const overlay = document.getElementById('readingSummary');
    if (!overlay) return;
    overlay.innerHTML = `
      <div class="modal modal-compact" role="dialog" aria-modal="true" aria-labelledby="readingActivitySaveTitle">
        <h2 id="readingActivitySaveTitle">阅读时长暂未保存</h2>
        <p class="text-muted">本次阅读还没有生成完成记录，请重试保存后再完成阅读。</p>
        <div class="modal-actions">
          <button class="btn btn-primary" type="button" onclick="ReadingView.retryReadingActivitySave()">重试保存</button>
          <button class="btn btn-outline" type="button" onclick="ReadingView.dismissReadingActivitySaveFailure()">继续阅读</button>
        </div>
      </div>`;
    overlay.style.display = 'flex';
  },

  dismissReadingActivitySaveFailure() {
    const overlay = document.getElementById('readingSummary');
    if (overlay) overlay.style.display = 'none';
  },

  _showReadingProgressCleanupFailure() {
    const overlay = document.getElementById('readingSummary');
    if (!overlay) return;
    overlay.innerHTML = `
      <div class="modal modal-compact" role="dialog" aria-modal="true" aria-labelledby="readingCleanupTitle">
        <h2 id="readingCleanupTitle">阅读已完成</h2>
        <p class="text-muted">本次阅读记录已经保存，不会重复计入；但续读进度清理暂未完成。</p>
        <p class="text-muted">请重试清理，或稍后离开。下次打开时不会把它当作普通续读进度。</p>
        <div class="modal-actions">
          <button class="btn btn-primary" type="button" onclick="ReadingView.retryReadingProgressCleanup()">重试清理</button>
          <button class="btn btn-outline" type="button" onclick="ReadingView.closeAndExit()">稍后处理</button>
        </div>
      </div>`;
    overlay.style.display = 'flex';
  },

  dismissIncompleteReadingPrompt() {
    const overlay = document.getElementById('readingIncompletePrompt');
    if (overlay) overlay.style.display = 'none';
  },

  async retryReadingProgressSave() {
    if (this.readingProgressFinalizing) return;
    const result = await this._checkpointReadingProgress({ force: true });
    this.readingProgressSaveStatus = result.ok ? 'saved' : 'failed';
    const activityResult = await this._flushReadingActivity();
    this.readingActivitySaveStatus = activityResult.ok ? 'saved' : 'failed';
    this.showIncompleteReadingPrompt(this.incompleteReadingQualification || {});
  },

  async retryReadingActivitySave() {
    if (this.readingProgressFinalizing) return;
    const result = await this._flushReadingActivity({
      markCompleted: Boolean(this.readingActivityCompletionPending)
    });
    if (!result.ok) {
      this._showReadingActivitySaveFailure();
      return false;
    }
    this.readingActivityCompletionPending = false;
    this.dismissReadingActivitySaveFailure();
    if (this.readingCompletionSummary) {
      const summary = this.readingCompletionSummary;
      this.readingCompletionSummary = null;
      await this.showSummary(summary.elapsed, summary.wpm, summary.readingQualification);
    } else {
      await this.finishReading();
    }
    return true;
  },

  async exitWithoutCounting() {
    if ((this.readingProgressSaveStatus === 'failed' || this.readingActivitySaveStatus === 'failed')
      && this.readingProgressSession?.getState?.().phase === 'active') {
      this.showIncompleteReadingPrompt(this.incompleteReadingQualification || {});
      return;
    }
    if (this.readingProgressSession?.getState?.().phase === 'active') {
      this._recordReadingProgressActivity(this._readingProgressInput());
      const checkpointResult = await this._checkpointReadingProgress({ force: true });
      if (!checkpointResult.ok) {
        this.readingProgressSaveStatus = 'failed';
        this.showIncompleteReadingPrompt(this.incompleteReadingQualification || {});
        return false;
      }
      this.readingProgressSaveStatus = 'saved';
      const activityResult = await this._flushReadingActivity();
      if (!activityResult.ok) {
        this.showIncompleteReadingPrompt(this.incompleteReadingQualification || {});
        return false;
      }
      this.readingActivitySaveStatus = 'saved';
    }
    this.dismissIncompleteReadingPrompt();
    const cleanupResult = await this.cleanup({ skipProgressCheckpoint: true });
    if (cleanupResult?.progressSaved === false) {
      this.readingProgressSaveStatus = 'failed';
      this.showIncompleteReadingPrompt(this.incompleteReadingQualification || {});
      return false;
    }
    if (cleanupResult?.activitySaved === false) {
      this.readingActivitySaveStatus = 'failed';
      this.showIncompleteReadingPrompt(this.incompleteReadingQualification || {});
      return false;
    }
    this.goBack();
    return true;
  },

  // Finish reading
  async finishReading() {
    if (this.readingProgressFinalizing) return;
    if (this.readingProgressCompletion?.factsRecorded) {
      if (this.readingActivityCompletionPending) {
        const activityResult = await this._flushReadingActivity({ markCompleted: true });
        if (!activityResult.ok) {
          this._showReadingActivitySaveFailure();
          return;
        }
      }
      await this.retryReadingProgressCleanup();
      return;
    }
    const elapsed = this.timer?.elapsed || 0;
    const wordCount = this.articleData?.wordCount || 0;
    this._updateReadingScrollDepth();
    const finishActivity = this._readingProgressInput();
    this._recordReadingProgressActivity(finishActivity);
    const progressSnapshot = this.readingProgressSession?.getSnapshot?.();
    const completionId = this.readingProgressSession?.getCompletionId?.()
      || progressSnapshot?.completionId
      || null;
    const cumulativeActiveSeconds = this.readingProgressSession?.getCumulativeActiveSeconds?.({ activeSeconds: elapsed }) || elapsed;
    const activeSeconds = cumulativeActiveSeconds;
    const contentProgressAtFinish = Math.max(
      this.readingScrollDepth || 0,
      this.getSentenceGuideProgress(),
      Number(progressSnapshot?.full?.maxProgress) || 0
    );
    const readingQualification = evaluateReadingSession({
      completed: true,
      contentProgress: contentProgressAtFinish,
      activeSeconds,
      wordCount
    });
    const completeSpan = diagnosticLogger()?.beginSpan('reading.complete', {
      category: 'reading',
      correlationId: `reading-complete:${this.articleData?.id || 'unknown'}:${Date.now()}`,
      payload: { articleId: this.articleData?.id, wordCount, completionId }
    });
    if (!readingQualification.qualified) {
      this.incompleteReadingQualification = readingQualification;
      if (this.readingProgressSession?.getState?.().phase === 'active') {
        const checkpointResult = await this._checkpointReadingProgress({ force: true });
        this.readingProgressSaveStatus = checkpointResult.ok ? 'saved' : 'failed';
        const activityResult = await this._flushReadingActivity();
        if (!activityResult.ok) this.readingActivitySaveStatus = 'failed';
      } else {
        this.readingProgressSaveStatus = this.readingProgress ? 'saved' : 'none';
      }
      completeSpan?.end({ payload: { qualified: false, reason: readingQualification.reason || 'qualification' } });
      diagnosticLogger()?.record('reading.completed', {
        category: 'reading',
        payload: { articleId: this.articleData?.id, qualified: false, elapsedMs: elapsed }
      });
      this.showIncompleteReadingPrompt(readingQualification);
      return;
    }

    // Pressing the completion action is itself an explicit user signal.  It
    // lets an already-saved snapshot complete without manufacturing time or
    // requiring the learner to press the resume button first.
    if (this.readingProgressSession?.getState?.().phase !== 'active') {
      this.readingProgressSession?.activate?.('completion');
    }
    this.readingProgressSaveStatus = null;
    this.readingActivitySaveStatus = null;
    this.readingProgressFinalizing = true;

    // Both resumable progress and the daily active-time fact must be durable
    // before a new completion fact is recorded.  The finalization flag stops
    // timer callbacks from racing this preflight, while a failure leaves the
    // same session alive for an explicit retry.
    let progressFlushError = null;
    try {
      await this.readingProgressSession?.flush(finishActivity);
    } catch (error) {
      progressFlushError = error;
      diagnosticLogger()?.record('reading.progress_flush_failed', {
        category: 'reading',
        level: 'error',
        payload: { articleId: this.articleData?.id, message: String(error?.message || error) }
      });
    }
    if (progressFlushError) {
      this.readingProgressFinalizing = false;
      this.readingProgressSaveStatus = 'failed';
      completeSpan?.end({ payload: { qualified: false, reason: 'progress_flush_failed' } });
      this.showIncompleteReadingPrompt(readingQualification);
      return;
    }
    const activityFlushResult = await this._flushReadingActivity();
    if (!activityFlushResult.ok) {
      this.readingProgressFinalizing = false;
      completeSpan?.end({ payload: { qualified: false, reason: 'activity_flush_failed' } });
      this._showReadingActivitySaveFailure();
      return;
    }

    this.timer?.stop();

    // Clean up listeners
    if (this._resumeHandler) {
      document.removeEventListener('touchstart', this._resumeHandler);
      this._resumeHandler = null;
    }
    if (this._readingScrollTarget && this._scrollProgressHandler) {
      this._readingScrollTarget.removeEventListener('scroll', this._scrollProgressHandler);
    }
    this._readingScrollTarget = null;
    this._scrollProgressHandler = null;
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }
    if (this._pagehideHandler && typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this._pagehideHandler);
      this._pagehideHandler = null;
    }

    // Save reading stat
    const wpm = activeSeconds > 0 ? Math.round(wordCount / (activeSeconds / 60)) : 0;
    const scrollDepth = contentProgressAtFinish;
    const articleTrack = resolveArticleTrack(this.articleData || {});
    await DB.saveReadingStat({
      articleId: this.articleData?.id,
      completionId,
      wordCount,
      elapsed: activeSeconds,
      activeSeconds,
      scrollDepth,
      contentProgress: scrollDepth,
      completed: true,
      wpm,
      clickCount: this.clickedWords.length,
      clickedWords: this.clickedWords.map(w => w.word),
      qualificationVersion: 2,
      activityAccountingVersion: 1,
      readingMode: this.guideModeUsed ? 'guide' : 'full',
      articleSnapshot: {
        title: this.articleData?.title || '',
        difficulty: this.articleData?.difficulty || '',
        targetTrack: articleTrack.targetTrack,
        examType: this.articleData?.examType || '',
        wordCount
      }
    });

    // A completed, sufficiently read article is useful calibration evidence,
    // but it must never be interpreted as direct knowledge of any individual word.
    // Await this small, local write so the third completed article can offer
    // its single calibration feedback prompt in the summary immediately.
    await knowledgeEvidenceBridge.recordQualifiedReadingObservation({
      articleId: this.articleData?.id,
      wordCount,
      completed: true,
      scrollDepth,
      activeSeconds: cumulativeActiveSeconds,
      occurredAt: Date.now()
    });

    // Update SRS for review mode
    if (this.reviewMode) {
      await this._updateReviewSRS(completionId);
    }

    // The reading stat is the completion authority.  Marking the current day
    // activity as completed is a separate, retryable latest-wins write so a
    // failure here can never make us repeat the formal completion facts.
    const completionActivityResult = await this._flushReadingActivity({ markCompleted: true });
    this.readingActivityCompletionPending = !completionActivityResult.ok;

    // Durable completion facts are already written at this point.  Mark that
    // fact once so a retry after cleanup failure can only remove progress and
    // cannot repeat stats, evidence, or review SRS settlement.
    this.readingProgressCompletion = {
      factsRecorded: true,
      cleanupPending: true,
      completionId
    };
    this.readingCompletionSummary = {
      elapsed: cumulativeActiveSeconds,
      wpm,
      readingQualification: { qualifiesForCalibration: readingQualification.qualified }
    };
    if (this.readingActivityCompletionPending) {
      // Keep the checkpoint and its stable completionId until the completed-day
      // activity is durable.  A restart can then replay the already-idempotent
      // completion facts and retry the activity write before progress cleanup.
      this.readingProgressFinalizing = false;
      completeSpan?.end({
        payload: {
          qualified: true,
          activityCompletionPending: true,
          elapsedMs: cumulativeActiveSeconds,
          wordCount,
          completionId
        }
      });
      this._showReadingActivitySaveFailure();
      return;
    }
    const cleanupSucceeded = await this._retryReadingProgressCleanup({ showFailure: false });
    if (!cleanupSucceeded) {
      completeSpan?.end({ payload: { qualified: true, cleanupPending: true, elapsedMs: cumulativeActiveSeconds, wordCount, completionId } });
      diagnosticLogger()?.record('reading.completed_cleanup_pending', {
        category: 'reading',
        level: 'error',
        payload: { articleId: this.articleData?.id, elapsedMs: cumulativeActiveSeconds, wordCount, completionId }
      });
      this._showReadingProgressCleanupFailure();
      return;
    }

    // Show summary popup.  Keep the compact completion summary in memory so a
    // failed completedToday activity write can be retried without repeating
    // reading facts or review SRS settlement.
    await this.showSummary(cumulativeActiveSeconds, wpm, { qualifiesForCalibration: readingQualification.qualified });
    completeSpan?.end({ payload: { qualified: true, elapsedMs: cumulativeActiveSeconds, wordCount, reviewMode: this.reviewMode, completionId } });
    diagnosticLogger()?.record('reading.completed', {
      category: 'reading',
      payload: { articleId: this.articleData?.id, qualified: true, elapsedMs: cumulativeActiveSeconds, wordCount, reviewMode: this.reviewMode, completionId }
    });
  },

  async showSummary(elapsed, wpm, readingQualification = {}) {
    const avgWpm = await DB.getAverageWPM();
    const feedbackCheckpoint = await this._getReadingFeedbackCheckpoint();
    const diff = avgWpm > 0 ? wpm - avgWpm : 0;
    const diffPct = avgWpm > 0 ? Math.round(diff / avgWpm * 100) : 0;
    const clickCount = this.clickedWords.length;

    // Review mode statistics
    const reviewClicked = this.clickedWords.filter(w => w.isReviewWord);
    const reviewClickedCount = reviewClicked.length;
    const reviewTotal = this.reviewWordsMap.size;
    const reviewRecognized = reviewTotal - reviewClickedCount;

    const overlay = document.getElementById('readingSummary');
    overlay.innerHTML = `
      <div class="modal modal-wide">
        <h2>${this.reviewMode ? '🔄 复习阅读完成！' : '📊 阅读完成！'}</h2>
        <div class="summary-stats">
          <div class="summary-stat">
            <span class="summary-stat-icon">⏱</span>
            <span class="summary-stat-num">${this.formatTime(elapsed)}</span>
            <span class="summary-stat-label">用时</span>
          </div>
          <div class="summary-stat">
            <span class="summary-stat-icon">📖</span>
            <span class="summary-stat-num">${wpm}</span>
            <span class="summary-stat-label">词/分</span>
          </div>
          ${avgWpm > 0 ? `
          <div class="summary-stat">
            <span class="summary-stat-icon">📈</span>
            <span class="summary-stat-num">${avgWpm}</span>
            <span class="summary-stat-label">历史平均</span>
          </div>
          <div class="summary-stat">
            <span class="summary-stat-icon">${diff >= 0 ? '⬆️' : '⬇️'}</span>
            <span class="summary-stat-num" style="color:${diff >= 0 ? 'var(--success)' : 'var(--danger)'}">${diff >= 0 ? '+' : ''}${diffPct}%</span>
            <span class="summary-stat-label">vs 平均</span>
          </div>` : ''}
          <div class="summary-stat">
            <span class="summary-stat-icon">🔍</span>
            <span class="summary-stat-num">${clickCount}</span>
            <span class="summary-stat-label">查词数</span>
          </div>
        </div>
        ${this.reviewMode ? `
        <div class="summary-stats" style="margin-top:12px">
          <div class="summary-stat">
            <span class="summary-stat-icon">📝</span>
            <span class="summary-stat-num">${reviewTotal}</span>
            <span class="summary-stat-label">标记词数</span>
          </div>
          <div class="summary-stat">
            <span class="summary-stat-icon">✅</span>
            <span class="summary-stat-num" style="color:var(--success)">${reviewRecognized}</span>
            <span class="summary-stat-label">认识</span>
          </div>
          <div class="summary-stat">
            <span class="summary-stat-icon">❌</span>
            <span class="summary-stat-num" style="color:var(--danger)">${reviewClickedCount}</span>
            <span class="summary-stat-label">不熟/不认识</span>
          </div>
        </div>` : ''}
        ${reviewClickedCount > 0 ? `
        <div class="summary-words">
          <h3>${this.reviewMode ? '❌ 不熟/不认识的词' : '📝 本篇查词'}</h3>
          <div class="summary-word-list">
            ${reviewClicked.map(w => `<span class="summary-word-chip">${esc(w.word)}</span>`).join('')}
          </div>
        </div>` : ''}
        ${!readingQualification?.qualifiesForCalibration ? `
        <section class="reading-calibration-notice" aria-label="校准进度提示">
          <h3>本篇未计入校准进度</h3>
          <p>阅读记录已保存，但正文浏览未达到 70%，因此不会作为难度校正的有效阅读。完整浏览后完成阅读即可计入。</p>
        </section>` : ''}
        ${this.readingActivityCompletionPending ? `
        <section class="reading-calibration-notice" aria-label="阅读时长保存状态">
          <h3>阅读时长待同步</h3>
          <p>完成记录已经保存，但今日日报中的阅读时长还未保存成功。</p>
          <button class="btn btn-outline btn-sm" type="button" onclick="ReadingView.retryReadingActivitySave()">重试保存</button>
        </section>` : ''}
        ${feedbackCheckpoint?.shouldRequestFeedback ? `
        <section class="reading-ease-feedback" aria-label="阅读难度反馈">
          <h3>这三篇阅读对你来说如何？</h3>
          <p>这会帮助我们校正保守模式；不会改变你选择的目标考试。</p>
          <div class="reading-ease-feedback-actions">
            <button class="btn btn-outline btn-sm" onclick="ReadingView.saveReadingEaseFeedback('too_hard')">偏难</button>
            <button class="btn btn-outline btn-sm" onclick="ReadingView.saveReadingEaseFeedback('fitting')">合适</button>
            <button class="btn btn-outline btn-sm" onclick="ReadingView.saveReadingEaseFeedback('too_easy')">偏易</button>
          </div>
        </section>` : ''}
        <div class="modal-actions summary-actions">
          ${!this.reviewMode && this.clickedWords.length > 0 ? `
          <button class="btn btn-outline" onclick="ReadingView.addToReview()">加入词库</button>
          <button class="btn btn-primary" onclick="ReadingView.generateReview()">生成巩固阅读</button>` : ''}
          <button class="btn" onclick="ReadingView.closeAndExit()">关闭</button>
        </div>
      </div>`;
    overlay.style.display = 'flex';
  },

  formatTime(seconds) {
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return min > 0 ? `${min} 分 ${sec} 秒` : `${sec} 秒`;
  },

  // Close summary and exit article
  closeAndExit() {
    document.getElementById('readingSummary').style.display = 'none';
    this.goBack();
  },

  // Add clicked words to review
  async addToReview() {
    let added = 0;
    let skipped = 0;
    for (const w of this.clickedWords) {
      try {
        const saved = await DB.saveVocabularyWord({
          articleId: this.articleData?.id ?? null,
          word: w.word,
          translation: w.translation || '',
          phonetic: w.phonetic || '',
          pos: w.pos || '',
          definitionSenses: w.definitionSenses || [],
          definitionSchemaVersion: w.definitionSchemaVersion || 0,
          definitionLexiconVersion: w.definitionLexiconVersion || ''
        });
        if (saved.createdVocabulary || saved.createdLearnWord || saved.restored) added++;
        else skipped++;
      } catch {}
    }
    const msg = added > 0
      ? `已将 ${added} 个单词加入我的词汇${skipped > 0 ? `（${skipped} 个已存在，已跳过）` : ''}`
      : `所有 ${skipped} 个单词已在我的词汇中`;
    alert(msg);
  },

  ensureTargetTrackBeforeGeneration() {
    if (!requiresTargetTrackSelection(Config.get('exam_level'), Config.get('target_track_selection_required'))) {
      return false;
    }
    alert('生成巩固阅读前，请先选择目标考试。初测页面可选择四级、六级、考研英语一或考研英语二。');
    location.hash = '#/assessment';
    return true;
  },

  // Generate review article from clicked words
  async generateReview() {
    if (this.ensureTargetTrackBeforeGeneration()) return;
    if (!Config.hasApiKey()) { Modal.showApiSettings(); return; }
    const allWords = normalizeTargetWords(this.clickedWords.map(w => w.word), Number.POSITIVE_INFINITY);
    if (allWords.length < 2) { alert('查词太少，无法生成'); return; }

    document.getElementById('readingSummary').style.display = 'none';
    location.hash = '#/chat';
    await new Promise(r => setTimeout(r, 100));

    return ChatView.generateReviewReadings({
      reviewWords: allWords,
      difficulty: Config.get('exam_level') || 'cet4',
      topic: '阅读巩固',
      sourceLabel: '本篇查词'
    });
  },

  async _getReadingFeedbackCheckpoint() {
    if (Config.get('calibration_status') !== 'skipped') return null;
    try {
      const profile = createKnowledgeProfileRepository(DB);
      return await profile.getQualifiedReadingObservationCheckpoint();
    } catch (error) {
      console.warn('Unable to prepare reading ease feedback.', error);
      return null;
    }
  },

  async saveReadingEaseFeedback(choice) {
    try {
      const profile = createKnowledgeProfileRepository(DB);
      await profile.saveQualifiedReadingDifficultyFeedback(choice);
      const adjusted = applyReadingEaseFeedback({ recommendedChallenge: Config.get('reading_mode') || 'support' }, choice);
      Config.set('reading_mode', adjusted.recommendedChallenge);
      Config.set('level', adjusted.recommendedChallenge === 'support' ? 'easy' : adjusted.recommendedChallenge === 'stretch' ? 'hard' : 'normal');
      const section = document.querySelector('.reading-ease-feedback');
      if (section) section.innerHTML = '<p class="text-muted">已记录。后续材料会据此微调，目标考试保持不变。</p>';
    } catch (error) {
      alert(error?.message || '反馈保存失败，请稍后再试。');
    }
  },

  // ===== Translation =====
  async _persistParagraphTranslations() {
    const translation = this._syncTranslationText();
    await DB.updateArticle(this.articleData.id, {
      paragraphTranslations: this.paragraphTranslations,
      translation
    });
    this.articleData.paragraphTranslations = [...this.paragraphTranslations];
    this.articleData.translation = translation;
  },

  _renderParagraphTranslation(index, visible = true) {
    const pair = document.querySelector(`.paragraph-pair[data-paragraph-index="${index}"]`);
    if (!pair) return;
    const text = this.paragraphTranslations[index] || '';
    if (!text) return;
    const btn = pair.querySelector('.btn-paragraph-translate');
    let zhEl = pair.querySelector('.zh-paragraph');
    if (!zhEl) {
      zhEl = document.createElement('p');
      zhEl.className = 'zh-paragraph';
      pair.appendChild(zhEl);
    }
    zhEl.textContent = text;
    zhEl.style.display = visible ? 'block' : 'none';
    if (btn) {
      btn.textContent = visible ? '隐' : '译';
      btn.classList.toggle('active', visible);
    }
  },

  toggleTitleTranslation(btn) {
    const translation = btn?.parentElement?.querySelector('.reading-title-zh');
    if (!translation) return;
    const show = translation.style.display === 'none';
    translation.style.display = show ? 'block' : 'none';
    btn.textContent = show ? '隐' : '译';
    btn.classList.toggle('active', show);
    btn.setAttribute('aria-expanded', String(show));
  },

  async toggleTranslation() {
    const toggleBtn = document.getElementById('translateBtn');
    const setToolbarState = ({ pressed = false, pending = false } = {}) => {
      if (!toggleBtn) return;
      toggleBtn.disabled = pending;
      toggleBtn.classList.toggle('is-active', pressed);
      toggleBtn.setAttribute('aria-pressed', String(pressed));
      const state = toggleBtn.querySelector('.reading-action-state');
      if (state) state.textContent = pending ? '翻译中…' : pressed ? '已显示' : '未显示';
    };
    const missing = this.paragraphTranslations
      .map((text, index) => text ? -1 : index)
      .filter(index => index >= 0);
    const available = this.paragraphTranslations.filter(Boolean).length;

    // 全部已有翻译时，只切换显示/隐藏，不再请求 API
    if (missing.length === 0 && available > 0) {
      const anyVisible = Array.from(document.querySelectorAll('.zh-paragraph'))
        .some(p => p.style.display !== 'none');
      this.paragraphTranslations.forEach((text, index) => {
        if (text) this._renderParagraphTranslation(index, !anyVisible);
      });
      setToolbarState({ pressed: !anyVisible });
      return;
    }

    if (!Config.hasApiKey()) {
      alert('需要 API Key 才能翻译');
      return;
    }
    setToolbarState({ pending: true });

    const articleId = this.articleData.id;
    const enParas = this._splitParas(this.articleData.content);
    try {
      // 只补齐未译段，已通过单段翻译得到的内容绝不重复请求
      for (const index of missing) {
        const text = await API.translateSentence(enParas[index]);
        if (this.articleData?.id !== articleId) return;
        if (text) this.paragraphTranslations[index] = text;
      }
      await this._persistParagraphTranslations();
      this.paragraphTranslations.forEach((text, index) => {
        if (text) this._renderParagraphTranslation(index, true);
      });
      setToolbarState({ pressed: true });
    } catch (e) {
      console.warn('全文翻译失败:', e);
      setToolbarState();
    } finally {
      if (toggleBtn && this.articleData?.id === articleId) toggleBtn.disabled = false;
    }
  },

  async toggleParagraph(btn) {
    const index = Number(btn.dataset.paragraphIndex);
    const pair = btn.closest('.paragraph-pair');
    const existing = pair?.querySelector('.zh-paragraph');

    // 已有译文：只切换本段，不请求 API
    if (existing && (this.paragraphTranslations[index] || existing.textContent.trim())) {
      const isVisible = existing.style.display !== 'none';
      existing.style.display = isVisible ? 'none' : 'block';
      btn.textContent = isVisible ? '译' : '隐';
      btn.classList.toggle('active', !isVisible);
      return;
    }

    if (!Config.hasApiKey()) {
      alert('需要 API Key 才能翻译');
      return;
    }
    if (btn.disabled) return;

    const articleId = this.articleData.id;
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = '翻译中…';
    try {
      // 从数据源取原文，避免复习模式的 <mark> 高亮标签进入翻译请求
      const enParagraph = this._splitParas(this.articleData.content)[index];
      const translation = await API.translateSentence(enParagraph);
      if (!translation || this.articleData?.id !== articleId) return;
      this.paragraphTranslations[index] = translation;
      await this._persistParagraphTranslations();
      this._renderParagraphTranslation(index, true);
      const toggleBtn = document.getElementById('translateBtn');
      if (toggleBtn) {
        toggleBtn.classList.remove('is-active');
        toggleBtn.setAttribute('aria-pressed', 'false');
        const state = toggleBtn.querySelector('.reading-action-state');
        if (state) state.textContent = '未显示';
      }
    } catch (e) {
      console.warn('段落翻译失败:', e);
    } finally {
      if (this.articleData?.id === articleId) {
        btn.disabled = false;
        if (!this.paragraphTranslations[index]) btn.textContent = originalLabel;
      }
    }
  },

  // ===== Favorite =====
  async toggleFavorite(articleId) {
    const article = await DB.getArticle(articleId);
    if (!article) return;
    const newFav = article.favorite ? 0 : 1;
    // 收藏时确保本地正文齐全: 云端后续删除也仍可在本地阅读
    if (newFav === 1) {
      if (!article.content || !article.content.trim()) {
        const url = article.url || article.sourceUrl || '';
        if (url) {
          try {
            const serverUrl = ARTICLE_SERVER_URL;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15000);
            const resp = await fetch(`${serverUrl}/api/articles/${article.id}`, { signal: controller.signal });
            clearTimeout(timer);
            if (resp.ok) {
              const full = await resp.json();
              if (full && full.content && full.content.trim()) {
                await DB.updateArticle(articleId, { content: full.content, summary: full.summary || article.summary });
              }
            }
          } catch (e) {
            console.warn('补抓全文失败:', e);
          }
        }
      }
    }
    await DB.updateArticle(articleId, { favorite: newFav });
    this._syncHeaderFavorite({ favorite: newFav });
  }
};

window.ReadingView = ReadingView;
