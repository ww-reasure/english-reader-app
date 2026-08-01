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
  materials: { examples: [], rootAnalysis: null },
  phrases: { status: 'idle', items: [] },
  similar: { status: 'idle', items: [] },
  phraseController: null,
  similarController: null,
  rootController: null,
  exampleIndex: 0,
  examplesExpanded: false,
  previousFocus: null,
  _onKeydown: null,

  ensureOverlay() {
    if (this.overlay?.isConnected) return this.overlay;
    const overlay = document.createElement('div');
    overlay.id = 'wordStudyDetailOverlay';
    overlay.className = 'modal-overlay word-study-detail-overlay';
    overlay.style.display = 'none';
    overlay.addEventListener('click', event => this.handleClick(event));
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
    this.materialStatus = 'loading';
    this.materials = { examples: [], rootAnalysis: null };
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
    return `
      <section class="word-study-detail-sheet word-study-detail-sheet--stage" role="dialog" aria-modal="true" aria-labelledby="wordStudyDetailTitle">
        <header class="flashcard-study-head flashcard-study-masthead word-study-detail-masthead">
          <button class="word-study-close" type="button" aria-label="关闭单词学习详情" title="关闭"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
          <button id="wordStudyDetailTitle" class="flashcard-study-word" type="button" data-audio-word="${esc(word)}" title="播放发音">${esc(word)}</button>
          ${phonetic ? `<button class="flashcard-study-phonetic" type="button" data-audio-word="${esc(word)}" title="播放发音">${esc(phonetic)}</button>` : ''}
          ${renderContextualSense(this.definition)}
          <div class="flashcard-study-definition-list">${definitionLines.length
            ? definitionLines.map(line => renderWordStudyDefinitionLine(line)).join('')
            : '<div class="flashcard-study-translation">暂无可靠中文释义</div>'}</div>
          <button class="flashcard-study-info-trigger" type="button" data-study-info-open aria-haspopup="dialog">
            <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
            <span>词汇信息</span>
          </button>
        </header>
        <nav class="flashcard-study-tabs" role="tablist" aria-label="学习资料">${renderWordStudyTabs(this.activeTab)}</nav>
        <div class="flashcard-study-panel word-study-detail-panel" role="tabpanel">${this.renderPanelContent()}</div>
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
            <div data-word-study-exam-corpus>${renderExamCorpusDetail(examPresentation, esc)}</div>
            ${status ? `<div class="word-study-detail-info-row"><span>学习状态</span><strong>${esc(status.icon || '')} ${esc(status.label || '')}</strong></div>` : ''}
            ${this.sourceMeta?.schedule ? `<div class="word-study-detail-info-row"><span>复习间隔</span><strong>${esc(this.sourceMeta.schedule)}</strong></div>` : ''}
            ${this.sourceMeta?.contextSentence ? `<blockquote class="word-study-context">${esc(this.sourceMeta.contextSentence)}</blockquote>` : ''}
          </section>
        </div>
      </section>`;
  },

  renderPanelContent() {
    if (this.activeTab !== 'phrases' && this.materialStatus === 'loading') {
      return '<div class="flashcard-study-loading">正在整理学习资料…</div>';
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
      panel.innerHTML = this.renderPanelContent();
      panel.scrollTop = 0;
    }
    this.overlay.querySelectorAll('[data-study-tab]').forEach(button => {
      const active = button.dataset.studyTab === this.activeTab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
  },

  async loadMaterials(session, word) {
    const targetTrack = this.sourceMeta?.targetTrack || Config.get('exam_level') || '';
    const [examExamples, examples, rootAnalysis, examCorpus] = await Promise.all([
      ExamCorpus.getExamples(word, targetTrack).catch(() => []),
      Examples.getExamples(word).catch(() => []),
      Affixes.getAnalysis(word).catch(() => null),
      ExamCorpus.lookupAll(word).catch(() => ({}))
    ]);
    if (!this.isCurrent(session, word)) return;

    this.materialStatus = 'ready';
    this.definition = { ...this.definition, examCorpus };
    this.materials = { examples: mergeWordStudyExamples(examExamples, examples), rootAnalysis };
    const examTarget = this.overlay?.querySelector('[data-word-study-exam-corpus]');
    if (examTarget) examTarget.innerHTML = renderExamCorpusDetail(selectExamCorpusPresentation(examCorpus, targetTrack), esc);
    this.renderPanel();

    if (rootAnalysis && Affixes.getRelatedWordDetails(rootAnalysis).some(item => !item.translation)) {
      const enriched = await Affixes.enrichRelatedTranslations(word, rootAnalysis).catch(() => rootAnalysis);
      if (!this.isCurrent(session, word) || !enriched) return;
      this.materials = { ...this.materials, rootAnalysis: enriched };
      if (this.activeTab === 'related') this.renderPanel();
    }
    if (this.activeTab === 'related') void this.loadStructuredRoot();
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
    document.body.classList.add('word-study-detail-info-open');
    info.querySelector('[data-study-info-close]')?.focus();
  },

  closeStudyInfo() {
    this.overlay?.querySelector('[data-study-info-overlay]')?.setAttribute('hidden', '');
    document.body.classList.remove('word-study-detail-info-open');
  },

  handleClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
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
    if (this._onKeydown) document.removeEventListener('keydown', this._onKeydown);
    this._onKeydown = null;
    this.closeStudyInfo();
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
