import { createExamServices } from '../exam/create-services.js';
import { createResponse } from '../exam/attempt-state.mjs';
import { getExamRenderer } from '../exam/renderers/registry.mjs';
import { hashQuestion } from '../exam/pack.mjs';
import { createExamTutorService } from '../exam/create-tutor-service.js';
import { ExamTutorDialog } from '../exam/exam-tutor-dialog.js';
import { SelectableTextActions } from '../exam/selectable-text-actions.mjs';
import { Tooltip } from '../components/tooltip.js';
import { Dictionary } from '../dictionary.js';
import { bindReadingStyleWordLookup, getContextSentenceAtPoint } from '../components/reading-word-lookup.js';
import { esc } from '../helpers.js';
import { Config } from '../config.js';
import { SNAP_ORDER, SNAP_HEIGHTS, closestSnap, isFinalPracticeQuestion } from '../exam/practice-ui.mjs';
import { buildAnswerCardModel, renderAnswerCardHtml } from '../exam/practice-answer-card.mjs';
import { bindSentenceLongPress, createLongPressSelectionGuard } from '../components/sentence-long-press.mjs';
import { createSentenceRangeForTextNodes } from '../components/sentence-selection.mjs';
import { paragraphTranslationService } from '../exam/paragraph-translation.mjs';
import { resolveAttemptExam, sectionLabelOf, unitLabel } from '../exam/exam-context.mjs';
import { DB } from '../db.js';
import { ActivityType } from '../learning-activity.mjs';
import { localDayKey } from '../learning-day.mjs';
import { StudySessionTimer } from '../study-session-timer.mjs';
const IDLE_PAUSE_MS = 2 * 60 * 1000;
const AUTOSAVE_MS = 500;

const examTypeKey = unit => unit?.type === 'matching' && unit.matchingVariant
  ? `${unit.type}:${unit.matchingVariant}`
  : unit?.type || 'unknown';

function sectionLabel(unitType) {
  if (unitType === 'cloze_choice') return 'Section I';
  if (unitType === 'reading_mcq') return 'Section II Part A';
  if (['paragraph_ordering', 'matching'].includes(unitType)) return 'Section II Part B';
  if (unitType === 'translation') return 'Section II Part C';
  return '真题训练';
}

function typeTitle(unit) {
  if (unit.type === 'cloze_choice') return '完形填空';
  if (unit.type === 'paragraph_ordering') return 'Part B · 段落排序';
  if (unit.type === 'matching') return `Part B · ${{
    sentence_insertion: '句子插入',
    heading_matching: '小标题匹配',
    statement_matching: '观点匹配'
  }[unit.matchingVariant] || '匹配题'}`;
  if (unit.type === 'translation') return 'Part C · 翻译';
  return unit.displayTitle || '阅读理解';
}

function translationTrainingFeedbackHtml(feedback) {
  if (!feedback) return '';
  const score = Number(feedback.trainingScore).toFixed(1).replace(/\.0$/, '');
  const strengths = feedback.strengths?.length
    ? `<ul>${feedback.strengths.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`
    : '';
  const issues = feedback.issues?.length
    ? `<ol class="exam-translation-tutor-issues">${feedback.issues.map(issue => `<li><strong>${esc(issue.type)}</strong><p>原文：${esc(issue.sourceFragment)}</p><p>我的表达：${esc(issue.userFragment)}</p><p>${esc(issue.explanation)}</p><p>建议：${esc(issue.suggestion)}</p></li>`).join('')}</ol>`
    : '<p>未发现需要特别指出的问题。</p>';
  return `<section class="exam-translation-tutor-feedback" data-selection-source="ai_feedback">
    <h4>AI 批改</h4>
    <p class="exam-translation-training-score"><strong>${esc(score)} / 10</strong><span>AI 训练评分，仅供学习参考</span></p>
    <div><h5>总体评价</h5><p>${esc(feedback.summary)}</p></div>
    ${strengths ? `<div><h5>做得好的地方</h5>${strengths}</div>` : ''}
    <div><h5>需要改进</h5>${issues}</div>
    <div><h5>AI 推荐译法</h5><p>${esc(feedback.improvedTranslation)}</p></div>
    <div><h5>学习建议</h5><p>${esc(feedback.studyAdvice)}</p></div>
    <button id="examTranslationTutorContinue" class="btn btn-outline btn-sm exam-tutor-open" type="button">继续问 AI</button>
  </section>`;
}

