/**
 * History View
 * Displays and manages saved articles
 */

const HistoryView = {
  // Render history view
  async render(container) {
    const articles = await DB.getAllArticles();

    let cards = '';
    if (articles.length === 0) {
      cards = '<div class="empty-state">还没有文章，去<a href="#/chat">对话</a>页面生成或导入文章！</div>';
    } else {
      articles.forEach(article => {
        const date = formatDate(article.createdAt);
        const label = DIFFICULTY_LABELS[article.difficulty] || article.difficulty;

        cards += `
          <div class="article-card-history" data-difficulty="${article.difficulty}">
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
          <select onchange="HistoryView.filter(this.value)">
            <option value="">全部难度</option>
            <option value="cet4">四级</option>
            <option value="cet6">六级</option>
            <option value="graduate">考研</option>
          </select>
        </div>
        <div class="article-list">${cards}</div>
      </div>`;
  },

  // Filter articles by difficulty
  filter(value) {
    document.querySelectorAll('.article-card-history').forEach(card => {
      card.style.display = (!value || card.dataset.difficulty === value) ? '' : 'none';
    });
  },

  // Delete an article
  async deleteArticle(id, btn) {
    if (!confirm('确定要删除这篇文章吗？')) return;
    await DB.deleteArticle(id);
    btn.closest('.article-card-history').remove();
  }
};
