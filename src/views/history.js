/**
 * History View
 * Displays and manages saved articles with favorite filter
 */

import { DB } from '../db.js';
import { DIFFICULTY_LABELS, formatDate, esc } from '../helpers.js';

export const HistoryView = {
  filterMode: 'all', // all | favorites
  difficultyFilter: '',

  // Render history view
  async render(container) {
    const articles = await DB.getAllArticles();
    const favoritesCount = articles.filter(a => a.favorite).length;

    let cards = '';
    if (articles.length === 0) {
      cards = '<div class="empty-state">还没有文章，去<a href="#/chat">对话</a>页面生成或导入文章！</div>';
    } else {
      articles.forEach(article => {
        const date = formatDate(article.createdAt);
        const label = DIFFICULTY_LABELS[article.difficulty] || article.difficulty;
        const favIcon = article.favorite ? '⭐' : '☆';

        cards += `
          <div class="article-card-history" data-difficulty="${article.difficulty}" data-favorite="${article.favorite ? '1' : '0'}">
            <div class="card-header">
              <a href="#/reading/${article.id}" class="card-title">${esc(article.title)}</a>
              <span class="badge badge-${article.difficulty}">${label}</span>
            </div>
            <div class="card-meta">
              <span>${article.wordCount} 词</span>
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
            <option value="graduate" ${this.difficultyFilter === 'graduate' ? 'selected' : ''}>考研</option>
          </select>
          <select onchange="HistoryView.filterFavorite(this.value)">
            <option value="all" ${this.filterMode === 'all' ? 'selected' : ''}>全部文章</option>
            <option value="favorites" ${this.filterMode === 'favorites' ? 'selected' : ''}>⭐ 收藏 (${favoritesCount})</option>
          </select>
        </div>
        <div class="article-list">${cards}</div>
      </section>`;
    this.applyFilters();
  },

  applyFilters() {
    document.querySelectorAll('.article-card-history').forEach(card => {
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

  // Toggle favorite
  async toggleFav(id, btn) {
    const article = await DB.getArticle(id);
    if (!article) return;
    const newFav = article.favorite ? 0 : 1;
    await DB.updateArticle(id, { favorite: newFav });
    btn.textContent = newFav ? '⭐' : '☆';
    btn.closest('.article-card-history').dataset.favorite = newFav ? '1' : '0';
    this.applyFilters();
  },

  // Delete an article
  async deleteArticle(id, btn) {
    if (!confirm('确定要删除这篇文章吗？')) return;
    await DB.deleteArticle(id);
    btn.closest('.article-card-history').remove();
    const articles = await DB.getAllArticles();
    const favoritesCount = articles.filter(article => article.favorite).length;
    const favoriteOption = document.querySelector('.history-filters select:last-child option[value="favorites"]');
    if (favoriteOption) favoriteOption.textContent = `⭐ 收藏 (${favoritesCount})`;
  }
};

window.HistoryView = HistoryView;
