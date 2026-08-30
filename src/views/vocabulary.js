/**
 * Unified vocabulary library view.
 *
 * The page renders one canonical learnWords row per active word. Reading
 * contexts are projected into savedContexts; source actions therefore change
 * source metadata without creating a second learning identity.
 */

import { DB } from '../db.js';
import { Dictionary } from '../dictionary.js';
import { esc, escAttr } from '../helpers.js';
import { formatPhonetic, getDefinitionDisplayLines, getSavableTranslation } from '../components/definition-trust.mjs';
import { ensureSavedWordDefinition } from '../components/saved-word-definition.mjs';
import { WordStudyDetail } from '../components/word-study-detail.js';
import { SpacedRepetition } from '../spaced-repetition.js';
import { selectUnifiedVocabulary } from '../vocabulary-library.mjs';
import {
  clearPracticeScopeDone,
  createPracticeSession,
  getPracticeProgress,
  getPracticeProgressBatch,
  getPracticeScopeStatus,
  resolvePracticeScope
} from '../review-practice.mjs';
import { createVocabularyWindow } from '../vocabulary-window.mjs';

const SOURCE_FILTERS = Object.freeze(['all', 'reading', 'import']);
const STATUS_FILTERS = Object.freeze(['all', 'new', 'learning', 'review', 'stable']);
const SORT_MODES = Object.freeze(['recent', 'alpha', 'due']);

function diagnosticLogger() {
  return globalThis.__englishReaderDiagnosticLogger || null;
}

function renderDefinitionPreview(word) {
  const primary = getDefinitionDisplayLines(word)[0];
  return primary ? `${primary.label} ${primary.glossZh}` : getSavableTranslation(word) || '待重新查询';
}

function sourceKeysOf(row) {
  if (Array.isArray(row?.sourceKeys)) return row.sourceKeys;
  return ['reading', 'import'].filter(source => row?.librarySources?.[source]?.active === true);
}

function sourceLabelOf(row) {
  if (row?.sourceLabel) return row.sourceLabel;
  const sources = sourceKeysOf(row);
  if (sources.length === 2) return '收藏·导入';
  if (sources[0] === 'reading') return '收藏';
  if (sources[0] === 'import') return '导入';
  return '';
}

function statusDisplayOf(word) {
  const status = SpacedRepetition.getStatusDisplay(word);
  return word?.isDue ? '待复习' : status.label;
}

