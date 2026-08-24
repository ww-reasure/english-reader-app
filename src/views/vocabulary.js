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
  getPracticeScopeStatus,
  resolvePracticeScope
} from '../review-practice.mjs';

const SOURCE_FILTERS = Object.freeze(['all', 'reading', 'import']);
const STATUS_FILTERS = Object.freeze(['all', 'new', 'learning', 'review', 'stable']);
const SORT_MODES = Object.freeze(['recent', 'alpha', 'due']);

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
  selectedWordIds: new Set(),
  _libraryChangedHandler: null,

  async render(container) {
    this.container = container;
    this.rows = await DB.getUnifiedVocabulary();
    this.bindLibraryEvents();
    await this.renderPage();
  },

  async renderPage() {
    if (!this.container) return;
    const now = Date.now();
    const rows = selectUnifiedVocabulary(this.rows, {
      query: this.searchQuery,
      source: this.sourceFilter,
      status: this.statusFilter,
      sort: this.sortMode
    });
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
    const dueCount = SpacedRepetition.getDueCount(this.rows);
    const totalCount = this.rows.length;
    const hasFilters = this.sourceFilter !== 'all' || this.statusFilter !== 'all' || this.sortMode !== 'recent';

    this.container.innerHTML = `
      <section class="app-standard-page vocab-container vocab-unified-page" aria-labelledby="vocabularyContentTitle">
        <header class="vocab-unified-header">
          <div>
            <p class="page-eyebrow">03 / WORD LIBRARY</p>
            <h1 id="vocabularyContentTitle" class="page-title">我的词汇 <span class="vocab-unified-total">+ ${totalCount}</span></h1>
            <p class="page-desc">收藏与导入的单词都在这里，学习进度与来源清晰可见。</p>
          </div>
          <button type="button" class="btn btn-primary vocab-unified-import" onclick="WordImport.showModal()">导入单词</button>
        </header>

        <div class="vocab-unified-toolbar" role="search">
          <label class="vocab-unified-search">
            <span class="sr-only">搜索单词或释义</span>
            <input type="search" value="${escAttr(this.searchQuery)}" placeholder="搜索单词或释义" aria-label="搜索单词或释义" oninput="VocabularyView.setSearchQuery(this.value)">
          </label>
          <button type="button" class="btn btn-outline vocab-unified-filter-toggle" aria-expanded="${hasFilters}" onclick="VocabularyView.toggleFilter()">筛选</button>
        </div>

        <nav class="vocab-unified-source-tabs" aria-label="词汇来源">
          ${this.renderSourceTab('all', '全部')}
          ${this.renderSourceTab('reading', '收藏')}
          ${this.renderSourceTab('import', '导入')}
        </nav>

        <details class="vocab-unified-filter" ${hasFilters ? 'open' : ''}>
          <summary>筛选与排序</summary>
          <div class="vocab-unified-filter-fields">
            <label>学习状态
              <select aria-label="学习状态" onchange="VocabularyView.setStatusFilter(this.value)">
                <option value="all" ${this.statusFilter === 'all' ? 'selected' : ''}>全部</option>
                <option value="new" ${this.statusFilter === 'new' ? 'selected' : ''}>新词</option>
                <option value="learning" ${this.statusFilter === 'learning' ? 'selected' : ''}>学习中</option>
                <option value="review" ${this.statusFilter === 'review' ? 'selected' : ''}>待复习</option>
                <option value="stable" ${this.statusFilter === 'stable' ? 'selected' : ''}>长期巩固</option>
              </select>
            </label>
            <label>排序
              <select aria-label="排序" onchange="VocabularyView.setSortMode(this.value)">
                <option value="recent" ${this.sortMode === 'recent' ? 'selected' : ''}>最近加入</option>
                <option value="alpha" ${this.sortMode === 'alpha' ? 'selected' : ''}>A–Z</option>
                <option value="due" ${this.sortMode === 'due' ? 'selected' : ''}>待复习优先</option>
              </select>
            </label>
          </div>
        </details>

        <section class="vocab-unified-study-strip" aria-label="专项复习">
          <div class="vocab-unified-study-copy">
            <strong>专项复习</strong>
            <span>只练指定词，不改变正式复习计划。</span>
          </div>
          <div class="vocab-unified-study-counts">
            <span>今日新增 ${todayScope.words.length}</span>
            <span>待复习 ${dueCount}</span>
            <span>最近加入 ${recentScope.words.length}</span>
          </div>
          <div class="vocab-unified-study-actions">
            ${this.renderPracticeEntry({ scope: 'today_added', name: '今日新增', status: todayStatus, skipped: todayScope.skipped })}
            ${this.renderPracticeEntry({ scope: 'recent_added', name: '最近加入', status: recentStatus, skipped: recentScope.skipped })}
            <a class="btn btn-primary" href="#/flashcard">开始复习</a>
          </div>
        </section>

        ${this.renderManagementBar()}
        <div class="vocab-unified-list vocab-list" data-vocab-grid="vocab">
          ${rows.length ? rows.map(row => this.renderRow(row)).join('') : '<div class="empty-state vocab-unified-empty">没有符合条件的词汇。</div>'}
        </div>
      </section>`;
  },

  renderSourceTab(value, label) {
    return `<button type="button" class="vocab-unified-source-tab ${this.sourceFilter === value ? 'is-active' : ''}" aria-pressed="${this.sourceFilter === value}" onclick="VocabularyView.setSourceFilter('${value}')">${label}</button>`;
  },

  renderManagementBar() {
    if (this.manageMode) {
      const activeIds = this.rows.map(row => row.id);
      return `<div class="vocab-unified-management" role="region" aria-label="词汇管理">
        <span>管理 ${activeIds.length} 个当前单词</span>
        <button type="button" class="btn btn-danger btn-sm" onclick="VocabularyView.archiveWords(${escAttr(JSON.stringify(activeIds))})">全部移出</button>
        <button type="button" class="btn btn-outline btn-sm" onclick="VocabularyView.toggleManage()">完成</button>
      </div>`;
    }
    if (this.selectionMode) {
      return `<div class="vocab-unified-management" role="region" aria-label="专项复习选词">
        <span>已选择 ${this.selectedWordIds.size} 个单词</span>
        <button type="button" class="btn btn-primary btn-sm vocab-practice-start-btn" onclick="VocabularyView.startManualPractice()">开始复习（${this.selectedWordIds.size}）</button>
        <button type="button" class="btn btn-outline btn-sm" onclick="VocabularyView.toggleSelection()">取消</button>
      </div>`;
    }
    return `<div class="vocab-unified-management vocab-unified-management--idle">
      <span>共 ${this.rows.length} 个单词</span>
      <div><button type="button" class="btn btn-outline btn-sm" onclick="VocabularyView.toggleSelection()">选词复习</button>
      <button type="button" class="btn btn-outline btn-sm" onclick="VocabularyView.toggleManage()">管理</button></div>
    </div>`;
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
          ${formatPhonetic(row.phonetic) ? `<span class="vocab-unified-phonetic">${esc(formatPhonetic(row.phonetic))}</span>` : ''}
        </div>
        <div class="vocab-unified-definition vocab-translation">${esc(renderDefinitionPreview(row))}</div>
        <div class="vocab-unified-meta">
          <span class="vocab-unified-source vocab-unified-source--${sourceKeys.join('-') || 'none'}">${esc(sourceLabelOf(row))}</span>
          <span class="vocab-unified-status">${esc(status)}</span>
        </div>
      </div>
      <div class="vocab-unified-row-tail">
        ${management}
        <button type="button" class="vocab-unified-detail" aria-label="查看 ${escAttr(row.word)} 学习详情" onclick="VocabularyView.showWordDetail(${id})">详情</button>
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

  async cleanup() {
    if (this._libraryChangedHandler) document.removeEventListener('word-library-changed', this._libraryChangedHandler);
    this._libraryChangedHandler = null;
    this.container = null;
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

  async setSearchQuery(value) {
    this.searchQuery = String(value || '');
    await this.renderPage();
  },

  toggleFilter() {
    const filter = document.querySelector('.vocab-unified-filter');
    if (filter) filter.open = !filter.open;
  },

  async toggleManage() {
    if (this.selectionMode) this.selectionMode = false;
    this.selectedWordIds.clear();
    this.manageMode = !this.manageMode;
    await this.renderPage();
  },

  async toggleSelection() {
    if (this.manageMode) this.manageMode = false;
    this.selectionMode = !this.selectionMode;
    this.selectedWordIds.clear();
    await this.renderPage();
  },

  toggleSelectedWord(id, checked) {
    if (checked) this.selectedWordIds.add(Number(id));
    else this.selectedWordIds.delete(Number(id));
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
    let wordIds = allWordIds;
    if (reviewAll) clearPracticeScopeDone(scope);
    else if (status.hasCompletion) wordIds = status.newIds;
    if (!wordIds.length) {
      alert('这一组已经完成。需要重复练习时，请点击“再练一轮”。');
      return;
    }
    createPracticeSession({ scope, wordIds, skipped: result.skipped });
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
    createPracticeSession({ scope: 'manual', wordIds: result.words.map(word => word.id), skipped: result.skipped });
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
