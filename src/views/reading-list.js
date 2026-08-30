/**
 * Reading List View
 * Browse RSS articles by difficulty, fetched from server
 */

import { ARTICLE_SERVER_URL } from '../config.js';
import { DB } from '../db.js';
import { formatDate, esc } from '../helpers.js';
import { ArticleCatalog } from '../components/article-catalog.js';
import {
  articleGenreForArticle,
  articleTaxonomyLabels,
  examTopicForArticle,
  formatPastExamLabel,
  matchesArticleTaxonomy,
  matchesShelfDifficulty,
  mergeCloudArticleDetail,
  normalizeCloudArticleMetadata,
  resolveArticleTrack,
  sourceLabelForArticle
} from '../cloud-article-metadata.mjs';

const TOPIC_OPTIONS = [
  'all',
  'society_education',
  'technology_environment',
  'economy_workplace',
  'health_psychology',
  'culture_history',
  'public_affairs'
];

const GENRE_OPTIONS = [
  { id: 'all', label: '全部类型', note: '查看所有写作方式' },
  { id: 'argument', label: '观点论述', note: '立场、论据与思辨' },
  { id: 'explanation', label: '说明分析', note: '机制、原因与影响' },
  { id: 'research', label: '研究解读', note: '实验、调查与数据' },
  { id: 'news', label: '新闻报道', note: '事件、人物与进展' },
  { id: 'narrative', label: '人物叙事', note: '经历、故事与传记' }
];

const topicLabel = topic => topic === 'all'
  ? '全部主题'
  : articleTaxonomyLabels({ examTopic: topic }).topic;

const genreLabel = genre => GENRE_OPTIONS.find(option => option.id === genre)?.label || '全部类型';

function buildCachedCloudPatch(article, existing = {}) {
  const fields = {};
  const titleZh = String(article.titleZh || '').trim();
  const metadata = normalizeCloudArticleMetadata(article);

  if (titleZh && titleZh !== String(existing.titleZh || '').trim()) fields.titleZh = titleZh;
  if ((metadata.sourceType === 'past-exam' || !existing.sourceType)
    && metadata.sourceType !== existing.sourceType) {
    fields.sourceType = metadata.sourceType;
  }
  [
    'examType',
    'examTypeConfidence',
    'examYear',
    'examName',
    'examText',
    'examTopic',
    'articleGenre',
    'topicConfidence',
    'genreConfidence',
    'classificationConfidence',
    'classificationVersion',
    'classificationSource',
    'classifiedAt'
  ].forEach(key => {
    if (metadata[key] !== null && metadata[key] !== existing[key]) fields[key] = metadata[key];
  });
  return fields;
}