export const VocabularyView = {
  container: null,
  rows: [],
  sourceFilter: 'all',
  statusFilter: 'all',
  sortMode: 'recent',
  searchQuery: '',
  manageMode: false,
  selectionMode: false,
  filterOpen: false,
  actionsMenuOpen: false,
  selectedWordIds: new Set(),
  practiceSummary: null,
  filteredRows: [],
  _preloadedSnapshot: null,
  _libraryChangedHandler: null,
  _documentClickHandler: null,
  _documentKeydownHandler: null,
  _scrollHandler: null,
  _scrollFrame: null,

  async preloadData() {
    this._preloadedSnapshot = await DB.getUnifiedVocabularySnapshot();
    return this._preloadedSnapshot;
  },

  async render(container) {
    this.container = container;
    const span = diagnosticLogger()?.beginSpan('vocab.render', {
      category: 'vocabulary',
      payload: { sourceFilter: this.sourceFilter, statusFilter: this.statusFilter }
    });
    try {
      const snapshot = this._preloadedSnapshot || await DB.getUnifiedVocabularySnapshot();
      this._preloadedSnapshot = null;
      this.rows = snapshot.data;
      this.practiceSummary = await this.loadPracticeSummary();
      this.bindLibraryEvents();
      this.bindPageEvents();
      this.renderPage();
      span?.end({ payload: { wordCount: this.rows.length } });
    } catch (error) {
      span?.end({ level: 'error', payload: { name: error?.name || 'Error' } });
      throw error;
    }
  },

  async loadPracticeSummary() {
    const now = Date.now();
    const snapshotDb = { getAllLearnWords: async () => this.rows };
    const [todayScope, recentScope] = await Promise.all([
      resolvePracticeScope({ db: snapshotDb, scope: 'today_added', now }),
      resolvePracticeScope({ db: snapshotDb, scope: 'recent_added', now })
    ]);
    const todayStatus = getPracticeScopeStatus({
      scope: 'today_added',
      currentWordIds: todayScope.words.map(word => word.id),
      now
    });
    const recentStatus = getPracticeScopeStatus({
      scope: 'recent_added',
      currentWordIds: recentScope.words.map(word => word.id),
      now
    });
    const progress = await getPracticeProgressBatch({
      db: DB,
      now,
      scopes: [
        { scope: 'today_added', wordIds: todayScope.words.map(word => word.id), legacyCompletedWordIds: todayStatus.reviewedIds },
        { scope: 'recent_added', wordIds: recentScope.words.map(word => word.id), legacyCompletedWordIds: recentStatus.reviewedIds }
      ]
    });
    return {
      todayScope,
      recentScope,
      todayStatus,
      recentStatus,
      todayProgress: progress.today_added,
      recentProgress: progress.recent_added
    };
  },

  renderPage() {
    if (!this.container) return;
    const rows = selectUnifiedVocabulary(this.rows, {
      query: this.searchQuery,
      source: this.sourceFilter,
      status: this.statusFilter,
      sort: this.sortMode
    });
    this.filteredRows = rows;
    const {
      todayScope = { skipped: 0 },
      recentScope = { skipped: 0 },
      todayStatus = { reviewedIds: [], newIds: [] },
      recentStatus = { reviewedIds: [], newIds: [] },
      todayProgress = null,
      recentProgress = null
    } = this.practiceSummary || {};
    const window = createVocabularyWindow(rows, { scrollTop: 0, viewportHeight: this.container.clientHeight || 720 });
    const dueCount = SpacedRepetition.getDueCount(this.rows);
    const totalCount = this.rows.length;
    const hasFilters = this.sourceFilter !== 'all' || this.statusFilter !== 'all' || this.sortMode !== 'recent';

    this.container.innerHTML = `
      <section class="app-standard-page vocab-container vocab-unified-page" aria-labelledby="vocabularyContentTitle">
        <header class="vocab-unified-header">
          <div class="vocab-unified-header-copy">
            <h1 id="vocabularyContentTitle" class="vocab-unified-heading">全部单词</h1>
            <p class="vocab-unified-count">共 ${totalCount} 个单词</p>
          </div>
          <div class="vocab-unified-header-actions">
            <button type="button" class="btn vocab-unified-import" aria-label="导入单词" onclick="WordImport.showModal()">
              <i class="fa-solid fa-arrow-up-from-bracket vocab-unified-upload-icon" aria-hidden="true"></i><span>导入</span>
            </button>
            <div class="vocab-unified-more">
              <button id="vocabUnifiedMoreTrigger" type="button" class="vocab-unified-more-trigger" aria-label="更多词汇操作" aria-controls="vocabUnifiedActionsMenu" aria-expanded="${this.actionsMenuOpen}" onclick="VocabularyView.toggleActionsMenu()">
                <i class="fa-solid fa-ellipsis" aria-hidden="true"></i>
              </button>
              <div id="vocabUnifiedActionsMenu" class="vocab-unified-actions-menu" role="menu" ${this.actionsMenuOpen ? '' : 'hidden'}>
                <button type="button" role="menuitem" onclick="VocabularyView.chooseAction('selection')"><i class="fa-regular fa-square-check" aria-hidden="true"></i><span>选词复习</span></button>
                <button type="button" role="menuitem" onclick="VocabularyView.chooseAction('manage')"><i class="fa-solid fa-sliders" aria-hidden="true"></i><span>管理单词</span></button>
              </div>
            </div>
          </div>
        </header>

        <div class="vocab-unified-toolbar" role="search">
          <label class="vocab-unified-search">
            <i class="fa-solid fa-magnifying-glass vocab-unified-search-icon" aria-hidden="true"></i>
            <span class="sr-only">搜索单词或释义</span>
            <input type="search" value="${escAttr(this.searchQuery)}" placeholder="搜索单词或释义" aria-label="搜索单词或释义" oninput="VocabularyView.setSearchQuery(this.value)">
          </label>
          <button type="button" class="btn vocab-unified-filter-toggle ${hasFilters ? 'has-active-filter' : ''}" aria-label="筛选" aria-controls="vocabUnifiedFilter" aria-expanded="${this.filterOpen}" onclick="VocabularyView.toggleFilter()">
            <i class="fa-solid fa-sliders" aria-hidden="true"></i><span>筛选</span>
          </button>
        </div>

        <nav class="vocab-unified-source-tabs" aria-label="词汇来源">
          ${this.renderSourceTab('all', '全部')}
          ${this.renderSourceTab('reading', '收藏')}
          ${this.renderSourceTab('import', '导入')}
        </nav>

        <section id="vocabUnifiedFilter" class="vocab-unified-filter" aria-label="筛选与排序" ${this.filterOpen ? '' : 'hidden'}>
          <div class="vocab-unified-filter-group">
            <span class="vocab-unified-filter-label">学习状态</span>
            <div class="vocab-unified-filter-options">${this.renderStatusFilter()}</div>
          </div>
          <div class="vocab-unified-filter-group">
            <span class="vocab-unified-filter-label">排序方式</span>
            <div class="vocab-unified-filter-options">${this.renderSortMode()}</div>
          </div>
        </section>

        <section class="vocab-unified-today-card" aria-label="词汇复习入口">
          ${this.renderTodayPractice(todayStatus, todayScope.skipped, todayProgress)}
          <div class="vocab-unified-review-row">
            <div><span>计划复习</span><strong>${dueCount} 词</strong></div>
            <a class="vocab-unified-review-link" href="#/flashcard">开始计划复习<i class="fa-solid fa-chevron-right" aria-hidden="true"></i></a>
          </div>
          <div class="vocab-unified-review-row vocab-unified-review-row--secondary">
            ${this.renderRecentPractice(recentStatus, recentScope.skipped, recentProgress)}
            <button type="button" class="vocab-unified-review-link" onclick="VocabularyView.toggleSelection()"><i class="fa-regular fa-bookmark" aria-hidden="true"></i>自选单词<i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
          </div>
        </section>

        ${this.renderManagementBar(rows)}
        <div class="vocab-unified-list vocab-list" data-vocab-grid="vocab">
          ${this.renderWindowHtml(window)}
        </div>
      </section>`;
    this.bindWindowEvents();
    diagnosticLogger()?.record('vocab.rendered', {
      category: 'vocabulary',
      payload: { totalCount, visibleCount: rows.length, sourceFilter: this.sourceFilter, statusFilter: this.statusFilter }
    });
  },

  renderWindowHtml(window) {
    if (!window.totalCount) return '<div class="empty-state vocab-unified-empty">没有符合条件的词汇。</div>';
    return `<div class="vocab-window-spacer" style="height:${window.topSpacer}px" aria-hidden="true"></div>${window.rows.map(row => this.renderRow(row)).join('')}<div class="vocab-window-spacer" style="height:${window.bottomSpacer}px" aria-hidden="true"></div>`;
  },

  renderWordWindow({ reset = false } = {}) {
    const list = this.container?.querySelector?.('[data-vocab-grid="vocab"]');
    if (!list) return;
    const scrollTarget = this.container;
    const relativeTop = reset ? 0 : Math.max(0, Number(scrollTarget.scrollTop || 0) - Number(list.offsetTop || 0));
    const window = createVocabularyWindow(this.filteredRows, {
      scrollTop: relativeTop,
      viewportHeight: scrollTarget.clientHeight || 720
    });
    list.innerHTML = this.renderWindowHtml(window);
    const count = this.container.querySelector?.('.vocab-unified-count');
    if (count) count.textContent = `共 ${this.rows.length} 个单词${this.filteredRows.length !== this.rows.length ? ` · 当前 ${this.filteredRows.length} 个` : ''}`;
  },

  bindWindowEvents() {
    if (this._scrollHandler) this.container?.removeEventListener?.('scroll', this._scrollHandler);
    this._scrollHandler = () => {
      if (this._scrollFrame) return;
      const schedule = globalThis.requestAnimationFrame || (callback => globalThis.setTimeout(callback, 0));
      this._scrollFrame = schedule(() => {
        this._scrollFrame = null;
        this.renderWordWindow();
      });
    };
    this.container?.addEventListener?.('scroll', this._scrollHandler, { passive: true });
  },

  renderSourceTab(value, label) {
    return `<button type="button" class="vocab-unified-source-tab ${this.sourceFilter === value ? 'is-active' : ''}" aria-pressed="${this.sourceFilter === value}" onclick="VocabularyView.setSourceFilter('${value}')">${label}</button>`;
  },

  renderStatusFilter() {
    const labels = { all: '全部', new: '新词', learning: '学习中', review: '待复习', stable: '长期巩固' };
    return STATUS_FILTERS.map(value => `<button type="button" class="vocab-unified-filter-chip ${this.statusFilter === value ? 'is-active' : ''}" aria-pressed="${this.statusFilter === value}" onclick="VocabularyView.setStatusFilter('${value}')">${labels[value]}</button>`).join('');
  },

  renderSortMode() {
    const labels = { recent: '最近加入', alpha: 'A–Z', due: '待复习优先' };
    return SORT_MODES.map(value => `<button type="button" class="vocab-unified-filter-chip ${this.sortMode === value ? 'is-active' : ''}" aria-pressed="${this.sortMode === value}" onclick="VocabularyView.setSortMode('${value}')">${labels[value]}</button>`).join('');
  },

  renderTodayPractice(status, skipped = 0, progress = null) {
    const reviewedCount = status.reviewedIds.length;
    const newCount = status.newIds.length;
    const totalCount = Number(progress?.totalCount) || reviewedCount + newCount;
    const completedCount = Math.min(totalCount, Math.max(0, Number(progress?.completedCount) || (status.done ? totalCount : 0)));
    const done = Boolean(status.done || progress?.done);
    const buttonLabel = completedCount > 0 && completedCount < totalCount ? '继续今日' : (done ? '再练今日' : '只练今日');
    const action = done
      ? "VocabularyView.startPractice('today_added', { reviewAll: true })"
      : "VocabularyView.startPractice('today_added')";
    return `<div class="vocab-unified-today-primary">
      <div class="vocab-unified-today-icon" aria-hidden="true"><i class="fa-solid fa-seedling"></i></div>
      <div class="vocab-unified-today-copy">
        <span>今日新增</span>
        <strong>${completedCount}/${totalCount} 词</strong>
        <small>${done || (completedCount >= totalCount && totalCount > 0) ? '今天这组已经完成' : (completedCount > 0 ? `已完成 ${completedCount} 个，继续保持` : '新词优先，记得更牢')}${skipped ? ` · ${skipped} 个不可用` : ''}</small>
      </div>
      <button type="button" class="vocab-unified-today-button" onclick="${action}" ${totalCount ? '' : 'disabled'}>${buttonLabel}</button>
    </div>`;
  },

  renderRecentPractice(status, skipped = 0, progress = null) {
    const reviewedCount = status.reviewedIds.length;
    const newCount = status.newIds.length;
    const totalCount = Number(progress?.totalCount) || reviewedCount + newCount;
    const completedCount = Math.min(totalCount, Math.max(0, Number(progress?.completedCount) || (status.done ? totalCount : 0)));
    const done = Boolean(status.done || progress?.done);
    const action = done
      ? "VocabularyView.startPractice('recent_added', { reviewAll: true })"
      : "VocabularyView.startPractice('recent_added')";
    return `<button type="button" class="vocab-unified-recent-link" onclick="${action}" ${totalCount ? '' : 'disabled'}>
      <i class="fa-regular fa-calendar" aria-hidden="true"></i><span>最近 7 天</span><strong>${completedCount}/${totalCount} 词</strong>${skipped ? `<small>${skipped} 个不可用</small>` : ''}<i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
    </button>`;
  },

  renderManagementBar(visibleRows = this.rows) {
    if (this.manageMode) {
      const activeIds = visibleRows.map(row => row.id);
      return `<div class="vocab-unified-management" role="region" aria-label="词汇管理">
        <span>管理 ${activeIds.length} 个当前单词</span>
        <button type="button" class="btn btn-danger btn-sm" onclick="VocabularyView.archiveWords(${escAttr(JSON.stringify(activeIds))})">全部移出</button>
        <button type="button" class="btn btn-outline btn-sm" onclick="VocabularyView.toggleManage()">完成</button>
      </div>`;
    }
    if (this.selectionMode) {
      return `<div class="vocab-unified-management" role="region" aria-label="专项复习选词">
        <span class="vocab-unified-selection-count">已选择 ${this.selectedWordIds.size} 个单词</span>
        <button type="button" class="btn btn-primary btn-sm vocab-practice-start-btn" onclick="VocabularyView.startManualPractice()">开始复习（${this.selectedWordIds.size}）</button>
        <button type="button" class="btn btn-outline btn-sm" onclick="VocabularyView.toggleSelection()">取消</button>
      </div>`;
    }
    return '';
  },

  renderRow(row) {
    const id = Number(row.id);
    const sourceKeys = sourceKeysOf(row);
    const readingActive = sourceKeys.includes('reading');
    const checked = this.selectedWordIds.has(id) ? 'checked' : '';
    const status = statusDisplayOf(row);
    const selection = this.selectionMode
      ? `<label class="vocab-unified-select" title="选择 ${escAttr(row.word)}">
          <input type="checkbox" data-practice-word="${id}" ${checked} aria-label="选择 ${escAttr(row.word)}" onchange="VocabularyView.toggleSelectedWord(${id}, this.checked)">
        </label>`
      : '';
    const management = this.manageMode
      ? `<div class="vocab-unified-row-actions">
          ${readingActive ? `<button type="button" class="btn btn-outline btn-sm" onclick="event.stopPropagation(); VocabularyView.removeReadingSource(${id})">取消收藏</button>` : ''}
          <button type="button" class="btn btn-danger btn-sm" onclick="event.stopPropagation(); VocabularyView.archiveWords([${id}])">移出词库</button>
        </div>`
      : '';
    return `<article class="vocab-unified-row ${this.manageMode ? 'is-managing' : ''} ${this.selectionMode ? 'is-selecting' : ''}" id="vocab-${id}" data-vocab-row="${id}">
      ${selection}
      <div class="vocab-unified-row-main">
        <div class="vocab-unified-word-line">
          <strong class="vocab-unified-word">${esc(row.word)}</strong>
        </div>
        <div class="vocab-unified-phonetic-line">
          ${formatPhonetic(row.phonetic) ? `<span class="vocab-unified-phonetic">${esc(formatPhonetic(row.phonetic))}</span>` : ''}
          <button type="button" class="vocab-unified-audio" data-word="${escAttr(row.word)}" aria-label="播放 ${escAttr(row.word)} 发音" onclick="event.stopPropagation(); VocabularyView.speakWord(this.dataset.word)">
            <i class="fa-solid fa-volume-high" aria-hidden="true"></i>
          </button>
        </div>
        <div class="vocab-unified-definition vocab-translation">${esc(renderDefinitionPreview(row))}</div>
        <span class="vocab-unified-status sr-only">学习状态：${esc(status)}</span>
      </div>
      <div class="vocab-unified-row-tail">
        <span class="vocab-unified-source vocab-unified-source--${sourceKeys.join('-') || 'none'}">${esc(sourceLabelOf(row))}</span>
        <div class="vocab-unified-row-tail-actions">
          ${management}
          <button type="button" class="vocab-unified-detail" aria-label="查看 ${escAttr(row.word)} 学习详情" onclick="VocabularyView.showWordDetail(${id})">
            <i class="fa-solid fa-chevron-right" aria-hidden="true"></i><span class="sr-only">详情</span>
          </button>
        </div>
      </div>
    </article>`;
  },

  renderPracticeEntry({ scope, name, status, skipped = 0 }) {
    const reviewedCount = status.reviewedIds.length;
    const newCount = status.newIds.length;
    const totalCount = reviewedCount + newCount;
    const skippedLabel = skipped > 0
      ? `<span class="vocab-practice-entry-meta">${skipped} 个已归档或不可用</span>`
      : '';
    if (status.done) {
      return `<div class="vocab-practice-entry vocab-practice-entry--done">
        <span class="vocab-practice-entry-name">${name}<span class="vocab-practice-done-badge">已完成</span></span>
        <span class="vocab-practice-entry-count">已完成 ${reviewedCount} 词</span>
        ${skippedLabel}
        <button type="button" class="vocab-practice-again" onclick="VocabularyView.startPractice('${scope}', { reviewAll: true })">再练一轮</button>
      </div>`;
    }
    const countLabel = status.hasCompletion && newCount > 0 ? `新增 ${newCount} 词` : `${totalCount} 词`;
    const priorLabel = status.hasCompletion && reviewedCount > 0
      ? `<span class="vocab-practice-entry-meta">此前已完成 ${reviewedCount} 词</span>`
      : '';
    return `<button type="button" class="vocab-practice-entry" onclick="VocabularyView.startPractice('${scope}')" ${totalCount ? '' : 'disabled'}>
      <span class="vocab-practice-entry-name">${name}</span>
      <span class="vocab-practice-entry-count">${countLabel}</span>${priorLabel}${skippedLabel}
    </button>`;
  },

  bindLibraryEvents() {
    if (this._libraryChangedHandler) document.removeEventListener('word-library-changed', this._libraryChangedHandler);
    this._libraryChangedHandler = () => {
      if (globalThis.location?.hash === '#/vocab' && this.container?.isConnected) void this.render(this.container);
    };
    document.addEventListener('word-library-changed', this._libraryChangedHandler);
  },

  bindPageEvents() {
    if (this._documentClickHandler) document.removeEventListener('click', this._documentClickHandler);
    if (this._documentKeydownHandler) document.removeEventListener('keydown', this._documentKeydownHandler);
    this._documentClickHandler = event => {
      if (!this.actionsMenuOpen || event.target.closest('.vocab-unified-more')) return;
      void this.closeActionsMenu();
    };
    this._documentKeydownHandler = event => {
      if (event.key !== 'Escape' || !this.actionsMenuOpen) return;
      event.preventDefault();
      void this.closeActionsMenu({ focusTrigger: true });
    };
    document.addEventListener('click', this._documentClickHandler);
    document.addEventListener('keydown', this._documentKeydownHandler);
  },

  async cleanup() {
    if (this._libraryChangedHandler) document.removeEventListener('word-library-changed', this._libraryChangedHandler);
    if (this._documentClickHandler) document.removeEventListener('click', this._documentClickHandler);
    if (this._documentKeydownHandler) document.removeEventListener('keydown', this._documentKeydownHandler);
    if (this._scrollHandler) this.container?.removeEventListener?.('scroll', this._scrollHandler);
    if (this._scrollFrame && typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(this._scrollFrame);
    this._libraryChangedHandler = null;
    this._documentClickHandler = null;
    this._documentKeydownHandler = null;
    this._scrollHandler = null;
    this._scrollFrame = null;
    this.actionsMenuOpen = false;
    this.container = null;
  },

  deactivate() {
    if (this._documentClickHandler) document.removeEventListener('click', this._documentClickHandler);
    if (this._documentKeydownHandler) document.removeEventListener('keydown', this._documentKeydownHandler);
    if (this._scrollHandler) this.container?.removeEventListener?.('scroll', this._scrollHandler);
  },

  activate() {
    this.bindPageEvents();
    this.bindWindowEvents();
    this.renderWordWindow();
  },

  dispose() {
    return this.cleanup();
  },

  async setSourceFilter(value) {
    this.sourceFilter = SOURCE_FILTERS.includes(value) ? value : 'all';
    await this.renderPage();
  },

  async setStatusFilter(value) {
    this.statusFilter = STATUS_FILTERS.includes(value) ? value : 'all';
    await this.renderPage();
  },

  async setSortMode(value) {
    this.sortMode = SORT_MODES.includes(value) ? value : 'recent';
    await this.renderPage();
  },

  setSearchQuery(value) {
    this.searchQuery = String(value || '');
    this.filteredRows = selectUnifiedVocabulary(this.rows, {
      query: this.searchQuery,
      source: this.sourceFilter,
      status: this.statusFilter,
      sort: this.sortMode
    });
    this.renderWordWindow({ reset: true });
  },

  speakWord(word) {
    const audio = globalThis.window?.AudioCache;
    if (audio?.getAudio && word) void audio.getAudio(word).catch(() => {});
  },

  async toggleFilter() {
    this.filterOpen = !this.filterOpen;
    await this.renderPage();
    document.querySelector('.vocab-unified-filter-chip')?.focus();
  },

  async toggleActionsMenu() {
    this.actionsMenuOpen = !this.actionsMenuOpen;
    await this.renderPage();
    if (this.actionsMenuOpen) document.querySelector('.vocab-unified-actions-menu [role="menuitem"]')?.focus();
    else document.getElementById('vocabUnifiedMoreTrigger')?.focus();
  },

  async closeActionsMenu({ focusTrigger = false } = {}) {
    if (!this.actionsMenuOpen) return;
    this.actionsMenuOpen = false;
    await this.renderPage();
    if (focusTrigger) document.getElementById('vocabUnifiedMoreTrigger')?.focus();
  },

  async chooseAction(action) {
    this.actionsMenuOpen = false;
    if (action === 'selection') await this.toggleSelection();
    else if (action === 'manage') await this.toggleManage();
  },

  async toggleManage() {
    this.actionsMenuOpen = false;
    if (this.selectionMode) this.selectionMode = false;
    this.selectedWordIds.clear();
    this.manageMode = !this.manageMode;
    await this.renderPage();
  },

  async toggleSelection() {
    this.actionsMenuOpen = false;
    if (this.manageMode) this.manageMode = false;
    this.selectionMode = !this.selectionMode;
    this.selectedWordIds.clear();
    await this.renderPage();
  },

  toggleSelectedWord(id, checked) {
    if (checked) this.selectedWordIds.add(Number(id));
    else this.selectedWordIds.delete(Number(id));
    const count = document.querySelector('.vocab-unified-selection-count');
    if (count) count.textContent = `已选择 ${this.selectedWordIds.size} 个单词`;
    const button = document.querySelector('.vocab-practice-start-btn');
    if (button) button.textContent = `开始复习（${this.selectedWordIds.size}）`;
  },

  async startPractice(scope, options = {}) {
    const now = Date.now();
    const reviewAll = Boolean(options?.reviewAll);
    const result = await resolvePracticeScope({ db: DB, scope, now });
    if (!result.words.length) {
      alert('这一组暂时没有可练习的 active 单词。');
      return;
    }
    const allWordIds = result.words.map(word => word.id);
    const status = getPracticeScopeStatus({ scope, currentWordIds: allWordIds, now });
    const progress = await getPracticeProgress({
      db: DB,
      scope,
      wordIds: allWordIds,
      now,
      legacyCompletedWordIds: status.reviewedIds
    });
    let wordIds = allWordIds;
    if (reviewAll) clearPracticeScopeDone(scope);
    else wordIds = allWordIds.filter(id => !progress.completedWordIds.includes(Number(id)));
    if (!wordIds.length) {
      alert('这一组已经完成。需要重复练习时，请点击“再练一轮”。');
      return;
    }
    createPracticeSession({ scope, wordIds, expectedWordIds: allWordIds, skipped: result.skipped, reviewAll });
    location.hash = `#/flashcard/practice/${scope}`;
  },

  async startManualPractice() {
    if (!this.selectedWordIds.size) {
      alert('请先勾选要复习的单词。');
      return;
    }
    const result = await resolvePracticeScope({ db: DB, scope: 'manual', wordIds: [...this.selectedWordIds] });
    if (!result.words.length) {
      alert('所选单词已不可用，无法开始专项复习。');
      return;
    }
    createPracticeSession({
      scope: 'manual',
      wordIds: result.words.map(word => word.id),
      expectedWordIds: result.words.map(word => word.id),
      skipped: result.skipped
    });
    this.selectionMode = false;
    this.selectedWordIds.clear();
    location.hash = '#/flashcard/practice/manual';
  },

  async removeReadingSource(id) {
    if (!confirm('确定取消收藏吗？导入来源和学习历史会保留。')) return;
    await DB.removeReadingVocabularySource(Number(id));
    await this.render(this.container);
  },

  async archiveWords(wordIds) {
    const ids = [...new Set((Array.isArray(wordIds) ? wordIds : [wordIds]).map(id => Number(id)).filter(Number.isFinite))];
    if (!ids.length || !confirm('确定移出词库吗？学习历史和复习记录会保留。')) return;
    await DB.archiveLearnWords(ids);
    this.selectedWordIds.clear();
    this.manageMode = false;
    await this.render(this.container);
  },

  async showWordDetail(id) {
    const row = this.rows.find(word => Number(word.id) === Number(id));
    if (!row) return;
    const saved = row.savedContexts?.[0] || null;
    const record = saved ? { ...row, ...saved, word: row.word } : row;
    const word = await ensureSavedWordDefinition(record, {
      lookup: Dictionary.lookup.bind(Dictionary),
      update: saved ? DB.updateWordDefinition.bind(DB) : async () => {}
    });
    WordStudyDetail.open({
      word: row.word,
      definition: word,
      sourceMeta: {
        eyebrow: 'WORD LIBRARY',
        originLabel: sourceLabelOf(row) || '我的词汇',
        contextSentence: saved?.contextSentence || ''
      }
    });
  }
};

window.VocabularyView = VocabularyView;
