import { Affixes } from '../affixes.js';
import { API } from '../api.js';
import { AudioCache } from '../audio-cache.js';
import { Config } from '../config.js';
import { ExamCorpus } from '../exam-corpus-runtime.mjs';
import { Examples } from '../examples.js';
import { esc } from '../helpers.js';
import { formatPartOfSpeech, formatPhonetic, getDefinitionDisplayLines, getDefinitionSenses } from './definition-trust.mjs';
import { WordPhrases } from './word-phrases.js';
import { WordSimilar } from './word-similar.js';
import { renderExamCorpusDetail, selectExamCorpusPresentation } from './exam-corpus-presentation.mjs';
import {
  isWordStudyTab,
  mergeWordStudyExamples,
  normalizeWordStudyExample,
  renderWordStudyPanel,
  renderWordStudyTabs
} from './word-study-materials.mjs';
import {
  getFocusedWordStudyExamples,
  getHorizontalSwipeDirection,
  renderFocusedWordStudyExample,
  renderWordStudyDefinitionLine
} from './word-study-stage.mjs';

function renderContextualSense(definition) {
  const index = Number(definition?.contextualSenseIndex);
  const sense = Number.isInteger(index) ? getDefinitionSenses(definition)[index] : null;
  if (!sense) return '';
  const label = formatPartOfSpeech(sense.pos) || '词性待确认';
  const reason = String(definition?.contextualSenseReason || '').trim();
  return `<div class="word-study-contextual-sense"><span>本句义</span><div class="definition-line"><b class="definition-pos">${esc(label)}</b><strong>${esc(sense.glossZh)}</strong></div>${reason ? `<small>${esc(reason)}</small>` : ''}</div>`;
}

