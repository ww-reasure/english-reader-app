/**
 * History View
 * Displays and manages saved articles with favorite filter
 */

import { DB } from '../db.js';
import { DIFFICULTY_LABELS, formatDate, esc } from '../helpers.js';
import { resolveArticleTrack } from '../cloud-article-metadata.mjs';

export const HistoryView = {
  filterMode: 'all', // all | favorites
  difficultyFilter: '',
  container: null,
  articles: [],
  _preloadedArticles: null,

  async preloadData() {
    this._preloadedArticles = await DB.getAllArticles();
    return this._preloadedArticles;
  },

  // Render history view
  async render(container) {
    this.container = container;
    const articles = this._preloadedArticles || await DB.getAllArticles();
    this._preloadedArticles = null;
    this.articles = articles;
    const favoritesCount = articles.filter(a => a.favorite).length;

    let cards = '';
    if (articles.length === 0) {
      cards = '<div class="empty-state">还没有文章，去<a href="#/chat">对话</a>页面生成或导入文章！</div>';
    } else {
      articles.forEach(article => {
        const date = formatDate(article.createdAt);
        const articleTrack = resolveArticleTrack(article);
        const favIcon = article.favorite
          ? '<i class="fa-solid fa-star" aria-hidden="true"></i>'
          : '<i class="fa-regular fa-star" aria-hidden="true"></i>';

        cards += `
          <div class="article-card-history" data-difficulty="${articleTrack.targetTrack}" data-favorite="${article.favorite ? '1' : '0'}">
            <div class="card-header">
              <a href="#/reading/${article.id}" class="card-title">${esc(article.title)}</a>
              <span class="badge badge-${articleTrack.badgeClass}">${esc(articleTrack.primaryLabel)}</span>
              ${Array.isArray(article.researchSources) && article.researchSources.length ? '<span class="badge badge-research">联网资料</span>' : ''}
            </div>
            <div class="card-meta">
              <span>${article.wordCount} 词</span>
              ${articleTrack.baselineLabel ? `<span>${esc(articleTrack.baselineLabel)}</span>` : ''}
              <span>${esc(article.topic)}</span>
              <span>${date}</span>
            </div>
            <div class="card-actions">
              <button class="btn btn-sm btn-outline" onclick="HistoryView.toggleFav(${article.id}, this)">${favIcon}</button>
              <a href="#/reading/${article.id}" class="btn btn-sm btn-primary">阅读</a>
              <button class="btn btn-sm btn-danger" onclick="HistoryView.deleteArticle(${article.id}, this)">删除</button>
            </div>
          </div>`;
      });
    }

    container.innerHTML = `
      <section class="app-standard-page history-container" aria-labelledby="historyContentTitle">
        <h2 id="historyContentTitle" class="sr-only">阅读记录内容</h2>
        <header class="page-heading app-route-heading">
          <p class="page-eyebrow">02 / READING LOG</p>
          <h1 class="page-title">阅读记录</h1>
        </header>
        <div class="history-filters">
          <select onchange="HistoryView.filterDifficulty(this.value)">
            <option value="" ${this.difficultyFilter === '' ? 'selected' : ''}>全部难度</option>
            <option value="cet4" ${this.difficultyFilter === 'cet4' ? 'selected' : ''}>四级</option>
            <option value="cet6" ${this.difficultyFilter === 'cet6' ? 'selected' : ''}>六级</option>
            <option value="kaoyan1" ${this.difficultyFilter === 'kaoyan1' ? 'selected' : ''}>考研英语一</option>
            <option value="kaoyan2" ${this.difficultyFilter === 'kaoyan2' ? 'selected' : ''}>考研英语二</option>
            <option value="kaoyan-general" ${this.difficultyFilter === 'kaoyan-general' ? 'selected' : ''}>考研通用</option>
          </select>
          <select onchange="HistoryView.filterFavorite(this.value)">
            <option value="all" ${this.filterMode === 'all' ? 'selected' : ''}>全部文章</option>
            <option value="favorites" ${this.filterMode === 'favorites' ? 'selected' : ''}>收藏 (${favoritesCount})</option>
          </select>
        </div>
        <div class="article-list">${cards}</div>
      </section>`;
    this.applyFilters();
  },

  applyFilters() {
    const root = typeof this.container?.querySelectorAll === 'function' ? this.container : document;
    root?.querySelectorAll?.('.article-card-history').forEach(card => {
      const matchDiff = !this.difficultyFilter || card.dataset.difficulty === this.difficultyFilter;
      const matchFav = this.filterMode !== 'favorites' || card.dataset.favorite === '1';
      card.style.display = (matchDiff && matchFav) ? '' : 'none';
    });
  },

  // Filter by difficulty
  filterDifficulty(value) {
    this.difficultyFilter = value;
    this.applyFilters();
  },

  // Filter by favorite
  filterFavorite(value) {
    this.filterMode = value;
    this.applyFilters();
  },

  activate(container) {
    if (container) this.container = container;
    this.applyFilters();
  },

  deactivate() {},

  dispose() {
    this.container = null;
    this.articles = [];
    this._preloadedArticles = null;
  },

  // Toggle favorite
  async toggleFav(id, btn) {
    const article = await DB.getArticle(id);
    if (!article) return;
    const newFav = article.favorite ? 0 : 1;
    await DB.updateArticle(id, { favorite: newFav });
    const cached = this.articles.find(article => Number(article.id) === Number(id));
    if (cached) cached.favorite = newFav;
    btn.innerHTML = newFav
      ? '<i class="fa-solid fa-star" aria-hidden="true"></i>'
      : '<i class="fa-regular fa-star" aria-hidden="true"></i>';
    btn.closest('.article-card-history').dataset.favorite = newFav ? '1' : '0';
    this.applyFilters();
  },

  // Delete an article
  async deleteArticle(id, btn) {
    if (!confirm('确定要删除这篇文章吗？')) return;
    await DB.deleteArticle(id);
    btn.closest('.article-card-history').remove();
    this.articles = this.articles.filter(article => Number(article.id) !== Number(id));
    const favoritesCount = this.articles.filter(article => article.favorite).length;
    const favoriteOption = document.querySelector('.history-filters select:last-child option[value="favorites"]');
    if (favoriteOption) favoriteOption.textContent = `收藏 (${favoritesCount})`;
  }
};

window.HistoryView = HistoryView;
