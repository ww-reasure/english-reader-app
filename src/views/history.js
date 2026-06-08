import { DB } from "../db.js";
import { esc, formatDate, DIFFICULTY_LABELS } from "../helpers.js";
/**
 * History View
 * Displays and manages saved articles with favorite filter
 */

export const HistoryView = {
  filterMode: 'all', // all | favorites

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
      <div class="history-container">
        <h1 class="page-title">阅读历史</h1>
        <div class="history-filters">
          <select onchange="HistoryView.filterDifficulty(this.value)">
            <option value="">全部难度</option>
            <option value="cet4">四级</option>
            <option value="cet6">六级</option>
            <option value="graduate">考研</option>
          </select>
          <select onchange="HistoryView.filterFavorite(this.value)">
            <option value="all">全部文章</option>
            <option value="favorites">⭐ 收藏 (${favoritesCount})</option>
          </select>
        </div>
        <div class="article-list">${cards}</div>
      </div>`;
  },

  // Filter by difficulty
  filterDifficulty(value) {
    document.querySelectorAll('.article-card-history').forEach(card => {
      const matchDiff = !value || card.dataset.difficulty === value;
      const matchFav = this.filterMode !== 'favorites' || card.dataset.favorite === '1';
      card.style.display = (matchDiff && matchFav) ? '' : 'none';
    });
  },

  // Filter by favorite
  filterFavorite(value) {
    this.filterMode = value;
    document.querySelectorAll('.article-card-history').forEach(card => {
      if (value === 'favorites') {
        card.style.display = card.dataset.favorite === '1' ? '' : 'none';
      } else {
        card.style.display = '';
      }
    });
  },

  // Toggle favorite
  async toggleFav(id, btn) {
    const article = await DB.getArticle(id);
    if (!article) return;
    const newFav = article.favorite ? 0 : 1;
    await DB.updateArticle(id, { favorite: newFav });
    btn.textContent = newFav ? '⭐' : '☆';
    btn.closest('.article-card-history').dataset.favorite = newFav ? '1' : '0';
  },

  // Delete an article
  async deleteArticle(id, btn) {
    if (!confirm('确定要删除这篇文章吗？')) return;
    await DB.deleteArticle(id);
    btn.closest('.article-card-history').remove();
  }
};