export const ExamPracticeView = {
  _dispose: null,
  examStudyTimer: null,
  restoredActiveDurationMs: 0,
  _pendingActiveSlices: [],
  _activeSliceFlush: null,

  captureExamContext(unit = this.unit) {
    return {
      attemptId: this.attempt?.attemptId || '',
      bankId: this.attempt?.bankId || this.paper?.bankId || '',
      paperKey: this.attempt?.paperKey || this.paper?.paperKey || '',
      unitKey: unit?.unitKey || '',
      type: unit?.type || 'unknown',
      matchingVariant: unit?.matchingVariant || '',
      practiceKind: this.attempt?.practiceKind || 'unit',
      practiceOrigin: this.attempt?.practiceOrigin || 'normal'
    };
  },

  enqueueActiveSlices(slices = [], unit = this.unit) {
    if (!Array.isArray(slices) || !slices.length) return;
    const context = this.captureExamContext(unit);
    this._pendingActiveSlices.push(...slices.map(slice => ({ slice, context })));
    void this.flushActiveSlices();
  },

  async saveActiveSlice(entry) {
    const { slice, context } = entry;
    const occurredAt = Number(slice.endedAt) || Date.now();
    await DB.saveLearningActivity({
      id: `exam-active-slice:${slice.id}`,
      type: ActivityType.EXAM_ACTIVE_SLICE,
      occurredAt,
      dayKey: slice.dayKey || localDayKey(occurredAt),
      sessionId: slice.sessionId,
      dedupeKey: `exam-active-slice:${slice.id}`,
      payload: {
        ...context,
        contextKey: slice.contextKey,
        startedAt: slice.startedAt,
        endedAt: slice.endedAt,
        durationMs: slice.durationMs,
        dayKey: slice.dayKey || localDayKey(occurredAt)
      }
    });
  },

  flushActiveSlices() {
    if (this._activeSliceFlush) return this._activeSliceFlush;
    if (!this._pendingActiveSlices.length) return Promise.resolve();
    const batch = this._pendingActiveSlices.splice(0);
    this._activeSliceFlush = (async () => {
      for (let index = 0; index < batch.length; index += 1) {
        try {
          await this.saveActiveSlice(batch[index]);
        } catch (error) {
          this._pendingActiveSlices.unshift(...batch.slice(index));
          console.warn('真题有效时长活动保存失败', error);
          break;
        }
      }
    })().finally(() => {
      this._activeSliceFlush = null;
      if (this._pendingActiveSlices.length) void this.flushActiveSlices();
    });
    return this._activeSliceFlush;
  },

  async switchExamTimerContext(nextUnit) {
    if (!this.examStudyTimer || this.examStudyTimer.finished) return;
    const previousUnit = this.unit;
    const slices = this.examStudyTimer.switchContext({ contextKey: examTypeKey(nextUnit) });
    this.enqueueActiveSlices(slices, previousUnit);
    this.examStudyTimer.acknowledge(slices);
    await this.flushActiveSlices();
  },

  async cleanup() {
    document.body.classList.remove('exam-page-compact');
    if (this.attempt?.status === 'in_progress') {
      this.pauseTimer('cleanup');
      await this.flushActiveSlices();
      await this.flushAutosave();
    }
    this._dispose?.();
    this._dispose = null;
    this._wordLookupCleanup?.();
    this._wordLookupCleanup = null;
    clearTimeout(this._evidenceHighlightTimer);
    this._evidenceHighlightTimer = null;
    this.examTutorDialog?.destroy();
    this.examTutorDialog = null;
    this.selectionActions?.destroy();
    this.selectionActions = null;
    this._sentenceLongPressCleanup?.();
    this._sentenceLongPressCleanup = null;
    this.clearSentenceAiConfirmation?.();
    this.sentenceLongPressGuard?.clear();
    this.sentenceLongPressGuard = null;
    this.closeAnswerCard?.({ restoreFocus: false });
    this.examTutor = null;
    this.isExplanation = false;
    this.wordLookupEnabled = true;
    this._paragraphTranslationState = new Map();
    this._paragraphTranslationRequestSequence = 0;
    this._contentUpdated = false;
    this.examStudyTimer = null;
    this.restoredActiveDurationMs = 0;
  },

  async render(container, attemptId, mode = null) {
    await this.cleanup();
    const services = createExamServices();
    const examId = await resolveAttemptExam(services, attemptId) || 'kaoyan_en1';
    const practice = await services.practiceService.getPractice({ examId, attemptId });
    const { attempt, paper, unit, responses: savedResponses, questions } = practice;
    if (attempt.status === 'submitted' && mode === 'explanation') {
      await this.renderSubmittedExplanation(container, practice);
      return;
    }
    if (attempt.status !== 'in_progress') {
      container.innerHTML = '<div class="empty-state">该练习已结束</div>';
      return;
    }

    this.services = services;
    this.attempt = attempt;
    this.paper = paper;
    this.units = practice.units || [unit];
    this.isFullPaper = attempt.practiceKind === 'full_paper';
    this.allQuestions = questions.filter(question => (attempt.questionOrder || []).includes(question.questionKey));
    this.unit = unit;
    this.renderer = getExamRenderer(unit.type);
    this.questions = this.getQuestionsForUnit(unit);
    this.responses = new Map(savedResponses.map(response => [response.questionKey, response]));
    this.currentIndex = Math.max(0, this.questions.findIndex(question => question.questionKey === attempt.currentQuestionKey));
    if (this.currentIndex < 0) this.currentIndex = 0;
    this.sheetSnap = attempt.sheetSnap && SNAP_ORDER.includes(attempt.sheetSnap) ? attempt.sheetSnap : 'mid';
    this.activeDurationMs = Number(attempt.activeDurationMs) || 0;
    this.restoredActiveDurationMs = this.activeDurationMs;
    this.active = false;
    this.lastActiveAt = Date.now();
    this._disposed = false;
    this._savePromise = null;
    this._submitting = false;
    this._drag = null;
    this._paneResize = null;
    this._autosaveTimer = null;
    this._idleTimer = null;
    this.isExplanation = false;
    this.wordLookupEnabled = Config.get('exam_word_lookup_enabled') !== 'false';
    this._contentUpdated = false;
    document.body.classList.add('exam-page-compact');

    container.innerHTML = `
      <div class="exam-practice" id="examPracticeRoot">
        <section class="exam-practice-article" id="examArticleScroll">
          <div class="exam-practice-article-inner">
            <p class="page-eyebrow">READING PART A</p>
            <h1 class="reading-title">${esc(unit.displayTitle || attempt.unitKey)}</h1>
            ${this.renderer.renderArticle(unit, { responses: this.responses, currentQuestionKey: attempt.currentQuestionKey })}
          </div>
        </section>
        <div class="exam-pane-splitter" id="examPaneSplitter" role="separator" aria-orientation="vertical" aria-label="调整原文与题目面板宽度" aria-valuemin="420" tabindex="0"></div>
        <section class="exam-sheet is-${this.sheetSnap}" id="examSheet" aria-label="题目面板">
          <div class="exam-sheet-handle" id="examSheetHandle" role="slider" tabindex="0" aria-label="调整题目面板高度"></div>
          <div class="exam-sheet-header">
            <button id="examSheetPrev" class="exam-sheet-nav" type="button" aria-label="上一题">‹</button>
            <button class="exam-sheet-progress" id="examSheetProgress" type="button" aria-haspopup="dialog" aria-label="打开答题卡"></button>
            <div class="exam-sheet-header-actions">
              <button id="examWordLookupToggle" class="exam-sheet-lookup-toggle ${this.wordLookupEnabled ? 'is-active' : ''}" type="button" role="switch" aria-checked="${this.wordLookupEnabled}" aria-label="点词翻译：${this.wordLookupEnabled ? '开' : '关'}" title="点词翻译">⌁</button>
              <button id="examSheetNext" class="exam-sheet-nav" type="button" aria-label="下一题">›</button>
              <button id="examSubmitBtn" class="btn btn-primary btn-sm" type="button" hidden>提交</button>
            </div>
          </div>
          <div class="exam-sheet-body" id="examSheetBody"></div>
          <div class="exam-sheet-footer">
            <button id="examUncertainBtn" class="btn btn-outline btn-sm" type="button">? 不确定</button>
            <button id="examBookmarkBtn" class="btn btn-outline btn-sm" type="button">☆ 收藏</button>
          </div>
        </section>
      </div>
      <div id="wordTooltip" class="word-tooltip" style="display:none"></div>`;

    this.container = container;
    this.practiceRoot = container.querySelector('#examPracticeRoot');
    this.articleScroll = container.querySelector('#examArticleScroll');
    this.articleInner = container.querySelector('.exam-practice-article-inner');
    this.sheet = container.querySelector('#examSheet');
    this.sheetBody = container.querySelector('#examSheetBody');
    this.sheetProgress = container.querySelector('#examSheetProgress');
    this.uncertainBtn = container.querySelector('#examUncertainBtn');
    this.bookmarkBtn = container.querySelector('#examBookmarkBtn');
    this.submitBtn = container.querySelector('#examSubmitBtn');
    this.wordLookupToggle = container.querySelector('#examWordLookupToggle');
    this.articleScroll.scrollTop = this.getPassageScrollAnchor(this.unit.unitKey);

    this.renderArticle();
    this.renderQuestion();
    this.bindExamWordLookup();
    this.replaceMenuWithBack();
    this.bindEvents();
    this.startTimer();
  },

  async renderSubmittedExplanation(container, practice) {
    const { attempt, paper, unit, responses: savedResponses, questions } = practice;
    this.services = createExamServices();
    this.examTutor = createExamTutorService();
    this.examTutorDialog = new ExamTutorDialog({ tutorService: this.examTutor });
    this.attempt = attempt;
    this.paper = paper;
    this.units = practice.units || [unit];
    this.isFullPaper = attempt.practiceKind === 'full_paper';
    this.allQuestions = questions.filter(question => (attempt.questionOrder || []).includes(question.questionKey));
    this.unit = unit;
    this.renderer = getExamRenderer(unit.type);
    this.questions = this.getQuestionsForUnit(unit);
    this.responses = new Map(savedResponses.map(response => [response.questionKey, response]));
    this.currentIndex = 0;
    this.sheetSnap = 'mid';
    this.isExplanation = true;
    this.wordLookupEnabled = true;
    this.sentenceLongPressGuard = createLongPressSelectionGuard();
    this._disposed = false;
    this._drag = null;
    this._paneResize = null;
    const currentHashChecks = await Promise.all(this.questions.map(async question => {
      const response = this.responses.get(question.questionKey);
      return Boolean(response?.questionHashAtSubmit) && response.questionHashAtSubmit !== await hashQuestion(question);
    }));
    const otherHashChecks = this.isFullPaper
      ? await Promise.all(this.allQuestions.filter(question => !this.questions.includes(question)).map(async question => {
          const response = this.responses.get(question.questionKey);
          return Boolean(response?.questionHashAtSubmit) && response.questionHashAtSubmit !== await hashQuestion(question);
        }))
      : [];
    this._contentUpdated = (await Promise.resolve([...currentHashChecks, ...otherHashChecks])).some(Boolean);
    document.body.classList.add('exam-page-compact');
    container.innerHTML = `
      <div class="exam-practice exam-explanation-mode" id="examPracticeRoot">
        <section class="exam-practice-article" id="examArticleScroll"><div class="exam-practice-article-inner"></div></section>
        <div class="exam-pane-splitter" id="examPaneSplitter" role="separator" aria-orientation="vertical" aria-label="调整原文与解析面板宽度" aria-valuemin="420" tabindex="0"></div>
        <section class="exam-sheet is-${this.sheetSnap}" id="examSheet" aria-label="解析面板">
          <div class="exam-sheet-handle" id="examSheetHandle" role="slider" tabindex="0" aria-label="调整解析面板高度"></div>
          <div class="exam-sheet-header"><button id="examSheetPrev" class="exam-sheet-nav" type="button" aria-label="上一题">‹</button><button id="examSheetProgress" class="exam-sheet-progress" type="button" aria-haspopup="dialog" aria-label="打开答题卡"></button><div class="exam-sheet-header-actions"><button id="examSheetNext" class="exam-sheet-nav" type="button" aria-label="下一题">›</button></div></div>
          <div class="exam-sheet-body" id="examSheetBody"></div>
          <div class="exam-sheet-footer"><button id="examExplanationWrong" class="btn btn-outline btn-sm" type="button" ${unit.type === 'translation' ? 'hidden' : ''}></button><button id="examBookmarkBtn" class="btn btn-outline btn-sm" type="button" ${unit.type === 'translation' ? 'hidden' : ''}>收藏</button><button id="examExplanationBack" class="btn btn-primary btn-sm" type="button">返回结果</button></div>
        </section>
      </div>
      <div id="wordTooltip" class="word-tooltip" style="display:none"></div>`;
    this.container = container;
    this.practiceRoot = container.querySelector('#examPracticeRoot');
    this.articleScroll = container.querySelector('#examArticleScroll');
    this.articleInner = container.querySelector('.exam-practice-article-inner');
    this.sheet = container.querySelector('#examSheet');
    this.sheetBody = container.querySelector('#examSheetBody');
    this.sheetProgress = container.querySelector('#examSheetProgress');
    this.bookmarkBtn = container.querySelector('#examBookmarkBtn');
    this.wrongBtn = container.querySelector('#examExplanationWrong');
    this.renderArticle();
    this.renderSubmittedQuestion();
    this.bindExamWordLookup();
    this.replaceMenuWithExplanationBack();
    this.bindExplanationEvents();
    this.bindSubmittedSelection();
    this.bindExplanationSentenceLongPress();
  },

  getQuestionsForUnit(unit) {
    const allowed = new Set(this.attempt?.questionOrder || []);
    return (unit?.questions || []).filter(question => !allowed.size || allowed.has(question.questionKey));
  },

  getQuestionUnit(question) {
    return this.units?.find(unit => unit.questions?.some(item => item.questionKey === question?.questionKey)) || this.unit;
  },

  getPassageScrollAnchor(unitKey = this.unit?.unitKey) {
    if (this.attempt?.practiceKind === 'full_paper') {
      return Number(this.attempt.passageScrollAnchors?.[unitKey]) || 0;
    }
    return Number(this.attempt?.passageScrollAnchor) || 0;
  },

  saveCurrentPassageAnchor() {
    if (!this.articleScroll || !this.attempt) return;
    const value = Number(this.articleScroll.scrollTop) || 0;
    this.attempt.passageScrollAnchor = value;
    if (this.attempt.practiceKind === 'full_paper') {
      this.attempt.passageScrollAnchors = { ...(this.attempt.passageScrollAnchors || {}), [this.unit.unitKey]: value };
    }
  },

  async goToUnit(unitIndex, questionIndex = 0) {
    if (!this.isFullPaper || unitIndex < 0 || unitIndex >= this.units.length) return false;
    this.saveCurrentPassageAnchor();
    this.clearSentenceAiConfirmation?.();
    const nextUnit = this.units[unitIndex];
    const nextQuestions = this.getQuestionsForUnit(nextUnit);
    if (!nextUnit || !nextQuestions.length) return false;
    await this.switchExamTimerContext(nextUnit);
    this.unit = nextUnit;
    this.renderer = getExamRenderer(nextUnit.type);
    this.questions = nextQuestions;
    this.currentIndex = Math.min(Math.max(0, questionIndex), nextQuestions.length - 1);
    this.attempt.currentUnitKey = nextUnit.unitKey;
    this.attempt.currentUnitIndex = unitIndex;
    this.attempt.currentQuestionKey = nextQuestions[this.currentIndex].questionKey;
    this.attempt.unitKey = this.attempt.unitKey || nextUnit.unitKey;
    Tooltip.hide();
    if (this.wrongBtn) this.wrongBtn.hidden = nextUnit.type === 'translation';
    if (this.bookmarkBtn) this.bookmarkBtn.hidden = nextUnit.type === 'translation';
    this.renderArticle();
    if (this.isExplanation) this.renderSubmittedQuestion();
    else this.renderQuestion();
    this.articleScroll.scrollTop = this.getPassageScrollAnchor(nextUnit.unitKey);
    if (!this.isExplanation) this.scheduleAutosave();
    return true;
  },

  async lookupSelection(text, rect) {
    const lookupId = Tooltip.beginLookup(rect?.left || 12, rect?.bottom || 12);
    try {
      const data = await Dictionary.lookup(text);
      await Tooltip.show(lookupId, rect?.left || 12, rect?.bottom || 12, data);
    } catch {
      if (Tooltip.isCurrent(lookupId)) Tooltip.hide();
    }
  },

  bindExamWordLookup() {
    this._wordLookupCleanup?.();
    this._wordLookupCleanup = bindReadingStyleWordLookup({
      root: this.container,
      getContextSentence: event => getContextSentenceAtPoint(event, this.container),
      getTargetTrack: () => this.paper?.targetTrack || (this.attempt?.examId === 'cet4' ? 'cet4' : this.attempt?.examId === 'kaoyan_en1' ? 'kaoyan1' : ''),
      shouldIgnoreClick: () => this.sentenceLongPressGuard?.consumeClick() || false,
      isEnabled: this.isExplanation ? () => true : () => this.wordLookupEnabled
    });
  },

  bindSubmittedSelection() {
    this.selectionActions?.destroy();
    this.selectionActions = new SelectableTextActions({
      root: this.container,
      onLookup: (text, rect) => this.lookupSelection(text, rect),
      allowAskAI: true,
      shouldIgnoreSelection: () => this.sentenceLongPressGuard?.shouldIgnoreSelection() || false,
      onAskAI: async quote => {
        if (!this.isExplanation || !quote) return;
        if (this.unit?.type === 'translation') {
          await this.openTranslationTutor({ quote });
          return;
        }
        this.examTutorDialog?.open({ ...this.getExamTutorInput(), quote });
      }
    });
    this.selectionActions.bind();
  },

  bindExplanationSentenceLongPress() {
    this._sentenceLongPressCleanup?.();
    if (!this.isExplanation || !this.articleScroll) return;
    const controls = 'button, a, input, textarea, select, [role="button"], [data-word-lookup="disabled"]';
    const passage = '[data-selection-source="passage"]';
    this._sentenceLongPressCleanup = bindSentenceLongPress({
      root: this.articleScroll,
      duration: 420,
      preventNativeTextSelection: true,
      shouldIgnore: event => !event.target?.closest?.(passage) || Boolean(event.target?.closest?.(controls)),
      onLongPress: event => {
        const pointRange = document.caretRangeFromPoint?.(event.clientX, event.clientY)
          || (() => {
            const position = document.caretPositionFromPoint?.(event.clientX, event.clientY);
            if (!position) return null;
            const range = document.createRange();
            range.setStart(position.offsetNode, position.offset);
            range.collapse(true);
            return range;
          })();
        const pointNode = pointRange?.startContainer;
        const element = pointNode?.nodeType === (globalThis.Node?.TEXT_NODE || 3) ? pointNode.parentElement : pointNode;
        const block = element?.closest?.('.exam-practice-paragraph[data-selection-source="passage"], .exam-ordering-fixed[data-selection-source="passage"], [data-selection-source="passage"]:not(button)');
        if (!block || !this.articleScroll.contains(block) || !pointNode || pointNode.nodeType !== (globalThis.Node?.TEXT_NODE || 3)) return;
        const walker = document.createTreeWalker(block, globalThis.NodeFilter?.SHOW_TEXT || 4);
        const textNodes = [];
        let node;
        while ((node = walker.nextNode())) {
          if (!node.parentElement?.closest?.(controls)) textNodes.push(node);
        }
        const sentence = createSentenceRangeForTextNodes({
          textNodes,
          pointNode,
          pointOffset: pointRange.startOffset,
          createRange: () => document.createRange()
        });
        const selectedText = sentence?.text?.replace(/\s+/g, ' ').trim();
        if (!sentence || !selectedText || selectedText.length < 4 || !/[A-Za-z]/.test(selectedText)) return;
        const selection = window.getSelection?.();
        this.sentenceLongPressGuard?.markAutomaticSelection();
        selection?.removeAllRanges?.();
        selection?.addRange?.(sentence.range);
        this.showSentenceAiConfirmation({ text: selectedText, range: sentence.range });
      }
    });
  },

  showSentenceAiConfirmation({ text, range }) {
    this.clearSentenceAiConfirmation({ clearSelection: false, preserveLongPressGuard: true });
    const rect = range.getBoundingClientRect?.();
    if (!rect) {
      this.sentenceLongPressGuard?.clear();
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'exam-sentence-ai-confirm';
    button.textContent = '✨ 问 AI';
    button.style.left = `${Math.max(12, Math.min(rect.left + rect.width / 2, window.innerWidth - 90))}px`;
    button.style.top = `${Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 56))}px`;
    button.addEventListener('pointerdown', event => event.preventDefault());
    button.addEventListener('click', async event => {
      event.preventDefault();
      const quote = { selectedText: text, selectedSource: 'passage' };
      this.clearSentenceAiConfirmation();
      if (this.unit?.type === 'translation') await this.openTranslationTutor({ quote });
      else this.examTutorDialog?.open({ ...this.getExamTutorInput(), quote });
    });
    document.body.appendChild(button);
    this._sentenceAiConfirm = button;
    this._sentenceConfirmOutside = event => {
      if (button.contains(event.target)) return;
      this.clearSentenceAiConfirmation();
    };
    this._sentenceConfirmBindTimer = setTimeout(() => {
      this._sentenceConfirmBindTimer = null;
      if (this._sentenceAiConfirm === button) {
        document.addEventListener('pointerdown', this._sentenceConfirmOutside);
      }
    }, 0);
  },

  clearSentenceAiConfirmation({ clearSelection = true, preserveLongPressGuard = false } = {}) {
    if (this._sentenceConfirmBindTimer) clearTimeout(this._sentenceConfirmBindTimer);
    this._sentenceConfirmBindTimer = null;
    if (this._sentenceConfirmOutside) document.removeEventListener('pointerdown', this._sentenceConfirmOutside);
    this._sentenceConfirmOutside = null;
    this._sentenceAiConfirm?.remove();
    this._sentenceAiConfirm = null;
    if (!preserveLongPressGuard) this.sentenceLongPressGuard?.clear();
    if (clearSelection) window.getSelection?.()?.removeAllRanges?.();
  },

  replaceMenuWithBack() {
    const menu = document.querySelector('#appMenuBtn');
    if (!menu) return;
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'app-icon-button';
    back.id = 'appMenuBtn';
    back.setAttribute('aria-label', '返回');
    back.innerHTML = '<i class="fa-solid fa-arrow-left" aria-hidden="true"></i>';
    menu.replaceWith(back);
    back.addEventListener('click', () => this.showExitModal());
  },

  replaceMenuWithExplanationBack() {
    const menu = document.querySelector('#appMenuBtn');
    if (!menu) return;
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'app-icon-button';
    back.id = 'appMenuBtn';
    back.setAttribute('aria-label', '返回结果');
    back.innerHTML = '<i class="fa-solid fa-arrow-left" aria-hidden="true"></i>';
    menu.replaceWith(back);
    back.addEventListener('click', () => { location.hash = `#/exam/result/${this.attempt.attemptId}`; });
  },

  bindEvents() {
    const onCleanup = [];
    const add = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      onCleanup.push(() => target.removeEventListener(type, handler, options));
    };

    const noteActivity = () => this.noteActivity();
    add(this.articleScroll, 'scroll', () => {
      this.saveCurrentPassageAnchor();
      this.scheduleAutosave();
      this.noteActivity();
    }, { passive: true });
    add(document, 'pointerdown', noteActivity, { passive: true });
    add(document, 'touchstart', noteActivity, { passive: true });
    add(document, 'keydown', noteActivity);
    add(document, 'visibilitychange', () => {
      if (document.hidden) this.pauseTimer('hidden');
      else this.noteActivity();
    });

    const handle = this.container.querySelector('#examSheetHandle');
    add(handle, 'pointerdown', event => this.startDrag(event));
    add(handle, 'keydown', event => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const index = SNAP_ORDER.indexOf(this.sheetSnap);
        const next = event.key === 'ArrowUp' ? Math.min(SNAP_ORDER.length - 1, index + 1) : Math.max(0, index - 1);
        this.setSnap(SNAP_ORDER[next]);
      }
    });

    add(this.container.querySelector('#examSheetPrev'), 'click', () => this.goToQuestion(this.currentIndex - 1));
    add(this.container.querySelector('#examSheetNext'), 'click', () => this.goToQuestion(this.currentIndex + 1));
    add(this.wordLookupToggle, 'click', () => this.toggleWordLookup());
    add(this.sheetProgress, 'click', () => this.showAnswerCard());
    add(this.container.querySelector('#examUncertainBtn'), 'click', () => this.toggleUncertain());
    add(this.container.querySelector('#examBookmarkBtn'), 'click', () => this.toggleBookmark());
    add(this.container.querySelector('#examSubmitBtn'), 'click', () => this.requestSubmit());
    add(window, 'orientationchange', () => {
      this.closeAnswerCard({ restoreFocus: false });
      this.clearSentenceAiConfirmation();
      this.syncPaneSplitForViewport();
    });
    this.bindPaneSplitter();

    this._dispose = () => {
      if (this._drag) {
        document.removeEventListener('pointermove', this._drag.onMove);
        document.removeEventListener('pointerup', this._drag.onUp);
      }
      this._paneSplitterCleanup?.();
      if (this._idleTimer) clearTimeout(this._idleTimer);
      if (this._autosaveTimer) clearTimeout(this._autosaveTimer);
      this._disposed = true;
      onCleanup.forEach(remove => remove());
    };
  },

  toggleWordLookup() {
    if (this.isExplanation) return;
    this.wordLookupEnabled = !this.wordLookupEnabled;
    this.updateWordLookupToggle();
    Tooltip.hide();
    void Config.set('exam_word_lookup_enabled', String(this.wordLookupEnabled));
  },

  updateWordLookupToggle() {
    const toggle = this.wordLookupToggle || this.container?.querySelector('#examWordLookupToggle');
    if (!toggle) return;
    const enabled = Boolean(this.wordLookupEnabled);
    toggle.classList.toggle('is-active', enabled);
    toggle.setAttribute('aria-checked', String(enabled));
    toggle.setAttribute('aria-label', `点词翻译：${enabled ? '开' : '关'}`);
  },

  bindExplanationEvents() {
    const onCleanup = [];
    const add = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      onCleanup.push(() => target.removeEventListener(type, handler, options));
    };
    const handle = this.container.querySelector('#examSheetHandle');
    add(handle, 'pointerdown', event => this.startDrag(event));
    add(handle, 'keydown', event => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const index = SNAP_ORDER.indexOf(this.sheetSnap);
        this.setSnap(SNAP_ORDER[event.key === 'ArrowUp' ? Math.min(SNAP_ORDER.length - 1, index + 1) : Math.max(0, index - 1)]);
      }
    });
    add(this.container.querySelector('#examSheetPrev'), 'click', () => this.goToQuestion(this.currentIndex - 1));
    add(this.sheetProgress, 'click', () => this.showAnswerCard());
    add(this.container.querySelector('#examSheetNext'), 'click', () => this.goToQuestion(this.currentIndex + 1));
    add(this.bookmarkBtn, 'click', () => this.toggleBookmark());
    add(this.wrongBtn, 'click', () => this.toggleExplanationWrong());
    add(this.container.querySelector('#examExplanationBack'), 'click', () => { location.hash = `#/exam/result/${this.attempt.attemptId}`; });
    add(this.articleInner, 'click', event => {
      const button = event.target?.closest?.('[data-paragraph-translation-toggle]');
      if (!button || !this.articleInner.contains(button)) return;
      event.preventDefault();
      void this.toggleParagraphTranslation(button.dataset.paragraphKey);
    });
    this.bindPaneSplitter();
    this._dispose = () => {
      if (this._drag) {
        document.removeEventListener('pointermove', this._drag.onMove);
        document.removeEventListener('pointerup', this._drag.onUp);
      }
      this._paneSplitterCleanup?.();
      this._disposed = true;
      onCleanup.forEach(remove => remove());
    };
  },

  bindPaneSplitter() {
    this._paneSplitterCleanup?.();
    const splitter = this.container?.querySelector('#examPaneSplitter');
    if (!splitter) return;
    const onPointerDown = event => this.startPaneResize(event);
    const onResize = () => this.syncPaneSplitForViewport();
    const onKeyDown = event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        this.resizePaneWithKeyboard(event.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    splitter.addEventListener('pointerdown', onPointerDown);
    splitter.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    this._paneSplitterCleanup = () => {
      splitter.removeEventListener('pointerdown', onPointerDown);
      splitter.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
      this.endPaneResize();
      this._paneSplitterCleanup = null;
    };
  },

  isWidePaneLayout() {
    return Boolean(window.matchMedia?.('(min-width: 840px)').matches && this.practiceRoot && this.articleScroll && this.sheet);
  },

  syncPaneSplitForViewport() {
    if (!this.isWidePaneLayout()) this.resetPaneSplit();
  },

  paneSplitBounds() {
    const minLeft = 420;
    const minRight = 340;
    const divider = 10;
    const rootWidth = this.practiceRoot?.getBoundingClientRect().width || 0;
    const available = Math.max(0, rootWidth - divider);
    if (available < minLeft + minRight) return { lower: 0, upper: available, divider };
    const lower = minLeft;
    const upper = available - minRight;
    return { lower, upper, divider };
  },

  setPaneSplit(left) {
    if (!this.isWidePaneLayout()) return;
    const { lower, upper, divider } = this.paneSplitBounds();
    const bounded = Math.min(upper, Math.max(lower, left));
    this.practiceRoot.style.gridTemplateColumns = `${Math.round(bounded)}px ${divider}px minmax(340px, 1fr)`;
    const splitter = this.container.querySelector('#examPaneSplitter');
    splitter?.setAttribute('aria-valuemin', String(Math.round(lower)));
    splitter?.setAttribute('aria-valuemax', String(Math.round(upper)));
    splitter?.setAttribute('aria-valuenow', String(Math.round(bounded)));
  },

  resetPaneSplit() {
    this.endPaneResize();
    if (!this.practiceRoot) return;
    this.practiceRoot.style.gridTemplateColumns = '';
    const splitter = this.container?.querySelector('#examPaneSplitter');
    splitter?.removeAttribute('aria-valuemax');
    splitter?.removeAttribute('aria-valuenow');
  },

  resizePaneWithKeyboard(direction) {
    if (!this.isWidePaneLayout()) return;
    const left = this.articleScroll.getBoundingClientRect().width;
    this.setPaneSplit(left + direction * 24);
  },

  startPaneResize(event) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    if (!this.isWidePaneLayout()) return;
    event.preventDefault();
    const splitter = event.currentTarget;
    const rootLeft = this.practiceRoot.getBoundingClientRect().left;
    const pointerId = event.pointerId;
    splitter?.setPointerCapture?.(pointerId);
    const onMove = moveEvent => {
      if (moveEvent.pointerId !== pointerId) return;
      this.setPaneSplit(moveEvent.clientX - rootLeft);
    };
    const onUp = upEvent => {
      if (upEvent.pointerId !== pointerId) return;
      this.endPaneResize();
    };
    this.endPaneResize();
    this._paneResize = { onMove, onUp };
    document.body.classList.add('exam-pane-resizing');
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  },

  endPaneResize() {
    if (!this._paneResize) return;
    document.removeEventListener('pointermove', this._paneResize.onMove);
    document.removeEventListener('pointerup', this._paneResize.onUp);
    document.removeEventListener('pointercancel', this._paneResize.onUp);
    document.body.classList.remove('exam-pane-resizing');
    this._paneResize = null;
  },

  startTimer() {
    this.examStudyTimer = new StudySessionTimer({
      sessionId: `exam:${this.attempt?.attemptId || Date.now()}`,
      mode: 'exam',
      idleMs: IDLE_PAUSE_MS
    });
    this.examStudyTimer.start({ contextKey: examTypeKey(this.unit) });
    this.active = true;
    this.lastActiveAt = Date.now();
    this.scheduleIdle();
  },

  pauseTimer(reason = 'paused') {
    const slices = this.examStudyTimer?.pause(reason) || [];
    this.enqueueActiveSlices(slices, this.unit);
    this.active = false;
    this.activeDurationMs = this.getActiveDuration();
    if (this._idleTimer) clearTimeout(this._idleTimer);
    this._idleTimer = null;
  },

  noteActivity() {
    if (this._disposed) return;
    if (!this.examStudyTimer || this.examStudyTimer.finished) return;
    if (this.examStudyTimer.activeStartedAt === null || this.examStudyTimer.paused) {
      this.examStudyTimer.start({ contextKey: examTypeKey(this.unit) });
    } else {
      this.examStudyTimer.noteActivity();
      this.enqueueActiveSlices(this.examStudyTimer.consumeNewSlices(), this.unit);
    }
    this.active = true;
    this.lastActiveAt = Date.now();
    this.scheduleIdle();
  },

  scheduleIdle() {
    if (this._idleTimer) clearTimeout(this._idleTimer);
    this._idleTimer = setTimeout(() => this.pauseTimer('idle'), IDLE_PAUSE_MS);
  },

  getActiveDuration() {
    if (!this.examStudyTimer) return Number(this.activeDurationMs) || 0;
    return this.restoredActiveDurationMs + this.examStudyTimer.getActiveDuration();
  },

  scheduleAutosave() {
    if (this._autosaveTimer) clearTimeout(this._autosaveTimer);
    this._autosaveTimer = setTimeout(() => this.persistDraft(), AUTOSAVE_MS);
  },

  async persistDraft() {
    if (this._disposed || this.attempt?.status !== 'in_progress') return;
    if (this._savePromise) return this._savePromise;
    this.activeDurationMs = this.getActiveDuration();
    const snapshot = {
      examId: this.attempt.examId,
      attempt: this.attempt,
      responses: [...this.responses.values()],
      activeDurationMs: this.getActiveDuration()
    };
    this._savePromise = this.services.practiceService.autosave(snapshot)
      .then(next => {
        if (!this._disposed) this.attempt = next;
      })
      .finally(() => {
        this._savePromise = null;
      });
    return this._savePromise;
  },

  flushAutosave() {
    if (!this.attempt || this.attempt.status !== 'in_progress' || this._disposed) return Promise.resolve();
    if (this._autosaveTimer) clearTimeout(this._autosaveTimer);
    this._autosaveTimer = null;
    return this.persistDraft();
  },

  getParagraphTranslationState() {
    if (!this._paragraphTranslationState) this._paragraphTranslationState = new Map();
    const unitKey = this.unit?.unitKey || '<missing-unit>';
    if (!this._paragraphTranslationState.has(unitKey)) this._paragraphTranslationState.set(unitKey, new Map());
    return this._paragraphTranslationState.get(unitKey);
  },

  async toggleParagraphTranslation(paragraphKey) {
    if (!this.isExplanation || this.unit?.type !== 'reading_mcq') return;
    const paragraph = (this.unit.passage || []).find(item => item.paragraphKey === paragraphKey);
    if (!paragraph) return;
    const state = this.getParagraphTranslationState();
    const current = state.get(paragraphKey) || {};
    const storedText = this.unit.translation?.find(item => item.paragraphKey === paragraphKey)?.text || '';
    const existing = String(current.text ?? storedText).trim();
    if (current.status === 'loading') return;
    if (existing) {
      state.set(paragraphKey, { ...current, status: 'ready', text: existing, expanded: current.expanded === false });
      this.renderArticle();
      return;
    }
    const requestId = ++this._paragraphTranslationRequestSequence;
    const unitKey = this.unit.unitKey;
    const sourceText = String(paragraph.text || '').trim();
    state.set(paragraphKey, { status: 'loading', expanded: false, requestId });
    this.renderArticle();
    try {
      const result = await paragraphTranslationService.getOrTranslate({
        context: {
          examId: this.attempt?.examId || this.paper?.examId,
          bankId: this.paper?.bankId || this.attempt?.bankId,
          packageId: this.paper?.packageId,
          paperKey: this.paper?.paperKey,
          unitKey,
          paragraphKey
        },
        text: sourceText
      });
      if (this._disposed || !this.isExplanation || this.unit?.unitKey !== unitKey) return;
      const latest = this.getParagraphTranslationState().get(paragraphKey);
      if (latest?.requestId !== requestId) return;
      this.getParagraphTranslationState().set(paragraphKey, { status: 'ready', text: result.text, source: result.source, expanded: true, requestId });
      this.renderArticle();
    } catch (error) {
      if (this._disposed || !this.isExplanation || this.unit?.unitKey !== unitKey) return;
      const latest = this.getParagraphTranslationState().get(paragraphKey);
      if (latest?.requestId !== requestId) return;
      this.getParagraphTranslationState().set(paragraphKey, { status: 'error', expanded: false, requestId, error: error?.message || '翻译失败' });
      this.renderArticle();
    }
  },

  renderArticle() {
    if (!this.articleInner) return;
    this.articleInner.innerHTML = `
      <div class="exam-practice-titlebar" data-type="${esc(this.unit.type)}">
        <div>
          <p class="page-eyebrow">${esc(this.paper?.year || '')} · ${sectionLabel(this.unit, this.attempt?.examId)}</p>
<h2 class="exam-type-title">${esc(typeTitle(this.unit, this.attempt?.examId))}</h2>
        </div>
        ${this.isExplanation ? '' : '<button id="examOverflowBtn" class="app-icon-button" type="button" aria-label="更多操作">⋯</button>'}
      </div>
      ${this.renderer.renderArticle(this.unit, {
        responses: this.responses,
        currentQuestionKey: this.isExplanation ? this.questions[this.currentIndex]?.questionKey : this.attempt.currentQuestionKey,
        resultMode: Boolean(this.isExplanation),
        paragraphTranslationState: this.isExplanation && this.unit.type === 'reading_mcq'
          ? this.getParagraphTranslationState()
          : null
      })}
      ${this.isExplanation && this.unit.type !== 'reading_mcq' && this.unit.translation?.length ? `<section class="exam-postsubmit-translations"><h3>全文翻译</h3>${this.unit.translation.map(paragraph => `<details><summary>显示 ${esc(paragraph.paragraphKey)} 段翻译</summary><p>${esc(paragraph.text)}</p></details>`).join('')}</section>` : ''}
      ${this.isExplanation && this._contentUpdated ? '<p class="exam-content-updated">题库内容此后有更新</p>' : ''}`;
    this.articleInner.querySelectorAll('[data-blank], [data-slot]').forEach(button => {
      button.addEventListener('click', () => {
        const questionKey = button.dataset.blank || button.dataset.slot;
        const index = this.questions.findIndex(question => question.questionKey === questionKey);
        if (index >= 0) this.goToQuestion(index);
      });
    });
    this.articleInner.querySelectorAll('[data-translation-segment]').forEach(button => {
      button.addEventListener('click', () => {
        const index = this.questions.findIndex(question => question.questionKey === button.dataset.translationSegment);
        if (index >= 0) this.goToQuestion(index);
      });
    });
    this.articleInner.querySelector('#examOverflowBtn')?.addEventListener('click', () => this.showExitModal());
  },

  updateSheetStatus() {
    const question = this.questions[this.currentIndex];
    const response = question ? this.responses.get(question.questionKey) : null;
    if (!this.sheetProgress) return;
    const answered = this.unit.type === 'translation' ? Boolean(response?.value?.text?.trim()) : Boolean(response?.answer);
    const model = buildAnswerCardModel({ attempt: this.attempt, units: this.units, responses: this.responses, currentQuestionKey: question?.questionKey });
    const position = this.isFullPaper ? model.currentPosition : this.currentIndex + 1;
    const total = this.isFullPaper ? model.total : this.questions.length;
    this.sheetProgress.textContent = `${position} / ${total} · ${answered ? '已答' : '未答'}${response?.uncertain ? ' · ?' : ''}`;
    this.sheetProgress.setAttribute('aria-label', `打开答题卡，当前第 ${position} 题，共 ${total} 题，${answered ? '已答' : '未答'}`);
    this.updateSubmitButton();
  },

  isAtFinalQuestion() {
    const navigableUnits = (this.units || []).filter(unit => this.getQuestionsForUnit(unit).length);
    const currentUnitIndex = Math.max(0, navigableUnits.findIndex(unit => unit.unitKey === this.unit?.unitKey));
    return isFinalPracticeQuestion({
      practiceKind: this.isFullPaper ? 'full_paper' : 'unit',
      currentUnitIndex,
      unitCount: navigableUnits.length || 1,
      currentQuestionIndex: this.currentIndex,
      currentUnitQuestionCount: this.questions?.length || 0
    });
  },

  updateSubmitButton() {
    const submitButton = this.submitBtn || this.container?.querySelector('#examSubmitBtn');
    if (!submitButton || this.isExplanation) return;
    const visible = this.isAtFinalQuestion();
    submitButton.hidden = !visible;
    submitButton.setAttribute('aria-hidden', String(!visible));
  },

  renderQuestion() {
    const question = this.questions[this.currentIndex];
    if (!question) return;
    const response = this.responses.get(question.questionKey);
    this.sheetProgress.textContent = `${this.currentIndex + 1} / ${this.questions.length}`;
    this.sheetBody.innerHTML = this.renderer.renderQuestion(question, {
      response,
      optionOrder: this.attempt.optionOrders?.[question.questionKey],
      candidateOrder: this.attempt.candidateOrders?.[this.unit.unitKey] || this.attempt.candidateOrder,
      unit: this.unit,
      responses: this.responses
    });
    this.sheetBody.querySelector('[data-translation-input]')?.addEventListener('input', event => this.setTranslationText(event.target.value));
    this.sheetBody.querySelectorAll('[data-key]').forEach(button => {
      button.addEventListener('click', () => this.selectAnswer(button.dataset.key));
    });
    this.uncertainBtn.classList.toggle('is-active', Boolean(response?.uncertain));
    this.uncertainBtn.textContent = response?.uncertain ? '? 已标记' : '? 不确定';
    this.updateSheetStatus();
    this.updateBookmarkButton();
  },

  renderSubmittedQuestion() {
    const question = this.questions[this.currentIndex];
    if (!question) return;
    const response = this.responses.get(question.questionKey);
    if (this.unit.type === 'translation') {
      const label = this.renderer.questionLabel(question, this.currentIndex);
      const hasUserTranslation = Boolean(response?.value?.text?.trim());
      const feedback = this.examTutor?.getTranslationTrainingFeedback(this.getExamTutorInput()).feedback || null;
      this.sheetProgress.textContent = `${this.currentIndex + 1} / ${this.questions.length}`;
      this.sheetBody.innerHTML = `
        <div class="exam-explanation-head" data-question-key="${esc(question.questionKey)}">
          <h3>${esc(label)}</h3>
          ${this.renderer.resultDetailHtml(question, response, { unit: this.unit, responses: [...this.responses.values()], optionOrder: this.attempt.optionOrders?.[question.questionKey], candidateOrder: this.attempt.candidateOrders?.[this.unit.unitKey] || this.attempt.candidateOrder, includeSummary: false })}
          ${feedback ? translationTrainingFeedbackHtml(feedback) : hasUserTranslation ? `<div class="exam-translation-tutor-action"><button id="examTranslationTutorScore" class="btn btn-outline exam-tutor-open" type="button">✨ AI 批改我的译文</button><p id="examTranslationTutorError" class="exam-tutor-error" hidden></p></div>` : '<p class="exam-translation-tutor-disabled">本题未填写译文</p>'}
          <div class="exam-translation-review" data-review-question="${esc(question.questionKey)}">
            <span>复习状态</span>
            <button type="button" class="btn btn-outline btn-sm" data-review-status="needs_review">需要复习</button>
            <button type="button" class="btn btn-outline btn-sm" data-review-status="mostly_mastered">基本掌握</button>
            <button type="button" class="btn btn-outline btn-sm" data-review-status="mastered">已掌握</button>
          </div>
        </div>`;
      this.sheetBody.querySelectorAll('[data-review-status]').forEach(button => {
        button.addEventListener('click', () => this.setTranslationReview(button.dataset.reviewStatus));
      });
      this.sheetBody.querySelector('#examTranslationTutorScore')?.addEventListener('click', () => this.scoreTranslationTutor());
      this.sheetBody.querySelector('#examTranslationTutorContinue')?.addEventListener('click', () => this.openTranslationTutor());
      this.updateTranslationReview();
      return;
    }
    const correctAnswer = response?.correctOptionKeyAtSubmit || question.answer;
    const label = this.renderer.questionLabel(question, this.currentIndex);
    const state = response?.unanswered ? '未答' : response?.correct ? '✓' : '✕';
    const tutorLabel = response?.correct ? '✨ AI分析这道题' : '✨ AI分析我为什么会错';
    this.sheetProgress.textContent = `${this.currentIndex + 1} / ${this.questions.length} · ${state}`;
    this.sheetBody.innerHTML = `
      <div class="exam-explanation-head" data-question-key="${esc(question.questionKey)}"><h3>${esc(label)} ${state}</h3><p data-selection-source="question">我的答案：${esc(response?.answer || '未答')}<br>正确答案：${esc(correctAnswer)}${question.questionType ? `<br>${esc(question.questionType)}` : ''}</p>${response?.uncertain ? '<p class="exam-uncertain-note">? 作答时标记为不确定</p>' : ''}<button id="examTutorOpen" class="btn btn-outline exam-tutor-open" type="button">${tutorLabel}</button></div>
      <details class="exam-explanation-details"><summary>展开完整解析</summary>${this.renderer.resultDetailHtml(question, response, { unit: this.unit, responses: [...this.responses.values()], optionOrder: this.attempt.optionOrders?.[question.questionKey], candidateOrder: this.attempt.candidateOrders?.[this.unit.unitKey] || this.attempt.candidateOrder, includeSummary: false })}</details>`;
    this.sheetBody.querySelector('#examTutorOpen')?.addEventListener('click', () => this.openExamTutor());
    this.sheetBody.querySelectorAll('.exam-jump-evidence').forEach(button => {
      button.addEventListener('click', () => this.jumpToEvidence(button.dataset.location));
    });
    this.updateExplanationActions();
  },

  getExamTutorInput() {
    const question = this.questions[this.currentIndex];
    return {
      attempt: this.attempt,
      response: question ? this.responses.get(question.questionKey) : null,
      question,
      unit: this.unit
    };
  },

  async getTranslationTutorInput(question = this.questions[this.currentIndex]) {
    const response = question ? this.responses.get(question.questionKey) : null;
    const review = question ? await this.services.stateRepository.getTranslationReview({
      examId: this.attempt.examId,
      bankId: this.attempt.bankId,
      questionKey: question.questionKey
    }) : null;
    return {
      attempt: this.attempt,
      response,
      question,
      unit: this.unit,
      translationReviewStatus: review?.status
    };
  },

  async scoreTranslationTutor() {
    if (!this.isExplanation || this.unit?.type !== 'translation' || !this.examTutor) return;
    const button = this.sheetBody.querySelector('#examTranslationTutorScore');
    const error = this.sheetBody.querySelector('#examTranslationTutorError');
    if (!button) return;
    button.disabled = true;
    button.textContent = 'AI 批改中…';
    if (error) error.hidden = true;
    try {
      await this.examTutor.scoreTranslation(await this.getTranslationTutorInput());
      this.renderSubmittedQuestion();
    } catch (requestError) {
      button.disabled = false;
      button.textContent = '✨ AI 批改我的译文';
      if (error) {
        error.textContent = `暂时无法批改：${requestError.message || '请求失败'}`;
        error.hidden = false;
      }
    }
  },

  async openTranslationTutor({ quote = null } = {}) {
    if (!this.isExplanation || this.unit?.type !== 'translation' || !this.examTutorDialog) return;
    this.examTutorDialog.open({ ...await this.getTranslationTutorInput(), quote });
  },

  openExamTutor() {
    if (!this.isExplanation || !this.examTutorDialog) return;
    const input = this.getExamTutorInput();
    this.examTutorDialog.open(input);
  },

  async updateExplanationActions() {
    const question = this.questions[this.currentIndex];
    if (!question || !this.isExplanation) return;
    const wrong = await this.services.stateRepository.getWrongState({ examId: this.attempt.examId, bankId: this.attempt.bankId, questionKey: question.questionKey });
    this.wrongBtn.disabled = wrong?.status === 'active';
    this.wrongBtn.textContent = !wrong ? '加入错题本' : wrong.status === 'mastered' ? '重新加入复习' : '已在复习';
    await this.updateBookmarkButton();
  },

  async toggleExplanationWrong() {
    const question = this.questions[this.currentIndex];
    const wrong = await this.services.stateRepository.getWrongState({ examId: this.attempt.examId, bankId: this.attempt.bankId, questionKey: question.questionKey });
    if (wrong?.status === 'active') return;
    await this.services.practiceService.addWrongQuestions({ examId: this.attempt.examId, attemptId: this.attempt.attemptId, questionKeys: [question.questionKey] });
    await this.updateExplanationActions();
  },

  jumpToEvidence(location) {
    const key = String(location || '').match(/P\d+/)?.[0];
    const target = key ? this.articleInner.querySelector(`[data-paragraph-key="${key}"]`) : null;
    if (!target) return;
    this.setSnap('low');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('is-evidence-highlight');
    clearTimeout(this._evidenceHighlightTimer);
    this._evidenceHighlightTimer = setTimeout(() => target.classList.remove('is-evidence-highlight'), 3600);
  },

  selectAnswer(answerKey) {
    const question = this.questions[this.currentIndex];
    if (this.unit.type === 'translation') return;
    if (['paragraph_ordering', 'matching'].includes(this.unit.type)) {
      const fixedKeys = new Set((this.unit.fixedPlacements || []).map(item => item.candidateKey));
      const candidateKeys = new Set((this.unit.candidates || []).map(candidate => candidate.candidateKey));
      if (fixedKeys.has(answerKey) || !candidateKeys.has(answerKey)) return;
      for (const [key, value] of this.responses) {
        if (value?.answer === answerKey && key !== question.questionKey) {
          value.answer = null;
          value.answeredAt = null;
          value.correct = null;
          value.pointsEarned = null;
        }
      }
    }
    const existing = this.responses.get(question.questionKey);
    const response = existing || createResponse(this.attempt, question.questionKey);
    response.answer = answerKey;
    response.answeredAt = Date.now();
    response.correct = null;
    response.pointsEarned = null;
    this.responses.set(question.questionKey, response);
    this.renderArticle();
    this.renderQuestion();
    this.scheduleAutosave();
  },

  toggleUncertain() {
    const question = this.questions[this.currentIndex];
    const response = this.responses.get(question.questionKey) || createResponse(this.attempt, question.questionKey);
    response.uncertain = !response.uncertain;
    this.responses.set(question.questionKey, response);
    this.renderArticle();
    this.renderQuestion();
    this.scheduleAutosave();
  },

  setTranslationText(text) {
    const question = this.questions[this.currentIndex];
    if (!question || this.unit.type !== 'translation') return;
    const response = this.responses.get(question.questionKey) || createResponse(this.attempt, question.questionKey, { value: { text: '' } });
    response.value = { text: String(text ?? '') };
    response.answeredAt = response.value.text.trim() ? Date.now() : null;
    response.answer = null;
    response.correct = null;
    response.pointsEarned = null;
    this.responses.set(question.questionKey, response);
    this.renderArticle();
    this.updateSheetStatus();
    this.scheduleAutosave();
  },

  async updateTranslationReview() {
    if (!this.isExplanation || this.unit.type !== 'translation') return;
    const question = this.questions[this.currentIndex];
    const current = await this.services.stateRepository.getTranslationReview({
      examId: this.attempt.examId,
      bankId: this.attempt.bankId,
      questionKey: question.questionKey
    });
    this.sheetBody.querySelectorAll('[data-review-status]').forEach(button => {
      button.classList.toggle('is-active', button.dataset.reviewStatus === current?.status);
    });
  },

  async setTranslationReview(status) {
    if (!this.isExplanation || this.unit.type !== 'translation') return;
    await this.services.practiceService.setTranslationReview({
      examId: this.attempt.examId,
      attemptId: this.attempt.attemptId,
      questionKey: this.questions[this.currentIndex].questionKey,
      status
    });
    await this.updateTranslationReview();
  },

  async toggleBookmark() {
    const question = this.questions[this.currentIndex];
    const isBookmarked = await this.services.practiceService.toggleBookmark({
      examId: this.attempt.examId,
      attempt: this.attempt,
      questionKey: question.questionKey,
      unitKey: this.unit.unitKey
    });
    this._bookmarked = isBookmarked;
    this.updateBookmarkButton();
  },

  async updateBookmarkButton() {
    const question = this.questions[this.currentIndex];
    if (!question) return;
    const bookmark = await this.services.stateRepository.getBookmark({
      examId: this.attempt.examId,
      bankId: this.attempt.bankId,
      questionKey: question.questionKey
    });
    this.bookmarkBtn.classList.toggle('is-active', Boolean(bookmark));
    this.bookmarkBtn.textContent = bookmark ? '已收藏' : '收藏';
  },

  goToQuestion(index) {
    this.clearSentenceAiConfirmation?.();
    if (this.isFullPaper && (index < 0 || index >= this.questions.length)) {
      const unitIndex = this.units.findIndex(unit => unit.unitKey === this.unit.unitKey);
      if (index < 0 && unitIndex > 0) {
        const previous = this.getQuestionsForUnit(this.units[unitIndex - 1]);
        return this.goToUnit(unitIndex - 1, previous.length - 1);
      }
      if (index >= this.questions.length && unitIndex < this.units.length - 1) {
        return this.goToUnit(unitIndex + 1, 0);
      }
      return;
    }
    if (index < 0 || index >= this.questions.length) return;
    this.currentIndex = index;
    if (this.isExplanation) {
      this.renderArticle();
      this.renderSubmittedQuestion();
      return;
    }
    this.attempt.currentQuestionKey = this.questions[index].questionKey;
    this.renderArticle();
    this.renderQuestion();
    this.scheduleAutosave();
  },

  goToQuestionKey(questionKey) {
    const unitIndex = this.units.findIndex(unit => this.getQuestionsForUnit(unit).some(question => question.questionKey === questionKey));
    if (unitIndex < 0) return false;
    const questions = this.getQuestionsForUnit(this.units[unitIndex]);
    const questionIndex = questions.findIndex(question => question.questionKey === questionKey);
    if (questionIndex < 0) return false;
    if (this.units[unitIndex].unitKey === this.unit.unitKey) {
      this.goToQuestion(questionIndex);
      return true;
    }
    return this.goToUnit(unitIndex, questionIndex);
  },

  showAnswerCard() {
    if (this._answerCardOverlay) return;
    const model = buildAnswerCardModel({
      attempt: this.attempt,
      units: this.units,
      responses: this.responses,
      currentQuestionKey: this.questions[this.currentIndex]?.questionKey
    });
    const overlay = document.createElement('div');
    overlay.id = 'examAnswerCardOverlay';
    overlay.className = 'modal-overlay exam-answer-card-overlay';
    overlay.innerHTML = renderAnswerCardHtml(model, { readOnly: this.isExplanation });
    document.body.appendChild(overlay);
    document.body.classList.add('exam-answer-card-open');
    this._answerCardOverlay = overlay;
    this._answerCardReturnFocus = document.activeElement;
    overlay.querySelector('#examAnswerCardClose')?.addEventListener('click', () => this.closeAnswerCard());
    overlay.addEventListener('click', event => {
      if (event.target === overlay) this.closeAnswerCard();
      const questionKey = event.target.closest?.('[data-answer-question]')?.dataset.answerQuestion;
      if (questionKey) {
        this.closeAnswerCard({ restoreFocus: false });
        this.goToQuestionKey(questionKey);
        this.sheetProgress?.focus();
      }
    });
    overlay.querySelector('#examAnswerCardSubmit')?.addEventListener('click', () => {
      this.closeAnswerCard({ restoreFocus: false });
      this.requestSubmit({ allowFromAnywhere: true });
    });
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeAnswerCard();
        return;
      }
      if (event.key === 'Tab') {
        const focusable = [...overlay.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      const buttons = [...overlay.querySelectorAll('[data-answer-question]')];
      const index = buttons.indexOf(document.activeElement);
      if (index < 0) return;
      event.preventDefault();
      const delta = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
      buttons[(index + delta + buttons.length) % buttons.length]?.focus();
    });
    (overlay.querySelector('.is-current') || overlay.querySelector('[data-answer-question]') || overlay.querySelector('#examAnswerCardClose'))?.focus();
  },

  closeAnswerCard({ restoreFocus = true } = {}) {
    if (!this._answerCardOverlay) return;
    this._answerCardOverlay.remove();
    this._answerCardOverlay = null;
    document.body.classList.remove('exam-answer-card-open');
    if (restoreFocus) this._answerCardReturnFocus?.focus?.();
    this._answerCardReturnFocus = null;
  },

  startDrag(event) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    const startY = event.clientY;
    const startPct = SNAP_HEIGHTS[this.sheetSnap];
    const rootHeight = this.sheet.getBoundingClientRect().height;
    const onMove = moveEvent => {
      const delta = (startY - moveEvent.clientY) / rootHeight * 100;
      const pct = Math.max(SNAP_HEIGHTS.peek, Math.min(SNAP_HEIGHTS.high, startPct + delta));
      this.sheet.style.height = `${pct}%`;
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      const pct = Number.parseFloat(this.sheet.style.height) || SNAP_HEIGHTS[this.sheetSnap];
      this.sheet.style.height = '';
      this.setSnap(closestSnap(pct));
    };
    this._drag = { onMove, onUp };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  },

  setSnap(snap) {
    if (!SNAP_ORDER.includes(snap)) return;
    this.sheetSnap = snap;
    this.sheet.classList.remove('is-peek', 'is-low', 'is-mid', 'is-high');
    this.sheet.classList.add(`is-${snap}`);
    if (!this.isExplanation) {
      this.attempt.sheetSnap = snap;
      this.scheduleAutosave();
    }
  },

  showExitModal() {
    this.pauseTimer('exit-modal');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-compact" role="dialog" aria-modal="true" aria-labelledby="examExitTitle">
        <h2 id="examExitTitle">退出练习</h2>
        <p class="text-muted">你可以保存草稿，稍后继续。</p>
        <div class="modal-actions">
          <button id="examExitSave" class="btn btn-primary" type="button">保存并退出</button>
          <button id="examExitDiscard" class="btn btn-outline" type="button">放弃本次进度</button>
          <button id="examExitContinue" class="btn" type="button">继续练习</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#examExitSave').addEventListener('click', async () => {
      await this.flushActiveSlices();
      await this.flushAutosave();
      overlay.remove();
      this._disposed = true;
      location.hash = '#/exam';
    });
    overlay.querySelector('#examExitDiscard').addEventListener('click', async () => {
      try {
        await this.flushActiveSlices();
        await this.services.stateRepository.abandonAttempt({ examId: this.attempt.examId, attemptId: this.attempt.attemptId });
      } finally {
        overlay.remove();
        this._disposed = true;
        location.hash = '#/exam';
      }
    });
    overlay.querySelector('#examExitContinue').addEventListener('click', () => {
      overlay.remove();
      this.noteActivity();
    });
  },

  requestSubmit({ allowFromAnywhere = false } = {}) {
    if (!allowFromAnywhere && !this.isAtFinalQuestion()) return;
    const submitQuestions = this.isFullPaper ? this.allQuestions : this.questions;
    const unanswered = submitQuestions.filter(question => {
      const response = this.responses.get(question.questionKey);
      const questionUnit = this.getQuestionUnit(question);
      return questionUnit?.type === 'translation' ? !response?.value?.text?.trim() : !response?.answer;
    }).length;
    if (!unanswered) {
      this.submit();
      return;
    }
    this.pauseTimer('submit-modal');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-compact" role="dialog" aria-modal="true" aria-labelledby="examSubmitTitle">
        <h2 id="examSubmitTitle">还有 ${unanswered} 处未完成</h2>
        <p class="text-muted">${this.isFullPaper ? '整卷会一次性提交所有题型。' : this.unit.type === 'translation' ? '仍然提交吗？提交后译文不可修改。' : '未作答题目将按错误计分，提交后不可修改。'}</p>
        <div class="modal-actions">
          <button id="examForceSubmit" class="btn btn-primary" type="button">仍要提交</button>
          <button id="examCancelSubmit" class="btn" type="button">继续作答</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#examForceSubmit').addEventListener('click', () => {
      overlay.remove();
      this.submit();
    });
    overlay.querySelector('#examCancelSubmit').addEventListener('click', () => {
      overlay.remove();
      this.noteActivity();
    });
  },

  async submit() {
    if (this._submitting) return;
    this._submitting = true;
    try {
      this.pauseTimer('submit');
      await this.flushActiveSlices();
      await this.flushAutosave();
      const submitQuestions = this.isFullPaper ? this.allQuestions : this.questions;
      const responses = submitQuestions.map(question => {
        const questionUnit = this.getQuestionUnit(question);
        return this.responses.get(question.questionKey) || createResponse(this.attempt, question.questionKey, { unitKey: questionUnit?.unitKey });
      });
      const result = await this.services.practiceService.submit({
        examId: this.attempt.examId,
        attemptId: this.attempt.attemptId,
        responses,
        activeDurationMs: this.getActiveDuration()
      });
      this.attempt = result.attempt;
      if (this._autosaveTimer) {
        clearTimeout(this._autosaveTimer);
        this._autosaveTimer = null;
      }
      this.examStudyTimer?.finish('submitted');
      this._disposed = true;
      location.hash = `#/exam/result/${this.attempt.attemptId}`;
    } finally {
      this._submitting = false;
    }
  }
};
