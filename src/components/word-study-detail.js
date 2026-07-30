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

function renderDefinitionLines(definition) {
  const lines = getDefinitionDisplayLines(definition);
  if (!lines.length) return '<div class="word-study-definition-empty">暂无可靠中文释义</div>';
  return lines.map(line => `
    <div class="word-study-definition definition-line">
      <span class="definition-pos">${esc(line.label)}</span><span>${esc(line.glossZh)}</span>
    </div>`).join('');
}

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
    this.session += 1;
    const session = this.session;
    this.activeTab = 'examples';
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
    const status = this.sourceMeta?.status;
    const eyebrow = this.sourceMeta?.eyebrow || 'WORD NOTE';
    const targetTrack = this.sourceMeta?.targetTrack || Config.get('exam_level') || '';
    const examPresentation = selectExamCorpusPresentation(this.definition?.examCorpus, targetTrack);
    return `
      <section class="word-study-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="wordStudyDetailTitle">
        <header class="word-study-detail-head">
          <div class="word-study-dossier-cover">
            <div class="word-study-detail-topline">
              <p class="page-eyebrow">${esc(eyebrow)}</p>
              <button class="word-study-close" type="button" aria-label="关闭单词学习详情" title="关闭"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
            </div>
            <div class="word-study-title-row">
              <button id="wordStudyDetailTitle" class="word-study-title" type="button" data-audio-word="${esc(word)}" title="播放发音">${esc(word)}</button>
              ${status ? `<span class="word-status-mark" style="--status-color:${esc(status.color || 'var(--moss)')}">${esc(status.icon || '')} ${esc(status.label || '')}</span>` : ''}
            </div>
            ${phonetic ? `<button class="word-study-phonetic" type="button" data-audio-word="${esc(word)}" title="播放发音">${esc(phonetic)}</button>` : ''}
          </div>
          <div class="word-study-definition-band">
            ${renderContextualSense(this.definition)}
            <div class="word-study-definition-list">${renderDefinitionLines(this.definition)}</div>
            <div data-word-study-exam-corpus>${renderExamCorpusDetail(examPresentation, esc)}</div>
          </div>
          ${(this.sourceMeta?.schedule || this.sourceMeta?.contextSentence) ? `<div class="word-study-meta-notes">
            ${this.sourceMeta?.schedule ? `<p class="word-study-schedule">${esc(this.sourceMeta.schedule)}</p>` : ''}
            ${this.sourceMeta?.contextSentence ? `<blockquote class="word-study-context">${esc(this.sourceMeta.contextSentence)}</blockquote>` : ''}
          </div>` : ''}
        </header>
        <div class="word-study-panel" role="tabpanel">${this.renderPanelContent()}</div>
        <nav class="word-study-tabs" role="tablist" aria-label="单词学习资料">${renderWordStudyTabs(this.activeTab)}</nav>
      </section>`;
  },

  renderPanelContent() {
    if (this.activeTab !== 'phrases' && this.materialStatus === 'loading') {
      return '<div class="word-study-loading flashcard-study-loading">正在整理学习资料…</div>';
    }
    return renderWordStudyPanel({
      activeTab: this.activeTab,
      examples: this.materials.examples,
      rootAnalysis: this.materials.rootAnalysis,
      phrases: this.phrases,
      similar: this.similar
    });
  },

  renderPanel() {
    if (!this.overlay || this.overlay.style.display === 'none') return;
    const panel = this.overlay.querySelector('.word-study-panel');
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
    if (examTarget) {
      examTarget.innerHTML = renderExamCorpusDetail(selectExamCorpusPresentation(examCorpus, targetTrack), esc);
    }
    this.renderPanel();

    if (rootAnalysis && Affixes.getRelatedWordDetails(rootAnalysis).some(item => !item.translation)) {
      const enriched = await Affixes.enrichRelatedTranslations(word, rootAnalysis).catch(() => rootAnalysis);
      if (!this.isCurrent(session, word) || !enriched) return;
      this.materials = { ...this.materials, rootAnalysis: enriched };
      if (this.activeTab === 'related') this.renderPanel();
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
    this.renderPanel();
    if (tab === 'phrases' && this.phrases.status === 'idle') void this.loadPhrases();
    if (tab === 'similar' && this.similar.status === 'idle') void this.loadSimilar();
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

  handleClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target === this.overlay || target.closest('.word-study-close')) {
      event.preventDefault();
      this.close();
      return;
    }
    const tab = target.closest('[data-study-tab]')?.getAttribute('data-study-tab');
    if (tab) {
      event.preventDefault();
      this.selectTab(tab);
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
    if (this._onKeydown) document.removeEventListener('keydown', this._onKeydown);
    this._onKeydown = null;
    if (this.overlay) this.overlay.style.display = 'none';
    document.body?.classList.remove('word-study-detail-open');
    if (wasVisible && this.previousFocus?.isConnected) this.previousFocus.focus();
    this.previousFocus = null;
    return Boolean(wasVisible);
  }
};

window.WordStudyDetail = WordStudyDetail;
