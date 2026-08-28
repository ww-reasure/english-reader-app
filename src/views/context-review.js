import { API } from '../api.js';
import { ContextReview } from '../components/context-review.js';
import { ContextReviewResult, scheduleContextReview } from '../context-review-scheduler.mjs';
import { DB } from '../db.js';
import { Dictionary } from '../dictionary.js';
import { formatPartOfSpeech, getDefinitionSenses, getSavableTranslation } from '../components/definition-trust.mjs';
import { esc, escAttr, getStemForm } from '../helpers.js';
import { ReviewQueue } from '../review-queue.js';
import { Tooltip } from '../components/tooltip.js';
import { WordStudyDetail } from '../components/word-study-detail.js';
import { Config } from '../config.js';
import { createLexiconLoader } from '../lexicon-runtime.mjs';
import { createKnowledgeEvidenceBridge } from '../components/knowledge-evidence-bridge.mjs';
import { getTrackLabel, requiresTargetTrackSelection } from '../learning-track.mjs';
import { makeContextReviewCacheKey } from '../components/context-review-runtime.mjs';
import { ActivityType } from '../learning-activity.mjs';
import { localDayKey } from '../learning-day.mjs';
import { StudySessionTimer } from '../study-session-timer.mjs';
import { getReviewPersistence, readEmergencySessionCheckpoint } from '../review-persistence.mjs';
import { summarizeReviewPersistenceStatus } from '../review-persistence-status.mjs';

const ACTIVE_SESSION_ID = 'context-review-active';
const TODAY_KEY = 'todayReviewedWords';
const RESULT_LABELS = { known: '认识', uncertain: '模糊', unknown: '不认识' };
const RESULT_QUALITY = { known: 5, uncertain: 3, unknown: 1 };
const knowledgeEvidenceBridge = createKnowledgeEvidenceBridge({ lexiconLoader: createLexiconLoader(), storage: DB });

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function rememberToday(word, result, attemptId = '') {
  let rows = [];
  try {
    const stored = JSON.parse(localStorage.getItem(TODAY_KEY));
    if (stored?.date === todayKey() && Array.isArray(stored.words)) rows = stored.words;
  } catch {}
  const item = {
    word: word.word,
    translation: getSavableTranslation(word),
    quality: RESULT_QUALITY[result],
    reviewMode: 'context',
    attemptId
  };
  const index = rows.findIndex(row => row.word === item.word);
  if (index >= 0) rows[index] = { ...rows[index], ...item };
  else rows.push(item);
  localStorage.setItem(TODAY_KEY, JSON.stringify({ date: todayKey(), words: rows }));
}

export function buildReviewSummary({ counts = {}, missing = 0 } = {}) {
  const count = value => Math.max(0, Number(value) || 0);
  return {
    known: count(counts.known),
    uncertain: count(counts.uncertain),
    unknown: count(counts.unknown),
    skipped: count(counts.skipped),
    missing: count(missing)
  };
}

