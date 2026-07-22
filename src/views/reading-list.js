/**
 * Reading List View
 * Browse RSS articles by difficulty, fetched from server
 */

import { ARTICLE_SERVER_URL } from '../config.js';
import { DB } from '../db.js';
import { DIFFICULTY_LABELS, formatDate, esc } from '../helpers.js';

// 文章题材映射(云端 category key → 友好显示名)，未命中归为"其他"
const CATEGORIES = ['all', 'science', 'world', 'society', 'culture', 'other'];
const CATEGORY_LABELS = {
  all: '全部',
  science: '科学',
  world: '国际时政',
  society: '社会生活',
  culture: '文化',
  other: '其他'
};

export const ReadingListView = {
  _articles: [],
  _currentFilter: 'all',       // difficulty: all/cet4/cet6/graduate
  _currentCategory: 'all',     // category: all/science/world/society/culture/other

  cleanup() {},

  // Main render — show skeleton, fetch, then display
  async render(container) {
    this._currentFilter = 'all';
    this._currentCategory = 'all';

    // Show skeleton loading immediately
    container.innerHTML = `
      <div class="reading-list-container">
        <div class="reading-list-skeleton">
          <div class="skeleton-card">
            <div class="skeleton skeleton-title"></div>
            <div class="skeleton skeleton-meta"></div>
            <div class="skeleton skeleton-line"></div>
            <div class="skeleton skeleton-line short"></div>
          </div>
          <div class="skeleton-card">
            <div class="skeleton skeleton-title"></div>
            <div class="skeleton skeleton-meta"></div>
            <div class="skeleton skeleton-line"></div>
            <div class="skeleton skeleton-line short"></div>
          </div>
          <div class="skeleton-card">
            <div class="skeleton skeleton-title"></div>
            <div class="skeleton skeleton-meta"></div>
            <div class="skeleton skeleton-line"></div>
            <div class="skeleton skeleton-line short"></div>
          </div>
        </div>
      </div>`;

    const articles = await this._fetchArticles();

    if (articles && articles.length > 0) {
      // Success — render server articles
      this._articles = articles;
      this._renderArticles(container, articles);
    } else {
      // Try cache fallback from IndexedDB
      let cached = [];
      try {
        const all = await DB.getAllArticles();
        cached = all.filter(a => a.sourceType === 'rss');
      } catch {}

      if (cached.length > 0) {
        this._articles = cached;
        this._renderArticles(container, cached);
      } else if (articles === null) {
        // Network error, no cache
        container.innerHTML = `
          <div class="reading-list-container">
            <div class="reading-list-error">
              <p>无法连接服务器</p>
              <button class="btn btn-primary" onclick="ReadingListView.render(document.getElementById('app'))">重试</button>
            </div>
          </div>`;
      } else {
        // Empty response from server
        container.innerHTML = `
          <section class="app-standard-page reading-list-container" aria-labelledby="readingListContentTitle">
            <h2 id="readingListContentTitle" class="sr-only">阅读书架内容</h2>
            <h1 class="page-title app-route-heading">阅读列表</h1>
            <div class="reading-list-tabs">
              <button class="reading-list-tab active" onclick="ReadingListView.filterByDifficulty('all')">全部</button>
              <button class="reading-list-tab" onclick="ReadingListView.filterByDifficulty('cet4')">四级</button>
              <button class="reading-list-tab" onclick="ReadingListView.filterByDifficulty('cet6')">六级</button>
              <button class="reading-list-tab" onclick="ReadingListView.filterByDifficulty('graduate')">考研</button>
            </div>
            <div class="empty-state">暂无文章</div>
          </section>`;
      }
    }
  },

  async _fetchArticles() {
    const serverUrl = ARTICLE_SERVER_URL;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const resp = await fetch(`${serverUrl}/api/articles`, { signal: controller.signal });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } catch (e) {
      clearTimeout(timer);
      return null;
    }
  },

  // Render articles with difficulty + category tab filter
  _renderArticles(container, articles) {
    const difficulties = ['all', 'cet4', 'cet6', 'graduate'];
    const tabLabels = { all: '全部', cet4: '四级', cet6: '六级', graduate: '考研' };

    // 双重过滤: difficulty + category
    const filtered = articles.filter(a => {
      const matchDiff = this._currentFilter === 'all' || a.difficulty === this._currentFilter;
      const cat = a.category && CATEGORY_LABELS[a.category] ? a.category : 'other';
      const matchCat = this._currentCategory === 'all' || cat === this._currentCategory;
      return matchDiff && matchCat;
    });

    let tabsHTML = difficulties.map(d =>
      `<button class="reading-list-tab${d === this._currentFilter ? ' active' : ''}" onclick="ReadingListView.filterByDifficulty('${d}')">${tabLabels[d]}</button>`
    ).join('');

    const availableCats = new Set(['all']);
    articles.forEach(a => {
      const cat = a.category && CATEGORY_LABELS[a.category] ? a.category : 'other';
      availableCats.add(cat);
    });
    let catTabsHTML = availableCats.size > 2
      ? CATEGORIES.filter(c => availableCats.has(c)).map(c =>
          `<button class="reading-list-tab reading-list-tab-cat${c === this._currentCategory ? ' active' : ''}" onclick="ReadingListView.filterByCategory('${c}')">${CATEGORY_LABELS[c]}</button>`
        ).join('')
      : '';

    let cardsHTML = '';
    if (filtered.length === 0) {
      cardsHTML = '<div class="empty-state">暂无文章</div>';
    } else {
      filtered.forEach((article, i) => {
        const label = DIFFICULTY_LABELS[article.difficulty] || article.difficulty || 'cet4';
        const cat = article.category && CATEGORY_LABELS[article.category] ? article.category : 'other';
        const date = formatDate(article.publishedAt || article.createdAt || Date.now());
        const summary = article.summary || (article.content ? article.content.slice(0, 120) + '...' : '');

        cardsHTML += `
          <div class="article-list-item" data-difficulty="${article.difficulty || 'cet4'}">
            <div class="article-list-item-header">
              <a class="article-list-title" onclick="ReadingListView._openArticle(${i})">${esc(article.title || 'Untitled')}</a>
              <span class="badge badge-${article.difficulty || 'cet4'}">${label}</span>
            </div>
            ${article.titleZh ? `<div class="article-list-title-cn">${esc(article.titleZh)}</div>` : ''}
            <div class="article-list-meta">
              ${article.source ? `<span class="article-list-source">${esc(article.source)}</span>` : ''}
              <span class="article-list-cat">${CATEGORY_LABELS[cat]}</span>
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
          <p class="page-desc">按难度与题材挑选一篇，留一点安静时间给英文。</p>
        </header>
        <div class="reading-list-tabs">${tabsHTML}</div>
        ${catTabsHTML ? `<div class="reading-list-tabs reading-list-tabs-cat">${catTabsHTML}</div>` : ''}
        <div class="article-list">${cardsHTML}</div>
      </section>`;

    this._articles = articles;
  },

  // Filter displayed articles by difficulty
  filterByDifficulty(difficulty) {
    this._currentFilter = difficulty;
    const container = document.getElementById('app');
    this._renderArticles(container, this._articles);
  },

  // Filter displayed articles by category
  filterByCategory(category) {
    this._currentCategory = category;
    const container = document.getElementById('app');
    this._renderArticles(container, this._articles);
  },

  // 当前双重过滤下的可见列表(与 _renderArticles 的过滤口径一致，供 _openArticle 复用)
  _visibleArticles() {
    return this._articles.filter(a => {
      const matchDiff = this._currentFilter === 'all' || a.difficulty === this._currentFilter;
      const cat = a.category && CATEGORY_LABELS[a.category] ? a.category : 'other';
      const matchCat = this._currentCategory === 'all' || cat === this._currentCategory;
      return matchDiff && matchCat;
    });
  },

  // Open article: fetch full content from server, sync to IndexedDB, then navigate
  async _openArticle(index) {
    const filtered = this._visibleArticles();
    const article = filtered[index];
    if (!article) return;

    // Check if already synced locally
    if (article.id) {
      const existing = await DB.findArticleByUrl(article.sourceUrl || article.url || '');
      if (existing && existing.content) {
        location.hash = `#/reading/${existing.id}`;
        return;
      }
    }

    // Fetch full article from server
    try {
      const serverUrl = ARTICLE_SERVER_URL;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const resp = await fetch(`${serverUrl}/api/articles/${article.id}`, { signal: controller.signal });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const fullArticle = await resp.json();
      const id = await DB.syncArticle(fullArticle);
      location.hash = `#/reading/${id}`;
    } catch (e) {
      alert('无法打开文章，请检查服务器连接');
    }
  }
};

window.ReadingListView = ReadingListView;