export const ReadingListView = {
  _articles: [],
  _currentFilter: 'all',       // target track: all/cet4/cet6/kaoyan1/kaoyan2/kaoyan-general
  _currentTopic: 'all',        // examTopic
  _currentGenre: 'all',        // articleGenre
  _genreMenuOpen: false,
  _container: null,
  _renderSession: 0,
  _unsubscribeCatalog: null,
  _pendingArticles: null,
  _catalogRefreshPromise: null,
  _pullRefreshCleanup: null,
  _preloadedSnapshot: null,

  async preloadData() {
    const cached = await ArticleCatalog.getSnapshot();
    if (cached) {
      this._preloadedSnapshot = cached;
      return cached;
    }
    const result = await ArticleCatalog.refresh();
    this._preloadedSnapshot = result.snapshot;
    return this._preloadedSnapshot;
  },

  cleanup() {
    this._renderSession += 1;
    this._genreMenuOpen = false;
    this._unsubscribeCatalog?.();
    this._unsubscribeCatalog = null;
    this._pullRefreshCleanup?.();
    this._pullRefreshCleanup = null;
    this._catalogRefreshPromise = null;
    this._pendingArticles = null;
    this._container = null;
  },

  deactivate() {
    this._renderSession += 1;
    this._unsubscribeCatalog?.();
    this._unsubscribeCatalog = null;
    this._pullRefreshCleanup?.();
    this._pullRefreshCleanup = null;
    this._catalogRefreshPromise = null;
  },

  activate(container) {
    if (container) this._container = container;
    this._unsubscribeCatalog?.();
    this._unsubscribeCatalog = ArticleCatalog.subscribe(event => this._handleCatalogUpdate(event));
    this._bindPullRefresh(this._container);
  },

  dispose() {
    this.cleanup();
    this._articles = [];
    this._preloadedSnapshot = null;
  },

  // Main render — paint memory/IndexedDB metadata first, then refresh silently.
  async render(container) {
    const renderSession = ++this._renderSession;
    this._container = container;
    this._currentFilter = 'all';
    this._currentTopic = 'all';
    this._currentGenre = 'all';
    this._genreMenuOpen = false;
    this._pendingArticles = null;
    this._unsubscribeCatalog?.();
    this._unsubscribeCatalog = ArticleCatalog.subscribe(event => this._handleCatalogUpdate(event));

    const cached = this._preloadedSnapshot || await ArticleCatalog.getSnapshot();
    this._preloadedSnapshot = null;
    if (renderSession !== this._renderSession || this._container !== container) return;
    if (cached) {
      this._articles = cached.articles;
      this._renderArticles(container, cached.articles);
      void this.refreshCatalog({ applyImmediately: false, source: 'background' });
      return;
    }

    this._renderSkeleton(container);
    try {
      const result = await ArticleCatalog.refresh();
      if (renderSession !== this._renderSession || this._container !== container) return;
      this._articles = result.snapshot.articles;
      this._renderArticles(container, result.snapshot.articles);
    } catch {
      if (renderSession !== this._renderSession || this._container !== container) return;
      const localArticles = await this._getLocalFallback();
      if (renderSession !== this._renderSession || this._container !== container) return;
      if (localArticles.length) {
        this._articles = localArticles;
        this._renderArticles(container, localArticles);
      } else {
        this._renderError(container);
      }
    }
  },

  _renderSkeleton(container) {
    container.innerHTML = `
      <div class="reading-list-container">
        <div class="reading-list-skeleton">
          ${Array.from({ length: 3 }, () => `
            <div class="skeleton-card">
              <div class="skeleton skeleton-title"></div>
              <div class="skeleton skeleton-meta"></div>
              <div class="skeleton skeleton-line"></div>
              <div class="skeleton skeleton-line short"></div>
            </div>`).join('')}
        </div>
      </div>`;
  },

  async _getLocalFallback() {
    try {
      const all = await DB.getAllArticles();
      return all.filter(article => article.sourceType === 'rss'
        || article.sourceType === 'past-exam'
        || article.source === 'past-exam');
    } catch {
      return [];
    }
  },

  async _refreshCatalog(options) {
    try {
      return await ArticleCatalog.refresh(options);
    } catch {
      return null;
    }
  },

  async refreshCatalog({ applyImmediately = false, source = 'background' } = {}) {
    if (!this._container) return null;
    if (this._catalogRefreshPromise) return this._catalogRefreshPromise;
    const renderSession = this._renderSession;
    const showRefreshState = source !== 'background';
    if (showRefreshState) this._setRefreshState('loading');
    this._catalogRefreshPromise = this._refreshCatalog({
      force: source !== 'background',
      reason: source
    }).then(result => {
      if (renderSession !== this._renderSession || !this._container) return result;
      if (result?.snapshot && applyImmediately) {
        this._applyCatalogSnapshot(result.snapshot, { scrollTop: 0 });
        if (showRefreshState) this._setRefreshState('success');
      } else if (showRefreshState) {
        this._setRefreshState(result?.snapshot ? 'success' : 'error');
      }
      return result;
    }).catch(error => {
      if (showRefreshState && renderSession === this._renderSession && this._container) {
        this._setRefreshState('error');
      }
      return { snapshot: null, source, error };
    }).finally(() => {
      this._catalogRefreshPromise = null;
    });
    return this._catalogRefreshPromise;
  },

  _setRefreshState(state) {
    const status = this._container?.querySelector?.('.shelf-pull-status');
    if (!status) return;
    const labels = {
      idle: '下拉刷新',
      loading: '正在刷新书架…',
      success: '书架已更新',
      error: '刷新失败，仍在使用本地书架'
    };
    status.textContent = labels[state] || labels.idle;
    status.hidden = state === 'idle';
  },

  _applyCatalogSnapshot(snapshot, { scrollTop = 0 } = {}) {
    if (!this._container || !snapshot?.articles) return;
    this._pendingArticles = null;
    this._articles = snapshot.articles;
    this._renderArticles(this._container, snapshot.articles);
    this._container.scrollTop = scrollTop;
  },

  _handleCatalogUpdate(event) {
    if (!this._container || !event?.snapshot?.articles) return;
    this._pendingArticles = event.snapshot.articles;
    const notice = this._container.querySelector?.('.shelf-catalog-notice');
    if (notice) notice.hidden = false;
  },

  applyCatalogUpdate() {
    if (!this._container || !this._pendingArticles) return;
    const scrollTop = this._container.scrollTop;
    const articles = this._pendingArticles;
    this._pendingArticles = null;
    this._articles = articles;
    this._renderArticles(this._container, articles);
    this._container.scrollTop = scrollTop;
  },

  _renderError(container) {
    container.innerHTML = `
          <div class="reading-list-container">
            <div class="reading-list-error">
              <p>无法连接服务器</p>
              <button class="btn btn-primary" onclick="ReadingListView.retry()">重试</button>
            </div>
          </div>`;
  },

  async retry() {
    if (!this._container) return;
    this._renderSkeleton(this._container);
    const result = await this._refreshCatalog({ force: true });
    if (!this._container) return;
    if (result?.snapshot) {
      this._articles = result.snapshot.articles;
      this._renderArticles(this._container, result.snapshot.articles);
    } else {
      this._renderError(this._container);
    }
  },

  // Render articles with exam track + exam topic + article genre filters.
  _renderArticles(container, articles) {
    const difficulties = ['all', 'cet4', 'cet6', 'kaoyan1', 'kaoyan2', 'kaoyan-general'];
    const tabLabels = {
      all: '全部',
      cet4: '四级',
      cet6: '六级',
      kaoyan1: '考研英语一',
      kaoyan2: '考研英语二',
      'kaoyan-general': '考研通用'
    };

    const filtered = articles.filter(article => this._matchesFilters(article));

    const tabsHTML = difficulties.map(d =>
      `<button type="button" class="reading-list-tab shelf-track-chip${d === this._currentFilter ? ' active' : ''}" aria-pressed="${d === this._currentFilter}" onclick="ReadingListView.filterByDifficulty('${d}')">${tabLabels[d]}</button>`
    ).join('');

    const topicTabsHTML = TOPIC_OPTIONS.map(topic =>
      `<button type="button" class="shelf-topic-chip${topic === this._currentTopic ? ' active' : ''}" aria-pressed="${topic === this._currentTopic}" onclick="ReadingListView.filterByTopic('${topic}')">${esc(topicLabel(topic))}</button>`
    ).join('');

    const activeFilters = [
      this._currentFilter !== 'all' ? tabLabels[this._currentFilter] : '',
      this._currentTopic !== 'all' ? topicLabel(this._currentTopic) : '',
      this._currentGenre !== 'all' ? genreLabel(this._currentGenre) : ''
    ].filter(Boolean);
    const resultDescription = activeFilters.length
      ? `${activeFilters.join(' · ')}，${filtered.length} 篇`
      : `全部内容，${filtered.length} 篇`;

    const genreSheetHTML = this._genreMenuOpen ? `
      <div class="shelf-genre-layer" aria-live="polite">
        <button type="button" class="shelf-genre-backdrop" aria-label="关闭文章类型选择" onclick="ReadingListView.closeGenreMenu()"></button>
        <section class="shelf-genre-sheet" role="dialog" aria-modal="true" aria-labelledby="shelfGenreTitle">
          <div class="shelf-genre-sheet-head">
            <div>
              <p class="shelf-filter-kicker">ARTICLE FORM</p>
              <h3 id="shelfGenreTitle">选择文章类型</h3>
            </div>
            <button type="button" class="shelf-genre-close" aria-label="关闭" onclick="ReadingListView.closeGenreMenu()">×</button>
          </div>
          <div class="shelf-genre-options">
            ${GENRE_OPTIONS.map((option, index) => `
              <button type="button" class="shelf-genre-option${option.id === this._currentGenre ? ' active' : ''}" aria-pressed="${option.id === this._currentGenre}" onclick="ReadingListView.filterByGenre('${option.id}')">
                <span class="shelf-genre-index">${String(index).padStart(2, '0')}</span>
                <span class="shelf-genre-option-copy"><strong>${option.label}</strong><small>${option.note}</small></span>
                <span class="shelf-genre-check" aria-hidden="true">${option.id === this._currentGenre ? '●' : '○'}</span>
              </button>`).join('')}
          </div>
        </section>
      </div>` : '';

    let cardsHTML = '';
    if (filtered.length === 0) {
      cardsHTML = '<div class="empty-state">暂无文章</div>';
    } else {
      filtered.forEach((article, i) => {
        const articleTrack = resolveArticleTrack(article);
        const taxonomy = articleTaxonomyLabels(article);
        const topic = examTopicForArticle(article);
        const genre = articleGenreForArticle(article);
        const date = formatDate(article.publishedAt || article.createdAt || Date.now());
        const summary = article.summary || (article.content ? article.content.slice(0, 120) + '...' : '');
        const pastExamLabel = formatPastExamLabel(article);
        const sourceLabel = sourceLabelForArticle(article);
        const showSourceLabel = sourceLabel && !pastExamLabel;
        const researchBadge = Array.isArray(article.researchSources) && article.researchSources.length
          ? '<span class="badge badge-research">联网资料</span>'
          : '';
        const badges = [
          `<span class="badge article-exam-badge badge-${esc(articleTrack.badgeClass)}">${esc(articleTrack.primaryLabel)}</span>`,
          researchBadge
        ].filter(Boolean).join('');
        const taxonomyParts = [taxonomy.topic, taxonomy.genre].filter(Boolean);
        const taxonomyHTML = taxonomyParts.length
          ? `<span class="article-list-taxonomy"><span>${esc(taxonomyParts[0])}</span>${taxonomyParts[1] ? `<i aria-hidden="true">·</i><span>${esc(taxonomyParts[1])}</span>` : ''}</span>`
          : '';

        cardsHTML += `
          <div class="article-list-item" data-difficulty="${esc(articleTrack.targetTrack)}" data-material-difficulty="${esc(article.difficulty || '')}" data-exam-topic="${esc(topic)}" data-article-genre="${esc(genre)}">
            <div class="article-list-item-header">
              <a class="article-list-title" onclick="ReadingListView._openArticle(${i})">${esc(article.title || 'Untitled')}</a>
              <span class="article-list-badges">${badges}</span>
            </div>
            ${article.titleZh ? `<div class="article-list-title-cn">${esc(article.titleZh)}</div>` : ''}
            <div class="article-list-meta">
              ${showSourceLabel ? `<span class="article-list-source">${esc(sourceLabel)}</span>` : ''}
              ${pastExamLabel ? `<span class="article-past-exam-badge">${esc(pastExamLabel)}</span>` : ''}
              ${articleTrack.baselineLabel ? `<span class="article-list-baseline">${esc(articleTrack.baselineLabel)}</span>` : ''}
              ${taxonomyHTML}
              ${article.wordCount ? `<span>${article.wordCount} 词</span>` : ''}
              <span>${date}</span>
            </div>
            ${summary ? `<div class="article-list-summary">${esc(summary)}</div>` : ''}
          </div>`;
      });
    }

    container.innerHTML = `
      <section class="app-standard-page reading-list-container" aria-labelledby="readingListContentTitle">
        <h2 id="readingListContentTitle" class="sr-only">阅读书架内容</h2>
        <header class="page-heading app-route-heading">
          <p class="page-eyebrow">04 / THE SHELF</p>
          <h1 class="page-title">阅读书架</h1>
          <p class="page-desc">按考试轨道、常考主题和文章类型，挑选下一篇阅读。</p>
        </header>
        <div class="shelf-pull-status" role="status" aria-live="polite" hidden>下拉刷新</div>
        <aside class="shelf-catalog-notice" role="status" ${this._pendingArticles ? '' : 'hidden'}>
          <span>书架已有新内容</span>
          <button type="button" onclick="ReadingListView.applyCatalogUpdate()">点击查看</button>
        </aside>
        <section class="shelf-filter-panel" aria-label="书架筛选">
          <div class="shelf-filter-section shelf-filter-section--track">
            <div class="shelf-filter-heading">
              <span class="shelf-filter-kicker">目标考试</span>
              <span class="shelf-filter-hint">TRACK</span>
            </div>
            <div class="reading-list-tabs shelf-track-list" role="group" aria-label="目标考试">${tabsHTML}</div>
          </div>
          <div class="shelf-filter-rule" aria-hidden="true"></div>
          <div class="shelf-filter-section shelf-filter-section--topic">
            <div class="shelf-filter-heading shelf-filter-heading--topic">
              <div>
                <span class="shelf-filter-kicker">常考主题</span>
                <span class="shelf-filter-hint">TOPIC</span>
              </div>
              <button type="button" class="shelf-genre-trigger${this._currentGenre !== 'all' ? ' active' : ''}" aria-expanded="${this._genreMenuOpen}" onclick="ReadingListView.toggleGenreMenu()">
                <span>文章类型</span>
                <strong>${esc(genreLabel(this._currentGenre))}</strong>
                <span aria-hidden="true">⌄</span>
              </button>
            </div>
            <div class="shelf-topic-list" role="group" aria-label="常考主题">${topicTabsHTML}</div>
          </div>
          <div class="shelf-filter-status">
            <span>${esc(resultDescription)}</span>
            ${activeFilters.length ? '<button type="button" onclick="ReadingListView.clearFilters()">清除筛选</button>' : ''}
          </div>
        </section>
        <div class="article-list">${cardsHTML}</div>
      </section>
      ${genreSheetHTML}`;

    this._articles = articles;
    this._bindPullRefresh(container);
  },

  _bindPullRefresh(container) {
    this._pullRefreshCleanup?.();
    if (!container || typeof container.addEventListener !== 'function') {
      this._pullRefreshCleanup = null;
      return;
    }
    let startY = null;
    const onStart = event => {
      if (container.scrollTop > 0 || event.touches?.length !== 1) {
        startY = null;
        return;
      }
      startY = event.touches[0].clientY;
    };
    const onEnd = event => {
      if (startY === null) return;
      const endY = event.changedTouches?.[0]?.clientY ?? startY;
      const distance = endY - startY;
      startY = null;
      if (distance >= 72 && container.scrollTop <= 0) {
        void this.refreshCatalog({ applyImmediately: true, source: 'pull' });
      }
    };
    container.addEventListener('touchstart', onStart, { passive: true });
    container.addEventListener('touchend', onEnd, { passive: true });
    this._pullRefreshCleanup = () => {
      container.removeEventListener?.('touchstart', onStart);
      container.removeEventListener?.('touchend', onEnd);
    };
  },

  // Filter displayed articles by difficulty
  filterByDifficulty(difficulty) {
    this._currentFilter = difficulty;
    if (!this._container) return;
    this._renderArticles(this._container, this._articles);
    this._container.scrollTop = 0;
  },

  filterByTopic(topic) {
    this._currentTopic = TOPIC_OPTIONS.includes(topic) ? topic : 'all';
    if (!this._container) return;
    this._renderArticles(this._container, this._articles);
    this._container.scrollTop = 0;
  },

  filterByGenre(genre) {
    this._currentGenre = GENRE_OPTIONS.some(option => option.id === genre) ? genre : 'all';
    this._genreMenuOpen = false;
    if (!this._container) return;
    this._renderArticles(this._container, this._articles);
    this._container.scrollTop = 0;
  },

  toggleGenreMenu() {
    this._genreMenuOpen = !this._genreMenuOpen;
    if (this._container) this._renderArticles(this._container, this._articles);
  },

  closeGenreMenu() {
    if (!this._genreMenuOpen) return;
    this._genreMenuOpen = false;
    if (this._container) this._renderArticles(this._container, this._articles);
  },

  clearFilters() {
    this._currentFilter = 'all';
    this._currentTopic = 'all';
    this._currentGenre = 'all';
    this._genreMenuOpen = false;
    if (!this._container) return;
    this._renderArticles(this._container, this._articles);
    this._container.scrollTop = 0;
  },

  _matchesFilters(article) {
    return matchesShelfDifficulty(article, this._currentFilter)
      && matchesArticleTaxonomy(article, {
        topic: this._currentTopic,
        genre: this._currentGenre
      });
  },

  // 当前三重过滤下的可见列表，供 _openArticle 复用。
  _visibleArticles() {
    return this._articles.filter(article => this._matchesFilters(article));
  },

  // Open article: fetch full content from server, sync to IndexedDB, then navigate
  async _openArticle(index) {
    const filtered = this._visibleArticles();
    const article = filtered[index];
    if (!article) return;
    let currentArticle = article;

    // Check if already synced locally
    if (currentArticle.id) {
      const stableUrl = currentArticle.sourceUrl || currentArticle.url || '';
      if (stableUrl) {
        try {
          const existing = await DB.findArticleByUrl(stableUrl);
          if (existing && existing.content) {
            const fields = buildCachedCloudPatch(currentArticle, existing);
            if (Object.keys(fields).length) await DB.updateArticle(existing.id, fields);
            location.hash = `#/reading/${existing.id}`;
            return;
          }
        } catch {
          // A local lookup failure should not prevent trying the cloud detail.
        }
      }
    }

    let fullArticle = null;
    let retriedStaleId = false;
    while (!fullArticle) {
      try {
        const serverUrl = ARTICLE_SERVER_URL;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        let resp;
        try {
          resp = await fetch(`${serverUrl}/api/articles/${currentArticle.id}`, {
            signal: controller.signal
          });
        } finally {
          clearTimeout(timer);
        }
        if ((resp.status === 404 || resp.status === 410) && !retriedStaleId) {
          retriedStaleId = true;
          const refreshed = await this.refreshCatalog({
            applyImmediately: false,
            source: 'detail-retry'
          });
          if (refreshed?.source !== 'network' || !refreshed.snapshot) {
            alert('书架暂时无法同步，请稍后重试');
            return;
          }
          const replacement = await ArticleCatalog.findCurrentArticle({
            id: currentArticle.id,
            sourceUrl: currentArticle.sourceUrl || currentArticle.url || ''
          });
          if (!replacement || replacement.id === currentArticle.id) {
            const persisted = await this._removeStaleArticle(currentArticle);
            alert(persisted
              ? '这篇文章已更新或下架'
              : '文章已下架，但本地书架更新失败，下次进入可能仍会显示');
            return;
          }
          currentArticle = replacement;
          continue;
        }
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        fullArticle = mergeCloudArticleDetail(currentArticle, await resp.json());
      } catch (error) {
        if (retriedStaleId && !fullArticle) {
          alert(error?.name === 'AbortError' ? '文章加载超时，请重试' : '文章详情暂时不可用，请重试');
        } else {
          alert(error?.name === 'AbortError' ? '文章加载超时，请重试' : '无法连接文章服务器，请重试');
        }
        return;
      }
    }

    try {
      const id = await DB.syncArticle(fullArticle);
      location.hash = `#/reading/${id}`;
    } catch {
      alert('文章已加载，但保存到本地失败，请重试');
    }
  },

  async _removeStaleArticle(article) {
    if (!article?.id) return true;
    let persisted = true;
    try {
      await ArticleCatalog.removeArticle({
        id: article.id,
        sourceUrl: article.sourceUrl || article.url || ''
      });
    } catch {
      persisted = false;
    }
    if (this._container) {
      this._articles = this._articles.filter(item => item.id !== article.id);
      this._renderArticles(this._container, this._articles);
    }
    return persisted;
  }
};

window.ReadingListView = ReadingListView;