function wordTokens(sentence, item, answered) {
  const targetStem = getStemForm(item.lemma);
  return String(sentence || '').split(/([A-Za-z]+(?:['’-][A-Za-z]+)*)/g).map((part, index) => {
    if (!/^[A-Za-z]/.test(part)) return esc(part);
    const protectedWord = getStemForm(part) === targetStem || part.toLocaleLowerCase('en-US') === item.targetForm;
    if (protectedWord) {
      if (!answered) {
        return `<button class="context-review-word context-review-target" type="button" data-context-target="true">${esc(part)}</button>`;
      }
      return `<button class="context-review-word context-review-target context-review-answered-word" type="button" data-context-word="${escAttr(part)}" data-context-target="true" data-token-index="${index}">${esc(part)}</button>`;
    }
    return `<button class="context-review-word" type="button" data-context-word="${escAttr(part)}" data-token-index="${index}">${esc(part)}</button>`;
  }).join('');
}

function renderDefinition(item) {
  const senses = getDefinitionSenses(item.word);
  const contextual = Number.isInteger(item.senseIndex) ? senses[item.senseIndex] : null;
  const line = contextual || senses[0];
  if (!line) return '<p class="context-review-answer-missing">本句义暂无法可靠判断</p>';
  return `<p class="context-review-sense"><span>${esc(formatPartOfSpeech(line.pos) || '词性待确认')}</span><strong>${esc(line.glossZh)}</strong></p>`;
}

function renderContextSource(item) {
  const labels = {
    'exam-passage': '真题正文',
    'exam-question': '真题题干',
    article: '我的书架',
    example: '既有例句',
    ai: 'AI 定制例句',
    cache: '本地缓存'
  };
  const detail = [item.paperLabel, item.positionLabel].filter(Boolean).join(' · ');
  const challengeLabels = { support: '巩固', standard: '对标', stretch: '加压' };
  const trackLabel = getTrackLabel(item.examTrack || item.sourceTrack || item.targetTrack || 'cet4');
  const original = String(item.originalDifficultyProfileKey || '').split(':');
  const legacyOriginal = original[0] === 'context-v1';
  const originalTrack = legacyOriginal && original.length >= 3 ? getTrackLabel(original[1]) : '';
  const originalChallenge = legacyOriginal
    ? challengeLabels[original[2]]
    : challengeLabels[original[1]];
  const originalCoverageKey = legacyOriginal ? original[3] : original[2];
  const originalCoverage = /^c\d+$/.test(originalCoverageKey || '') ? ` · 覆盖率 ${originalCoverageKey.slice(1)}%` : '';
  const difficultyLabel = item.difficultyStatus === 'authentic'
    ? `${trackLabel}原句`
    : item.difficultyStatus === 'offline-fallback'
      ? `本地缓存 · 原设定${originalTrack ? ` ${originalTrack}${originalChallenge ? ` · ${originalChallenge}` : ''}${originalCoverage}` : ''}`
      : `${challengeLabels[item.challenge] || '对标'}${Number.isFinite(Number(item.coverage)) ? ` · 覆盖率 ${Number(item.coverage)}%` : ''}`;
  return `来源：${esc(labels[item.source] || labels.cache)}<small>${esc(difficultyLabel)}${detail ? ` · ${esc(detail)}` : ''}</small>`;
}

export const ContextReviewView = {
  container: null,
  session: null,
  currentIndex: 0,
  answered: null,
  submitting: false,
  assistedLookupCount: 0,
  counts: { known: 0, uncertain: 0, unknown: 0, skipped: 0 },
  notice: '',
  translationLoading: false,
  controller: null,
  _clickHandler: null,
  _tooltipDismissCleanup: null,
  correctionBaseline: null,
  correctionAttemptId: '',
  correctionDone: false,
  pendingEvidence: null,
  tooltipWord: '',
  reviewSessionId: '',
  reviewTimer: null,
  reviewTimerBaseDuration: 0,
  reviewTimerStartedAt: 0,
  reviewSummarySaved: false,
  completedWordIds: new Set(),
  reviewPersistence: null,
  _reviewPersistenceUnsubscribe: null,
  _resultPersistenceRetrying: false,

  bindReviewPersistenceStatus() {
    this._reviewPersistenceUnsubscribe?.();
    this._reviewPersistenceUnsubscribe = this.reviewPersistence?.subscribe?.(event => {
      if (!event || !this.container) return;
      this.updateResultPersistenceStatus();
      // Keep the result page stable while late background writes report their
      // final state; its status node is updated independently below.
      if (this.container.querySelector?.('[data-review-persistence-status]')) return;
      if (!['rating_failed', 'rating_completed'].includes(event.type)) return;
      const current = this.session?.items?.[this.currentIndex];
      if (!current || Number(event.wordId) !== Number(current.wordId)) return;
      if (event.type === 'rating_failed') {
        this.notice = '本次判断已记录但暂未保存，稍后将自动重试。';
        if (this.answered) this.renderCard();
      } else if (event.type === 'rating_completed' && this.notice.includes('暂未保存')) {
        this.notice = '已保存';
        if (this.answered) this.renderCard();
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
    statusNode.innerHTML = `<span>${summary.message}</span>${summary.retryable ? ' <button class="review-persistence-retry" type="button">重试</button>' : ''}`;
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
      // Keep the journal as the source of truth; the final status update
      // leaves a visible retry action when the write still fails.
    } finally {
      this._resultPersistenceRetrying = false;
      this.updateResultPersistenceStatus();
    }
  },

  startReviewTimer() {
    if (!this.session || (this.reviewTimer && !this.reviewSummarySaved)) return;
    const startedAt = Math.max(0, Number(this.session.startedAt) || Number(this.session.createdAt) || Date.now());
    this.reviewSessionId = String(this.session.sessionId || `context-review:${startedAt}`);
    this.session.sessionId = this.reviewSessionId;
    this.session.startedAt = startedAt;
    this.reviewTimerBaseDuration = Math.max(0, Number(this.session.activeDurationMs) || 0);
    this.reviewTimerStartedAt = startedAt;
    this.reviewTimer = new StudySessionTimer({
      sessionId: this.reviewSessionId,
      mode: 'context'
    });
    this.reviewTimer.start({ contextKey: 'context-review' });
    this.reviewSummarySaved = false;
  },

  noteReviewActivity() {
    this.reviewTimer?.noteActivity();
  },

  async persistReviewSummary(status) {
    if (!this.reviewTimer || this.reviewSummarySaved) return;
    const counts = buildReviewSummary({ counts: this.counts, missing: this.session?.missingCount });
    const durationMs = Math.max(0, Math.round(this.reviewTimerBaseDuration + this.reviewTimer.getActiveDuration()));
    const completedWordIds = [...this.completedWordIds].map(Number).filter(Number.isFinite);
    const hasActivity = durationMs > 0 || completedWordIds.length > 0 || Object.values(counts).some(value => value > 0);

    this.reviewTimer.finish(status);
    this.reviewTimerBaseDuration = durationMs;
    if (this.session) this.session.activeDurationMs = durationMs;
    this.reviewSummarySaved = true;
    if (status === 'partial' && !hasActivity) return;

    const occurredAt = Date.now();
    try {
      await DB.saveLearningActivity({
        id: `review-session-summary:${this.reviewSessionId}`,
        type: ActivityType.REVIEW_SESSION_SUMMARY,
        occurredAt,
        dayKey: localDayKey(occurredAt),
        sessionId: this.reviewSessionId,
        dedupeKey: `review-summary:${this.reviewSessionId}`,
        payload: {
          mode: 'context',
          scope: 'scheduled',
          status,
          durationMs,
          counts,
          completedWordIds,
          recovery: { fragile: 0, relearning: 0, difficult: 0, reducedStages: 0, stubborn: 0 }
        }
      });
    } catch (error) {
      console.warn('语境复习活动汇总保存失败', error);
    }
  },

  async render(container) {
    this.cleanup();
    this.container = container;
    this.reviewPersistence = getReviewPersistence(DB);
    this.bindReviewPersistenceStatus();
    this.session = null;
    this.currentIndex = 0;
    this.answered = null;
    this.submitting = false;
    this.assistedLookupCount = 0;
    this.counts = { known: 0, uncertain: 0, unknown: 0, skipped: 0 };
    this.completedWordIds = new Set();
    this.reviewSessionId = '';
    this.reviewTimer = null;
    this.reviewTimerBaseDuration = 0;
    this.reviewTimerStartedAt = 0;
    this.reviewSummarySaved = false;
    this.notice = '';
    this.pendingEvidence = null;
    this.controller = new AbortController();
    container.innerHTML = '<main class="app-standard-page context-review-page context-review-content" data-context-review-content="loading"><div class="context-review-loading"><span></span><p>正在准备语境句子…</p><small>优先使用目标考试真题原句，缺失时按当前难度补全</small></div></main>';
    try {
      const [storedSession, emergencySession] = await Promise.all([
        DB.getContextReviewSession(ACTIVE_SESSION_ID).catch(() => null),
        Promise.resolve(readEmergencySessionCheckpoint({ key: ACTIVE_SESSION_ID }))
      ]);
      const restored = [storedSession, emergencySession]
        .filter(value => value?.items?.length)
        .sort((a, b) => (Number(b.sequence) || 0) - (Number(a.sequence) || 0) || (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))[0] || null;
      if (restored?.items?.length) {
        this.session = restored;
        this.session.sessionId ||= `context-review:${Number(this.session.createdAt) || Date.now()}`;
        this.session.startedAt ||= Number(this.session.createdAt) || Date.now();
        this.session.activeDurationMs = Math.max(0, Number(this.session.activeDurationMs) || 0);
        this.session.sourceTrack ||= this.session.targetTrack || '';
        this.session.targetTrack ||= this.session.sourceTrack;
        this.currentIndex = Math.max(0, Number(restored.currentIndex) || 0);
        this.counts = { ...this.counts, ...(restored.counts || {}) };
        this.completedWordIds = new Set((restored.completedWordIds || []).map(Number).filter(Number.isFinite));
        this.pendingEvidence = restored.pendingEvidence || null;
      } else {
        const sourceTrack = Config.get('exam_level');
        if (requiresTargetTrackSelection(sourceTrack, Config.get('target_track_selection_required'))) {
          this.renderTargetTrackRequired();
          return;
        }
        const words = await ReviewQueue.getDueWords({ limit: 10 });
        this.session = await ContextReview.prepare({
          words,
          limit: 10,
          sourceTrack,
          challenge: Config.get('reading_mode') || 'standard',
          coverage: Config.get('coverage'),
          signal: this.controller.signal
        });
        if (words.length && !this.session.items.length) {
          throw new Error('没有可用的本地语境句子，在线生成也未完成');
        }
        this.session.sessionId ||= String(this.session.id || `context-review:${Date.now()}`);
        this.session.startedAt ||= Number(this.session.createdAt) || Date.now();
        this.session.activeDurationMs = Math.max(0, Number(this.session.activeDurationMs) || 0);
        this.session.id = ACTIVE_SESSION_ID;
        this.currentIndex = 0;
         this.persistSession();
      }
      this.startReviewTimer();
      await this.showCurrent();
    } catch (error) {
      if (error?.name === 'AbortError' || !this.container) return;
      this.renderPrepareError(error);
    }
  },

  renderTargetTrackRequired() {
    this.container.innerHTML = `<main class="app-standard-page context-review-page context-review-content" data-context-review-content="target-required"><section class="flashcard-empty-sheet context-review-detail-pane"><p class="page-eyebrow">CONTEXT REVIEW</p><h2>请先选择目标考试导向</h2><p>语境复习会优先匹配所选考试的真题原句。选择目标后，句子难度仍只按设置中的阅读匹配方式和材料覆盖率生成。</p><a class="btn btn-primary" href="#/settings">前往设置选择目标考试</a><a class="btn btn-outline" href="#/flashcard">返回复习方式</a></section></main>`;
  },

  async showCurrent() {
    this.hideTooltip();
    while (this.currentIndex < (this.session?.items?.length || 0)) {
      const item = this.session.items[this.currentIndex];
      if (!item?.word) {
        const checked = await DB.findLearnWordById(item?.wordId).catch(() => null);
        if (!checked) {
          this.commitPendingKnowledgeEvidence();
          this.currentIndex += 1;
          continue;
        }
        item.word = { ...checked, expectedRevision: item.expectedRevision ?? checked.reviewRevision };
      }
      item.lastUsedAt = Date.now();
      if (item.difficultyStatus !== 'offline-fallback') {
        void DB.saveContextReviewSentences([item]).catch(() => {});
      }
      break;
    }
    if (!this.container) return;
    if (this.currentIndex >= (this.session?.items?.length || 0)) {
      // Do not make the result screen wait for IndexedDB. The persistence
      // coordinator marks this session discarded and removes it after any
      // in-flight checkpoint finishes, so a late save cannot resurrect it.
      const clear = this.reviewPersistence?.clearSession
        ? this.reviewPersistence.clearSession({ key: ACTIVE_SESSION_ID })
        : DB.deleteContextReviewSession(ACTIVE_SESSION_ID);
      void Promise.resolve(clear).catch(() => {});
      this.renderResult();
      return;
    }
    this.answered = null;
    this.submitting = false;
    this.assistedLookupCount = 0;
    this.notice = '';
    this.translationLoading = false;
    this.correctionBaseline = null;
    this.correctionAttemptId = '';
    this.correctionDone = false;
    this.pendingEvidence = null;
    this.noteReviewActivity();
    this.persistSession();
    this.renderCard();
  },

  renderCard() {
    this.unbindInteractions();
    const item = this.session.items[this.currentIndex];
    const answered = Boolean(this.answered);
    const submitting = Boolean(this.submitting);
    const progress = Math.round((this.currentIndex / this.session.items.length) * 100);
    this.container.innerHTML = `
      <main class="app-standard-page context-review-page context-review-content" data-context-review-content="card" aria-labelledby="contextReviewTitle">
        <div id="wordTooltip" class="word-tooltip" style="display:none"></div>
        <header class="context-review-progress">
          <a href="#/flashcard" class="context-review-back" aria-label="返回复习方式"><i class="fa-solid fa-arrow-left"></i></a>
          <div><p class="page-eyebrow">CONTEXT REVIEW</p><h2 id="contextReviewTitle">语境识词</h2></div>
          <span>${this.currentIndex + 1} / ${this.session.items.length}</span>
        </header>
        <div class="context-review-progress-track"><i style="width:${progress}%"></i></div>
        <section class="context-review-sheet context-review-detail-pane ${answered ? 'is-answered' : ''}" data-context-review-pane="detail">
          <p class="context-review-instruction">${answered ? `你的判断：${RESULT_LABELS[this.answered]}` : '读句子，判断高亮单词在这里是否认识'}</p>
          <p class="context-review-sentence">${wordTokens(item.sentence, item, answered)}</p>
        ${answered ? `<div class="context-review-answer" aria-live="polite">
            <div class="context-review-answer-label">本句义</div>
            ${renderDefinition(item)}
            <div class="context-review-answer-label">整句翻译</div>
            <p class="context-review-translation">${item.translationZh ? esc(item.translationZh) : (this.translationLoading ? '正在补充翻译…' : '中文翻译暂不可用')}</p>
            ${!item.translationZh && !this.translationLoading ? '<button class="context-review-translation-retry" type="button" data-context-translation-retry>重试翻译</button>' : ''}
            <p class="context-review-source">${renderContextSource(item)}</p>
          </div>` : `<p class="context-review-help">可点击其他英文词查释义；目标词会保持隐藏，查词不会直接影响本题评分。</p>`}
        </section>
        ${this.renderNotice()}
        ${answered ? `<div class="context-review-after-actions">
          <button class="btn btn-outline" type="button" data-context-detail>完整学习详情</button>
          <button class="btn btn-primary" type="button" data-context-next ${submitting ? 'disabled' : ''}>下一句</button>
          ${this.answered === ContextReviewResult.KNOWN && !this.correctionDone ? `<button class="context-review-correct" type="button" data-context-correct ${submitting ? 'disabled' : ''}>${submitting ? '正在保存…' : '记错了'}</button>` : ''}
        </div>` : `<div class="context-review-rating" aria-label="语境判断">
          <button type="button" data-context-result="known" ${submitting ? 'disabled' : ''}><i class="fa-regular fa-face-smile"></i><span>${submitting ? '保存中…' : '认识'}</span></button>
          <button type="button" data-context-result="uncertain" ${submitting ? 'disabled' : ''}><i class="fa-regular fa-face-meh"></i><span>${submitting ? '保存中…' : '模糊'}</span></button>
          <button type="button" data-context-result="unknown" ${submitting ? 'disabled' : ''}><i class="fa-regular fa-face-frown"></i><span>${submitting ? '保存中…' : '不认识'}</span></button>
          <button class="context-review-skip" type="button" data-context-result="skipped" ${submitting ? 'disabled' : ''}>跳过</button>
        </div>`}
      </main>`;
    this.bindInteractions();
  },

  bindInteractions() {
    this._clickHandler = event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      this.noteReviewActivity();
      const result = target.closest('[data-context-result]')?.dataset.contextResult;
      if (result) return void this.submit(result);
      if (target.closest('[data-context-next]')) return void this.next();
      if (target.closest('[data-context-detail]')) return this.openDetail();
      if (target.closest('[data-context-correct]')) return void this.correctMistake();
      if (target.closest('[data-context-retry]')) return void this.retryPendingRatings();
      if (target.closest('[data-context-translation-retry]')) return void this.loadTranslation(this.session.items[this.currentIndex]);
      if (target.closest('[data-context-target]')) {
        if (!this.answered) {
          this.notice = '这是本句复习词，请先作答';
          this.renderCard();
          return;
        }
      }
      const wordButton = target.closest('[data-context-word]');
      if (wordButton) void this.lookupWord(event, wordButton.dataset.contextWord);
    };
    this.container.addEventListener('click', this._clickHandler);
    this._tooltipDismissCleanup = Tooltip.attachAutoDismiss();
  },

  renderNotice() {
    if (!this.notice) return '';
    const retryable = this.notice.includes('暂未保存') || this.notice.includes('保存失败');
    return `<p class="context-review-notice" role="status">${esc(this.notice)}${retryable ? ' <button class="context-review-save-retry" type="button" data-context-retry>重试保存</button>' : ''}</p>`;
  },

  async retryPendingRatings() {
    if (!this.reviewPersistence?.retryFailed) return;
    this.notice = '正在重试保存…';
    this.renderCard();
    try {
      const status = await this.reviewPersistence.retryFailed();
      this.notice = status.rating.failed ? '仍有判断未保存，请稍后再次重试。' : '已重新提交保存';
    } catch {
      this.notice = '保存重试失败，请稍后再次重试。';
    }
    if (this.container) this.renderCard();
  },

  unbindInteractions() {
    if (this.container && this._clickHandler) this.container.removeEventListener('click', this._clickHandler);
    this._clickHandler = null;
    this._tooltipDismissCleanup?.();
    this._tooltipDismissCleanup = null;
  },

  async lookupWord(event, word) {
    if (!word) return;
    if (Tooltip.isVisible()) {
      if (this.tooltipWord === word) {
        Tooltip.hide();
        this.tooltipWord = '';
        return;
      }
      Tooltip.hide();
    }
    if (!this.answered) this.assistedLookupCount += 1;
    this.tooltipWord = word;
    const lookupId = Tooltip.beginLookup(event.clientX, event.clientY);
    try {
      const data = await Dictionary.lookup(word);
      await Tooltip.show(lookupId, event.clientX, event.clientY, data, false, {
        contextSentence: this.session.items[this.currentIndex].sentence,
        targetTrack: this.session.targetTrack
      });
    } catch {
      if (Tooltip.isCurrent(lookupId)) {
        Tooltip.hide();
        this.tooltipWord = '';
      }
    }
  },

  async submit(result) {
    if (this.answered || this.submitting || !Object.values(ContextReviewResult).includes(result)) return;
    if (result === ContextReviewResult.SKIPPED) {
      this.submitting = true;
      this.counts.skipped += 1;
      this.currentIndex += 1;
      this.persistSession();
      await this.showCurrent();
      return;
    }
    this.submitting = true;
    const item = this.session.items[this.currentIndex];
    this.correctionBaseline = { ...item.word };
    this.notice = '已记录，正在后台保存…';
    this.renderCard();
    try {
      const saved = await ContextReview.submit({ item, result, assistedLookupCount: this.assistedLookupCount, validate: false });
      if (!saved.accepted) {
        this.submitting = false;
        this.notice = ['revision-mismatch', 'reviewed-elsewhere', 'no-longer-due'].includes(saved.reason)
          ? '这个词已在另一种复习方式中完成，已自动跳过。'
          : '本次未计分。';
        this.currentIndex += 1;
        this.persistSession();
        await this.showCurrent();
        return;
      }
      item.word = saved.word;
      item.expectedRevision = saved.word.reviewRevision;
      this.correctionAttemptId = saved.word.attemptId || '';
      this.pendingEvidence = {
        word: saved.word.word,
        result,
        assistedLookupCount: this.assistedLookupCount,
        attemptId: this.correctionAttemptId,
        contextId: `context-review:${item.wordId}:${String(item.sentence).slice(0, 80)}`,
        source: 'context-review'
      };
      this.answered = result;
      this.submitting = false;
      this.counts[result] += 1;
      this.completedWordIds.add(Number(item.wordId));
      rememberToday(saved.word, result, this.correctionAttemptId);
      this.notice = this.assistedLookupCount ? `本题查询了 ${this.assistedLookupCount} 个辅助词，目标词评分不受直接影响。` : '';
      this.persistSession();
      this.renderCard();
      if (!item.translationZh) void this.loadTranslation(item);
    } catch (error) {
      this.submitting = false;
      this.notice = String(error?.message || '').includes('另一种复习方式')
        ? '这个词刚刚已在另一种复习方式完成，已自动跳过。'
        : '保存失败，请重新选择。';
      if (String(error?.message || '').includes('另一种复习方式')) {
        this.currentIndex += 1;
        await this.showCurrent();
      } else {
        this.renderCard();
      }
    }
  },

  async loadTranslation(item) {
    this.translationLoading = true;
    this.renderCard();
    const translated = await API.translateSentence(item.sentence).catch(() => '');
    const translation = /\p{Script=Han}/u.test(String(translated || '')) ? String(translated).trim() : '';
    if (!this.container || this.session.items[this.currentIndex] !== item || !this.answered) return;
    this.translationLoading = false;
    if (translation) {
      item.translationZh = translation;
      if (item.difficultyStatus !== 'offline-fallback') {
        await DB.saveContextReviewSentences([{ ...item, key: item.key || makeContextReviewCacheKey(item), lastUsedAt: Date.now() }]).catch(() => {});
      }
    }
    this.renderCard();
  },

  openDetail() {
    const item = this.session.items[this.currentIndex];
    WordStudyDetail.open({
      word: item.word.word,
      definition: item.word,
      sourceMeta: {
        eyebrow: 'CONTEXT REVIEW',
        contextSentence: item.sentence,
        targetTrack: this.session.targetTrack
      }
    });
  },

  async correctMistake() {
    if (this.answered !== ContextReviewResult.KNOWN || this.correctionDone || !this.correctionAttemptId || this.submitting) return;
    this.noteReviewActivity();
    this.submitting = true;
    this.renderCard();
    const item = this.session.items[this.currentIndex];
    try {
      const corrected = scheduleContextReview(this.correctionBaseline, ContextReviewResult.UNKNOWN, Date.now());
      await this.reviewPersistence?.flush({ timeoutMs: 5000 });
      const updated = await DB.correctLearnWordReview(item.wordId, corrected, {
        attemptId: this.correctionAttemptId,
        expectedRevision: Math.max(0, Number(item.word?.reviewRevision) || 0),
        sawAnswer: true,
        correctionReason: 'mistaken-context-known'
      });
      item.word = updated;
      this.counts.known = Math.max(0, this.counts.known - 1);
      this.counts.unknown += 1;
      this.answered = ContextReviewResult.UNKNOWN;
      this.correctionDone = true;
      if (this.pendingEvidence) this.pendingEvidence = { ...this.pendingEvidence, result: ContextReviewResult.UNKNOWN };
      rememberToday(updated, ContextReviewResult.UNKNOWN, this.correctionAttemptId);
      this.notice = '已更正为不认识，将在短时复习中再次出现。';
      this.persistSession();
    } catch {
      this.notice = '更正失败，请重试。';
    }
    this.submitting = false;
    this.renderCard();
  },

  async next() {
    if (!this.answered || this.submitting) return;
    this.noteReviewActivity();
    this.submitting = true;
    this.commitPendingKnowledgeEvidence();
    this.currentIndex += 1;
    this.persistSession();
    await this.showCurrent();
  },

  commitPendingKnowledgeEvidence() {
    const evidence = this.pendingEvidence;
    this.pendingEvidence = null;
    if (evidence) void knowledgeEvidenceBridge.recordContextReview(evidence);
  },

  persistSession() {
    if (!this.session) return null;
    if (this.reviewTimer && !this.reviewSummarySaved) {
      this.session.startedAt ||= this.reviewTimerStartedAt || Date.now();
      this.session.activeDurationMs = Math.max(0, Math.round(this.reviewTimerBaseDuration + this.reviewTimer.getActiveDuration()));
    }
    const snapshot = {
      ...this.session,
      id: ACTIVE_SESSION_ID,
      currentIndex: this.currentIndex,
      counts: this.counts,
      completedWordIds: [...this.completedWordIds],
      pendingEvidence: this.pendingEvidence,
      updatedAt: Date.now()
    };
    try {
      const queued = this.reviewPersistence?.enqueueSession({ key: ACTIVE_SESSION_ID, snapshot });
      if (!queued) throw new Error('语境会话后台保存不可用');
      return queued;
    } catch {
      // Preserve the previous direct write as the safe fallback when the
      // journal/localStorage is unavailable.
      void DB.saveContextReviewSession(snapshot).catch(() => {});
      return { accepted: false, fallback: true };
    }
  },

  renderResult() {
    void this.persistReviewSummary('completed');
    const completed = this.counts.known + this.counts.uncertain + this.counts.unknown;
    this.container.innerHTML = `
      <main class="app-standard-page context-review-page context-review-content context-review-result-page" data-context-review-content="result">
        <section class="flashcard-result-sheet context-review-result">
          <p class="page-eyebrow">CONTEXT REVIEW / DONE</p>
          <h2>语境复习完成</h2>
          <p>本轮完成 ${completed} 个词。结果已进入共同排期，不需要再去单词回忆里重复完成。${this.session?.missingCount ? `另有 ${this.session.missingCount} 个词暂时没有可靠语境句，未计分。` : ''}</p>
          <div class="context-review-result-grid">
            <div><strong>${this.counts.known}</strong><span>认识</span></div>
            <div><strong>${this.counts.uncertain}</strong><span>模糊</span></div>
            <div><strong>${this.counts.unknown}</strong><span>不认识</span></div>
          </div>
          <div class="review-persistence-status context-review-result-persistence" data-review-persistence-status data-status="saving" role="status" aria-live="polite"></div>
          <div class="context-review-result-actions"><a class="btn btn-primary" href="#/flashcard">选择其他方式</a><a class="btn btn-outline" href="#/vocab">查看我的词汇</a></div>
        </section>
      </main>`;

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
  },

  renderPrepareError() {
    this.container.innerHTML = `<main class="app-standard-page context-review-page context-review-content" data-context-review-content="error"><section class="flashcard-empty-sheet context-review-detail-pane" data-context-review-pane="error"><h2>暂时没有可用的语境句子</h2><p>离线候选不足或网络生成未完成。不会改动任何复习排期。</p><button class="btn btn-primary" type="button" onclick="ContextReviewView.render(ContextReviewView.container)">重新准备</button><a class="btn btn-outline" href="#/flashcard/recall">改用单词回忆</a></section></main>`;
  },

  hideTooltip() {
    Tooltip.hide();
    this.tooltipWord = '';
  },

  cleanup() {
    void this.persistReviewSummary('partial');
    this.commitPendingKnowledgeEvidence();
    this._reviewPersistenceUnsubscribe?.();
    this._reviewPersistenceUnsubscribe = null;
    void this.reviewPersistence?.flush?.({ timeoutMs: 1500 }).catch(() => {});
    if (this.session && this.currentIndex < (this.session.items?.length || 0)) {
      this.persistSession();
    }
    this.controller?.abort();
    this.controller = null;
    this.unbindInteractions();
    this.hideTooltip();
    WordStudyDetail.close();
    this.container = null;
  }
};

window.ContextReviewView = ContextReviewView;