export const WordStudyDetail = {
  overlay: null,
  session: 0,
  activeTab: 'examples',
  definition: null,
  sourceMeta: {},
  materialStatus: 'idle',
  materialStages: { examples: 'idle', root: 'idle', exam: 'idle' },
  materialExampleSources: { exam: [], personal: [] },
  materialExamplePending: 0,
  materials: { examples: [], rootAnalysis: null },
  phrases: { status: 'idle', items: [] },
  similar: { status: 'idle', items: [] },
  phraseController: null,
  similarController: null,
  rootController: null,
  exampleIndex: 0,
  examplesExpanded: false,
  previousFocus: null,
  _exampleGesture: null,
  _exampleGestureMoved: false,
  _onKeydown: null,

  ensureOverlay() {
    if (this.overlay?.isConnected) return this.overlay;
    const overlay = document.createElement('div');
    overlay.id = 'wordStudyDetailOverlay';
    overlay.className = 'modal-overlay word-study-detail-overlay';
    overlay.style.display = 'none';
    overlay.addEventListener('click', event => this.handleClick(event));
    overlay.addEventListener('pointerdown', event => this.handleExamplePointerDown(event));
    overlay.addEventListener('pointerup', event => this.handleExamplePointerUp(event));
    overlay.addEventListener('pointercancel', () => { this._exampleGesture = null; });
    document.body.appendChild(overlay);
    this.overlay = overlay;
    return overlay;
  },

  open({ word, definition = {}, sourceMeta = {} } = {}) {
    const normalizedWord = String(word || definition?.word || '').trim();
    if (!normalizedWord) return false;

    this.close();
    const overlay = this.ensureOverlay();
    document.body.appendChild(overlay);
    this.session += 1;
    const session = this.session;
    this.activeTab = 'examples';
    this.exampleIndex = 0;
    this.examplesExpanded = false;
    this.definition = { ...definition, word: normalizedWord };
    this.sourceMeta = { ...sourceMeta };
    const cachedExamples = Examples.getCachedExamples?.(normalizedWord) || [];
    const cachedRoot = Affixes.getCachedAnalysis?.(normalizedWord) || null;
    this.materialStatus = cachedExamples.length || cachedRoot ? 'partial' : 'loading';
    this.materialStages = {
      examples: cachedExamples.length ? 'partial' : 'loading',
      root: cachedRoot ? 'ready' : 'loading',
      exam: definition?.examCorpus ? 'ready' : 'loading'
    };
    this.materialExampleSources = { exam: [], personal: cachedExamples };
    this.materialExamplePending = 2;
    this.materials = { examples: cachedExamples, rootAnalysis: cachedRoot };
    this.phrases = { status: 'idle', items: [] };
    this.similar = { status: 'idle', items: [] };
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    overlay.innerHTML = this.renderSheet();
    overlay.style.display = 'flex';
    document.body.classList.add('word-study-detail-open');
    this.bindEscape();
    overlay.querySelector('.word-study-close')?.focus();
    void this.loadMaterials(session, normalizedWord);
    return true;
  },

  renderSheet() {
    const word = this.definition?.word || '';
    const phonetic = formatPhonetic(this.definition?.phonetic);
    const definitionLines = getDefinitionDisplayLines(this.definition);
    const targetTrack = this.sourceMeta?.targetTrack || Config.get('exam_level') || '';
    const examPresentation = selectExamCorpusPresentation(this.definition?.examCorpus, targetTrack);
    const eyebrow = this.sourceMeta?.eyebrow || 'WORD NOTE';
    const status = this.sourceMeta?.status;
    const originLabel = this.sourceMeta?.originLabel || '离线词典';
    const examMarkup = renderExamCorpusDetail(examPresentation, esc)
      || '<p class="word-study-info-empty">当前没有可显示的考试频度记录。</p>';
    return `
      <section class="word-study-detail-sheet word-study-detail-sheet--stage word-study-content" data-word-study-content="detail" role="dialog" aria-modal="true" aria-labelledby="wordStudyDetailTitle">
        <header class="app-header word-study-detail-app-header">
          <button class="app-icon-button word-study-close" type="button" aria-label="关闭单词学习详情" title="返回"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i></button>
          <div class="app-header-copy"><p class="app-header-kicker">ENGLISH LEARNING</p><h1 class="app-header-title">单词学习</h1></div>
          <div class="app-header-actions" aria-hidden="true"></div>
        </header>
        <header class="flashcard-study-head flashcard-study-masthead word-study-detail-masthead">
          <p class="flashcard-study-kicker">${esc(eyebrow)}</p>
          <button id="wordStudyDetailTitle" class="flashcard-study-word" type="button" data-audio-word="${esc(word)}" title="播放发音">${esc(word)}</button>
          ${phonetic ? `<button class="flashcard-study-phonetic" type="button" data-audio-word="${esc(word)}" title="播放发音">${esc(phonetic)}</button>` : ''}
          ${renderContextualSense(this.definition)}
          <div class="flashcard-study-definition-list">${definitionLines.length
            ? definitionLines.map(line => renderWordStudyDefinitionLine(line)).join('')
            : '<div class="flashcard-study-translation">暂无可靠中文释义</div>'}</div>
          <button class="flashcard-study-info-trigger" type="button" data-study-info-open aria-haspopup="dialog" aria-expanded="false">
            <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
            <span>词汇信息</span>
          </button>
        </header>
        <nav class="flashcard-study-tabs" role="tablist" aria-label="学习资料">${renderWordStudyTabs(this.activeTab)}</nav>
        <div class="flashcard-study-panel word-study-detail-panel word-study-material-pane" data-word-study-pane="materials" role="tabpanel">${this.renderPanelContent()}</div>
        <div class="flashcard-study-info-overlay word-study-detail-info-overlay" data-study-info-overlay hidden>
          <button class="flashcard-study-info-backdrop" type="button" data-study-info-close aria-label="关闭词汇信息"></button>
          <section class="flashcard-study-info-sheet" role="dialog" aria-modal="true" aria-labelledby="wordStudyInfoTitle">
            <header>
              <div>
                <p class="page-eyebrow">${esc(eyebrow)}</p>
                <h3 id="wordStudyInfoTitle">词汇信息</h3>
              </div>
              <button class="flashcard-study-info-close" type="button" data-study-info-close aria-label="关闭词汇信息"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
            </header>
            <div data-word-study-exam-corpus>${examMarkup}</div>
            <div class="word-study-detail-info-row"><span>资料来源</span><strong>${esc(originLabel)}</strong></div>
            ${status ? `<div class="word-study-detail-info-row"><span>学习状态</span><strong>${esc(status.icon || '')} ${esc(status.label || '')}</strong></div>` : ''}
            ${this.sourceMeta?.schedule ? `<div class="word-study-detail-info-row"><span>复习间隔</span><strong>${esc(this.sourceMeta.schedule)}</strong></div>` : ''}
            ${this.sourceMeta?.contextSentence ? `<blockquote class="word-study-context">${esc(this.sourceMeta.contextSentence)}</blockquote>` : ''}
          </section>
        </div>
      </section>`;
  },

  renderPanelContent() {
    if (this.activeTab === 'examples' && this.materialStages.examples === 'loading' && !this.materials.examples.length) {
      return '<div class="word-study-detail-material-loading flashcard-study-loading" role="status"><span>正在查找例句…</span><small>已有资料会优先显示，其他内容会继续补充</small></div>';
    }
    if ((this.activeTab === 'roots' || this.activeTab === 'related')
      && this.materialStages.root === 'loading'
      && !this.materials.rootAnalysis) {
      return '<div class="word-study-detail-material-loading flashcard-study-loading" role="status"><span>正在整理词根资料…</span><small>例句和词汇信息不受影响</small></div>';
    }
    if (this.activeTab === 'examples' && !this.examplesExpanded) {
      return this.renderFocusedExample();
    }
    const materials = renderWordStudyPanel({
      activeTab: this.activeTab,
      examples: this.materials.examples,
      rootAnalysis: this.materials.rootAnalysis,
      phrases: this.phrases,
      similar: this.similar
    });
    if (this.activeTab !== 'examples') return materials;
    return `<div class="flashcard-study-all-examples-head">
      <button type="button" data-example-focus-one><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> 返回单句学习</button>
      <span>全部 ${this.materials.examples.length} 句</span>
    </div>${materials}`;
  },

  renderFocusedExample() {
    const examples = getFocusedWordStudyExamples(this.materials.examples);
    if (!examples.length) return '<div class="word-study-empty flashcard-study-empty">暂无例句。</div>';
    this.exampleIndex = Math.min(Math.max(0, this.exampleIndex), examples.length - 1);
    return renderFocusedWordStudyExample({
      examples: this.materials.examples,
      index: this.exampleIndex,
      targetWord: this.definition?.word || ''
    });
  },

  renderPanel() {
    if (!this.overlay || this.overlay.style.display === 'none') return;
    const panel = this.overlay.querySelector('.word-study-detail-panel');
    if (panel) {
      const scrollTop = panel.scrollTop;
      panel.innerHTML = this.renderPanelContent();
      panel.scrollTop = scrollTop;
    }
    this.overlay.querySelectorAll('[data-study-tab]').forEach(button => {
      const active = button.dataset.studyTab === this.activeTab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
  },

  updateExampleMaterials(session, word, source, examples) {
    if (!this.isCurrent(session, word)) return;
    this.materialExampleSources[source] = Array.isArray(examples) ? examples : [];
    this.materialExamplePending = Math.max(0, this.materialExamplePending - 1);
    this.materials = {
      ...this.materials,
      examples: mergeWordStudyExamples(this.materialExampleSources.exam, this.materialExampleSources.personal)
    };
    this.materialStages.examples = this.materialExamplePending > 0
      ? (this.materials.examples.length ? 'partial' : 'loading')
      : 'ready';
    this.materialStatus = this.materialStages.examples === 'ready' && this.materialStages.root !== 'loading'
      ? 'ready'
      : 'partial';
    this.renderPanel();
  },

  async loadMaterials(session, word) {
    const targetTrack = this.sourceMeta?.targetTrack || Config.get('exam_level') || '';
    const tasks = [
      ExamCorpus.getExamples(word, targetTrack).then(
        examples => this.updateExampleMaterials(session, word, 'exam', examples),
        () => this.updateExampleMaterials(session, word, 'exam', [])
      ),
      Examples.getExamples(word).then(
        examples => this.updateExampleMaterials(session, word, 'personal', examples),
        () => this.updateExampleMaterials(session, word, 'personal', [])
      ),
      Affixes.getAnalysis(word).then(async rootAnalysis => {
        if (!this.isCurrent(session, word)) return;
        this.materialStages.root = 'ready';
        this.materialStatus = this.materialStages.examples === 'ready' ? 'ready' : 'partial';
        this.materials = { ...this.materials, rootAnalysis: rootAnalysis || null };
        this.renderPanel();
        if (rootAnalysis && Affixes.getRelatedWordDetails(rootAnalysis).some(item => !item.translation)) {
          const enriched = await Affixes.enrichRelatedTranslations(word, rootAnalysis).catch(() => rootAnalysis);
          if (!this.isCurrent(session, word) || !enriched) return;
          this.materials = { ...this.materials, rootAnalysis: enriched };
          if (this.activeTab === 'related') this.renderPanel();
        }
        if (this.activeTab === 'related') void this.loadStructuredRoot();
      }, () => {
        if (!this.isCurrent(session, word)) return;
        this.materialStages.root = 'ready';
        this.materialStatus = this.materialStages.examples === 'ready' ? 'ready' : 'partial';
        this.renderPanel();
      }),
      ExamCorpus.lookupAll(word).then(examCorpus => {
        if (!this.isCurrent(session, word)) return;
        this.materialStages.exam = 'ready';
        this.definition = { ...this.definition, examCorpus };
        const examTarget = this.overlay?.querySelector('[data-word-study-exam-corpus]');
        if (examTarget) {
          examTarget.innerHTML = renderExamCorpusDetail(selectExamCorpusPresentation(examCorpus, targetTrack), esc)
            || '<p class="word-study-info-empty">当前没有可显示的考试频度记录。</p>';
        }
      }, () => {
        if (this.isCurrent(session, word)) this.materialStages.exam = 'ready';
      })
    ];
    await Promise.allSettled(tasks);
    if (this.isCurrent(session, word)) {
      this.materialStatus = 'ready';
      this.renderPanel();
    }
  },

  isCurrent(session, word = this.definition?.word) {
    return this.session === session
      && this.overlay?.style.display !== 'none'
      && this.definition?.word === word;
  },

  selectTab(tab) {
    if (!isWordStudyTab(tab)) return;
    this.activeTab = tab;
    this.examplesExpanded = false;
    const panel = this.overlay?.querySelector('.word-study-detail-panel');
    if (panel) panel.scrollTop = 0;
    this.renderPanel();
    if (tab === 'phrases' && this.phrases.status === 'idle') void this.loadPhrases();
    if (tab === 'similar' && this.similar.status === 'idle') void this.loadSimilar();
    if (tab === 'related') void this.loadStructuredRoot();
  },

  async loadStructuredRoot() {
    const word = this.definition?.word;
    const analysis = this.materials.rootAnalysis;
    if (!word || !analysis || Affixes.hasStructuredRoot(analysis)) return;
    this.rootController?.abort();
    const controller = new AbortController();
    const session = this.session;
    this.rootController = controller;
    try {
      const enriched = await Affixes.ensureStructuredRoot(word, analysis, { signal: controller.signal });
      if (!this.isCurrent(session, word) || controller.signal.aborted || !enriched) return;
      this.materials = { ...this.materials, rootAnalysis: enriched };
      this.renderPanel();
    } catch {
      // The original cached analysis remains useful when enrichment is unavailable.
    } finally {
      if (this.rootController === controller) this.rootController = null;
    }
  },

  async loadPhrases() {
    const word = this.definition?.word;
    if (!word) return;
    this.phraseController?.abort();
    const controller = new AbortController();
    const session = this.session;
    this.phraseController = controller;
    this.phrases = { status: 'loading', items: [] };
    this.renderPanel();
    try {
      const items = await WordPhrases.get(word, { signal: controller.signal });
      if (!this.isCurrent(session, word) || controller.signal.aborted) return;
      this.phrases = { status: 'ready', items };
      this.renderPanel();
    } catch (error) {
      if (!this.isCurrent(session, word) || error?.name === 'AbortError') return;
      this.phrases = { status: 'error', items: [] };
      this.renderPanel();
    } finally {
      if (this.phraseController === controller) this.phraseController = null;
    }
  },

  async loadSimilar() {
    const word = this.definition?.word;
    if (!word) return;
    this.similarController?.abort();
    const controller = new AbortController();
    const session = this.session;
    this.similarController = controller;
    this.similar = { status: 'loading', items: [] };
    this.renderPanel();
    try {
      const items = await WordSimilar.get(word, { signal: controller.signal });
      if (!this.isCurrent(session, word) || controller.signal.aborted) return;
      this.similar = { status: 'ready', items };
      this.renderPanel();
    } catch (error) {
      if (!this.isCurrent(session, word) || error?.name === 'AbortError') return;
      this.similar = { status: 'error', items: [] };
      this.renderPanel();
    } finally {
      if (this.similarController === controller) this.similarController = null;
    }
  },

  async translateExample(index, button) {
    const example = normalizeWordStudyExample(this.materials.examples?.[index]);
    const item = button.closest('.word-study-example-item');
    const target = item?.querySelector(`[data-example-translation="${index}"]`);
    if (!example?.sentenceEn || !target) return;
    if (target.textContent) {
      target.textContent = '';
      button.textContent = '译';
      return;
    }
    button.disabled = true;
    button.textContent = '…';
    try {
      const translation = example.translationZh || await API.translateSentence(example.sentenceEn);
      if (!button.isConnected || !target.isConnected) return;
      target.textContent = translation || '暂时无法翻译';
      button.textContent = '收';
    } catch {
      if (button.isConnected) button.textContent = '译';
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  },

  selectExample(index) {
    const total = getFocusedWordStudyExamples(this.materials.examples).length;
    if (!total) return;
    const next = Math.min(Math.max(0, index), total - 1);
    if (next === this.exampleIndex) return;
    this.exampleIndex = next;
    this.renderPanel();
  },

  openStudyInfo() {
    const info = this.overlay?.querySelector('[data-study-info-overlay]');
    if (!info) return;
    info.hidden = false;
    this.overlay?.querySelector('[data-study-info-open]')?.setAttribute('aria-expanded', 'true');
    document.body.classList.add('word-study-detail-info-open');
    info.querySelector('[data-study-info-close]')?.focus();
  },

  closeStudyInfo({ restoreFocus = true } = {}) {
    const info = this.overlay?.querySelector('[data-study-info-overlay]');
    info?.setAttribute('hidden', '');
    this.overlay?.querySelector('[data-study-info-open]')?.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('word-study-detail-info-open');
    if (restoreFocus) this.overlay?.querySelector('[data-study-info-open]')?.focus();
  },

  handleExamplePointerDown(event) {
    const target = event.target instanceof Element ? event.target : null;
    const carousel = target?.closest('[data-example-carousel]');
    if (!carousel || this.activeTab !== 'examples' || this.examplesExpanded) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (target.closest('button, a, input, textarea, select, [role="button"]')) return;
    this._exampleGesture = {
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId
    };
    this._exampleGestureMoved = false;
    carousel.setPointerCapture?.(event.pointerId);
  },

  handleExamplePointerUp(event) {
    const gesture = this._exampleGesture;
    this._exampleGesture = null;
    if (!gesture || (gesture.pointerId != null && event.pointerId != null && gesture.pointerId !== event.pointerId)) return;
    const direction = getHorizontalSwipeDirection({
      startX: gesture.startX,
      startY: gesture.startY,
      endX: event.clientX,
      endY: event.clientY
    });
    if (!direction) return;
    this._exampleGestureMoved = true;
    event.preventDefault();
    event.stopPropagation();
    this.selectExample(this.exampleIndex + (direction === 'next' ? 1 : -1));
  },

  handleClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (this._exampleGestureMoved) {
      this._exampleGestureMoved = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (target === this.overlay || target.closest('.word-study-close')) {
      event.preventDefault();
      this.close();
      return;
    }
    if (target.closest('[data-study-info-open]')) {
      event.preventDefault();
      this.openStudyInfo();
      return;
    }
    if (target.closest('[data-study-info-close]')) {
      event.preventDefault();
      this.closeStudyInfo();
      return;
    }
    const tab = target.closest('[data-study-tab]')?.getAttribute('data-study-tab');
    if (tab) {
      event.preventDefault();
      this.selectTab(tab);
      return;
    }
    const exampleIndex = target.closest('[data-example-select]')?.getAttribute('data-example-select');
    if (exampleIndex != null) {
      event.preventDefault();
      this.selectExample(Number.parseInt(exampleIndex, 10));
      return;
    }
    if (target.closest('[data-example-show-all]')) {
      event.preventDefault();
      this.examplesExpanded = true;
      this.renderPanel();
      return;
    }
    if (target.closest('[data-example-focus-one]')) {
      event.preventDefault();
      this.examplesExpanded = false;
      this.renderPanel();
      return;
    }
    const translate = target.closest('[data-example-translate]');
    if (translate) {
      event.preventDefault();
      void this.translateExample(Number.parseInt(translate.dataset.exampleTranslate, 10), translate);
      return;
    }
    if (target.closest('[data-retry-phrases]')) {
      event.preventDefault();
      void this.loadPhrases();
      return;
    }
    if (target.closest('[data-retry-similar]')) {
      event.preventDefault();
      void this.loadSimilar();
      return;
    }
    const audio = target.closest('[data-audio-word]')?.getAttribute('data-audio-word');
    if (audio) {
      event.preventDefault();
      void AudioCache.getAudio(audio).catch(() => {});
    }
  },

  bindEscape() {
    if (this._onKeydown) document.removeEventListener('keydown', this._onKeydown);
    this._onKeydown = event => {
      if (event.key === 'Escape') this.close();
      if (this.activeTab !== 'examples' || this.examplesExpanded) return;
      if (event.target instanceof HTMLElement && event.target.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        this.selectExample(this.exampleIndex + 1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        this.selectExample(this.exampleIndex - 1);
      }
    };
    document.addEventListener('keydown', this._onKeydown);
  },

  close() {
    const wasVisible = Boolean(this.overlay && this.overlay.style.display !== 'none');
    this.session += 1;
    this.phraseController?.abort();
    this.phraseController = null;
    this.similarController?.abort();
    this.similarController = null;
    this.rootController?.abort();
    this.rootController = null;
    this._exampleGesture = null;
    this._exampleGestureMoved = false;
    if (this._onKeydown) document.removeEventListener('keydown', this._onKeydown);
    this._onKeydown = null;
    this.closeStudyInfo({ restoreFocus: false });
    if (this.overlay) this.overlay.style.display = 'none';
    document.body?.classList.remove('word-study-detail-open');
    const fallbackFocus = document.querySelector?.('#aiResultModal #aiResultClose');
    if (wasVisible && this.previousFocus?.isConnected && this.previousFocus.offsetParent !== null) this.previousFocus.focus();
    else if (wasVisible && fallbackFocus instanceof HTMLElement) fallbackFocus.focus();
    this.previousFocus = null;
    return Boolean(wasVisible);
  }
};

window.WordStudyDetail = WordStudyDetail;
