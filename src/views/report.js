import { DB } from "../db.js";
import { SpacedRepetition } from "../spaced-repetition.js";
import { esc } from "../helpers.js";
/**
 * Report View
 * Weekly/Monthly reading report with achievements
 */

export const ReportView = {
  async render(container) {
    const articles = await DB.getAllArticles();
    const learnWords = await DB.getAllLearnWords();
    const readingStats = await DB.getAllReadingStats();

    // This week stats
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const weekStats = readingStats.filter(s => s.createdAt >= weekStart.getTime());
    const weekArticles = articles.filter(a => a.createdAt >= weekStart.getTime());

    const weekReads = weekArticles.length;
    const weekWords = weekArticles.reduce((sum, a) => sum + (a.wordCount || 0), 0);
    const weekTime = weekStats.reduce((sum, s) => sum + (s.elapsed || 0), 0);
    const weekAvgWpm = weekStats.length > 0
      ? Math.round(weekStats.reduce((sum, s) => sum + s.wpm, 0) / weekStats.length)
      : 0;

    // This month stats
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthStats = readingStats.filter(s => s.createdAt >= monthStart.getTime());
    const monthArticles = articles.filter(a => a.createdAt >= monthStart.getTime());

    const monthReads = monthArticles.length;
    const monthWords = monthArticles.reduce((sum, a) => sum + (a.wordCount || 0), 0);
    const monthTime = monthStats.reduce((sum, s) => sum + (s.elapsed || 0), 0);

    // Vocabulary stats
    const totalLearnWords = learnWords.length;
    const masteredWords = learnWords.filter(w => w.interval >= 21).length;
    const learningWords = learnWords.filter(w => w.reviewCount > 0 && w.interval < 21).length;
    const newWords = learnWords.filter(w => !w.reviewCount || w.reviewCount === 0).length;
    const dueWords = SpacedRepetition.getDueCount(learnWords);

    // Streak
    const streak = StatsView.calculateStreak(articles);

    // Achievements
    const achievements = this.checkAchievements({
      totalArticles: articles.length,
      totalLearnWords,
      masteredWords,
      streak,
      readingStats,
      weekReads
    });

    const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
    const now = new Date();
    const reportTitle = `${monthNames[now.getMonth()]}第 ${Math.ceil(now.getDate() / 7)} 周报告`;

    container.innerHTML = `
      <div class="report-container">
        <h1 class="page-title">📊 ${esc(reportTitle)}</h1>
        <p class="report-date">${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日</p>

        <div class="report-section">
          <h2>📖 本周阅读</h2>
          <div class="report-stats-grid">
            <div class="report-stat-card">
              <span class="report-stat-num">${weekReads}</span>
              <span class="report-stat-label">文章</span>
            </div>
            <div class="report-stat-card">
              <span class="report-stat-num">${weekWords.toLocaleString()}</span>
              <span class="report-stat-label">词数</span>
            </div>
            <div class="report-stat-card">
              <span class="report-stat-num">${this.formatTime(weekTime)}</span>
              <span class="report-stat-label">阅读时间</span>
            </div>
            <div class="report-stat-card">
              <span class="report-stat-num">${weekAvgWpm || '-'}</span>
              <span class="report-stat-label">平均词/分</span>
            </div>
          </div>
        </div>

        <div class="report-section">
          <h2>📅 本月阅读</h2>
          <div class="report-stats-grid">
            <div class="report-stat-card">
              <span class="report-stat-num">${monthReads}</span>
              <span class="report-stat-label">文章</span>
            </div>
            <div class="report-stat-card">
              <span class="report-stat-num">${monthWords.toLocaleString()}</span>
              <span class="report-stat-label">词数</span>
            </div>
            <div class="report-stat-card">
              <span class="report-stat-num">${this.formatTime(monthTime)}</span>
              <span class="report-stat-label">阅读时间</span>
            </div>
          </div>
        </div>

        <div class="report-section">
          <h2>📚 词汇进度</h2>
          <div class="report-vocab-bar">
            <div class="report-vocab-segment report-vocab-mastered" style="width:${totalLearnWords > 0 ? Math.round(masteredWords / totalLearnWords * 100) : 0}%"></div>
            <div class="report-vocab-segment report-vocab-learning" style="width:${totalLearnWords > 0 ? Math.round(learningWords / totalLearnWords * 100) : 0}%"></div>
          </div>
          <div class="report-vocab-legend">
            <span><span class="report-dot report-dot-mastered"></span> 已掌握 ${masteredWords}</span>
            <span><span class="report-dot report-dot-learning"></span> 学习中 ${learningWords}</span>
            <span><span class="report-dot report-dot-new"></span> 新词 ${newWords}</span>
          </div>
          ${dueWords > 0 ? `<p class="report-due">🔄 ${dueWords} 个单词待复习</p>` : ''}
        </div>

        <div class="report-section">
          <h2>🔥 连续阅读</h2>
          <div class="report-streak">
            <span class="report-streak-num">${streak}</span>
            <span class="report-streak-label">天</span>
          </div>
        </div>

        <div class="report-section">
          <h2>🏆 成就</h2>
          <div class="report-achievements">
            ${achievements.map(a => `
              <div class="report-achievement ${a.unlocked ? 'unlocked' : 'locked'}">
                <span class="report-achievement-icon">${a.icon}</span>
                <span class="report-achievement-name">${esc(a.name)}</span>
                <span class="report-achievement-desc">${esc(a.desc)}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <div style="text-align:center;margin-top:24px">
          <a href="#/chat" class="btn btn-primary">去阅读</a>
          ${dueWords > 0 ? `<a href="#/flashcard" class="btn btn-outline">复习 ${dueWords} 个词</a>` : ''}
          <a href="#/stats" class="btn btn-outline">详细统计</a>
        </div>
      </div>`;
  },

  formatTime(seconds) {
    if (seconds < 60) return `${seconds}秒`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}时${m}分`;
  },

  checkAchievements(data) {
    return [
      {
        icon: '📖', name: '初次阅读',
        desc: '完成第 1 篇计时阅读',
        unlocked: data.readingStats.length >= 1
      },
      {
        icon: '📚', name: '百词达人',
        desc: '学习词库达到 100 词',
        unlocked: data.totalLearnWords >= 100
      },
      {
        icon: '🎓', name: '千词大师',
        desc: '学习词库达到 1000 词',
        unlocked: data.totalLearnWords >= 1000
      },
      {
        icon: '🔥', name: '连续 3 天',
        desc: '连续阅读 3 天',
        unlocked: data.streak >= 3
      },
      {
        icon: '🔥🔥', name: '连续 7 天',
        desc: '连续阅读 7 天',
        unlocked: data.streak >= 7
      },
      {
        icon: '🔥🔥🔥', name: '连续 30 天',
        desc: '连续阅读 30 天',
        unlocked: data.streak >= 30
      },
      {
        icon: '⚡', name: '速度之星',
        desc: '单次阅读超过 250 词/分',
        unlocked: data.readingStats.some(s => s.wpm >= 250)
      },
      {
        icon: '🏃', name: '阅读马拉松',
        desc: '单次阅读超过 10 分钟',
        unlocked: data.readingStats.some(s => s.elapsed >= 600)
      }
    ];
  }
};
