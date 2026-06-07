/**
 * Stats View
 * Reading progress tracking and statistics
 */

const StatsView = {
  async render(container) {
    const articles = await DB.getAllArticles();
    const learnWords = await DB.getAllLearnWords();
    const vocabWords = await DB.getAllWords();

    // Basic stats
    const totalArticles = articles.length;
    const totalWords = articles.reduce((sum, a) => sum + (a.wordCount || 0), 0);
    const learnedWords = learnWords.filter(w => w.reviewCount > 0).length;
    const masteredWords = learnWords.filter(w => w.interval >= 21).length;

    // Streak calculation
    const streak = this.calculateStreak(articles);

    // Difficulty distribution
    const diffDist = { cet4: 0, cet6: 0, graduate: 0 };
    articles.forEach(a => { diffDist[a.difficulty] = (diffDist[a.difficulty] || 0) + 1; });

    // Favorite count
    const favorites = articles.filter(a => a.favorite).length;

    // SRS stats
    const dueWords = SpacedRepetition.getDueCount(learnWords);
    const newWords = learnWords.filter(w => !w.reviewCount || w.reviewCount === 0).length;

    container.innerHTML = `
      <div class="stats-container">
        <h1 class="page-title">📊 阅读统计</h1>

        <div class="stats-grid">
          <div class="stats-card">
            <span class="stats-num">${totalArticles}</span>
            <span class="stats-label">文章总数</span>
          </div>
          <div class="stats-card">
            <span class="stats-num">${totalWords.toLocaleString()}</span>
            <span class="stats-label">总阅读词数</span>
          </div>
          <div class="stats-card">
            <span class="stats-num">${streak}</span>
            <span class="stats-label">连续天数 🔥</span>
          </div>
          <div class="stats-card">
            <span class="stats-num">${favorites}</span>
            <span class="stats-label">收藏文章 ⭐</span>
          </div>
        </div>

        <div class="stats-section">
          <h2>📚 词汇统计</h2>
          <div class="stats-detail-grid">
            <div class="stats-detail">
              <span class="stats-detail-label">学习词库</span>
              <span class="stats-detail-value">${learnWords.length} 个</span>
            </div>
            <div class="stats-detail">
              <span class="stats-detail-label">已掌握</span>
              <span class="stats-detail-value">${masteredWords} 个 ✅</span>
            </div>
            <div class="stats-detail">
              <span class="stats-detail-label">学习中</span>
              <span class="stats-detail-value">${learnedWords - masteredWords} 个</span>
            </div>
            <div class="stats-detail">
              <span class="stats-detail-label">新词</span>
              <span class="stats-detail-value">${newWords} 个</span>
            </div>
            <div class="stats-detail">
              <span class="stats-detail-label">待复习</span>
              <span class="stats-detail-value">${dueWords} 个 🔄</span>
            </div>
            <div class="stats-detail">
              <span class="stats-detail-label">生词本</span>
              <span class="stats-detail-value">${vocabWords.length} 个</span>
            </div>
          </div>
        </div>

        <div class="stats-section">
          <h2>📊 难度分布</h2>
          <div class="stats-diff-bars">
            ${this.renderDiffBar('四级', diffDist.cet4, totalArticles, 'cet4')}
            ${this.renderDiffBar('六级', diffDist.cet6, totalArticles, 'cet6')}
            ${this.renderDiffBar('考研', diffDist.graduate, totalArticles, 'graduate')}
          </div>
        </div>

        <div class="stats-section">
          <h2>📅 最近阅读</h2>
          ${articles.length > 0 ? this.renderRecentArticles(articles.slice(0, 5)) : '<p class="text-muted">暂无阅读记录</p>'}
        </div>

        <div style="text-align:center;margin-top:24px">
          <a href="#/chat" class="btn btn-primary">去阅读</a>
          ${dueWords > 0 ? `<a href="#/flashcard" class="btn btn-outline">复习 ${dueWords} 个单词</a>` : ''}
        </div>
      </div>`;
  },

  calculateStreak(articles) {
    if (articles.length === 0) return 0;
    const days = new Set();
    articles.forEach(a => {
      const d = new Date(a.createdAt);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      days.add(key);
    });

    let streak = 0;
    const now = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (days.has(key)) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  },

  renderDiffBar(label, count, total, cls) {
    const pct = total > 0 ? Math.round(count / total * 100) : 0;
    return `
      <div class="diff-bar-row">
        <span class="diff-bar-label"><span class="badge badge-${cls}">${label}</span></span>
        <div class="diff-bar-track"><div class="diff-bar-fill diff-bar-${cls}" style="width:${pct}%"></div></div>
        <span class="diff-bar-count">${count} 篇 (${pct}%)</span>
      </div>`;
  },

  renderRecentArticles(articles) {
    return articles.map(a => {
      const label = DIFFICULTY_LABELS[a.difficulty] || a.difficulty;
      const date = formatDate(a.createdAt);
      return `
        <div class="recent-article">
          <a href="#/reading/${a.id}">${esc(a.title)}</a>
          <span class="badge badge-${a.difficulty}" style="font-size:11px">${label}</span>
          <span class="text-muted" style="font-size:12px">${date}</span>
        </div>`;
    }).join('');
  }
};
