/**
 * Learning profile — reading and exam data share one calm editorial surface.
 */

import { DB } from '../db.js';
import { DIFFICULTY_LABELS, formatDate, esc } from '../helpers.js';
import { SpacedRepetition } from '../spaced-repetition.js';
import { buildReadingAnalytics } from '../reading-analytics.mjs';
import { createExamServices } from '../exam/create-services.js';
import { createExamLearningOverviewProvider } from '../exam/learning-overview-provider.mjs';

const metric = (value, label, suffix = '') => `
  <article class="profile-metric">
    <strong>${value}${suffix}</strong><span>${label}</span>
  </article>`;

export const StatsView = {
  activePanel: 'reading',
  trendMode: 'week',
  selectedExamYear: null,
  selectedExamBank: '',
  container: null,
  readingModel: null,
  examOverview: null,
  examProvider: null,
  _abortController: null,

  async render(container) {
    this.cleanup();
    this.container = container;
    const [articles, learnWords, vocabWords, readingStats] = await Promise.all([
      DB.getAllArticles(), DB.getAllLearnWords(), DB.getAllWords(), DB.getAllReadingStats()
    ]);
    this.readingModel = this.buildReadingModel({ articles, learnWords, vocabWords, readingStats });
    this.examProvider = createExamLearningOverviewProvider({ services: createExamServices() });
    try {
      this.examOverview = await this.examProvider.getOverview({ year: this.selectedExamYear, bankId: this.selectedExamBank || null });
    } catch (error) {
      console.warn('Unable to load exam learning overview', error);
      this.examOverview = this.emptyExamOverview();
    }

    container.innerHTML = `
      <section class="app-standard-page stats-container profile-dashboard" aria-labelledby="profileContentTitle">
        <header class="page-heading profile-heading app-route-heading">
          <p class="page-eyebrow">05 / STUDY ARCHIVE</p>
          <div class="profile-heading-row">
            <div><h1 id="profileContentTitle" class="page-title">学习档案</h1><p class="page-desc">阅读与训练，各有脉络，也共同构成你的进步。</p></div>
          </div>
        </header>
        <div class="profile-section-tabs" role="tablist" aria-label="学习档案分类">
          <button id="profile-tab-reading" class="profile-tab" type="button" role="tab" data-profile-tab="reading" aria-controls="profile-panel-reading" aria-selected="${this.activePanel === 'reading'}" tabindex="${this.activePanel === 'reading' ? 0 : -1}">阅读</button>
          <button id="profile-tab-exam" class="profile-tab" type="button" role="tab" data-profile-tab="exam" aria-controls="profile-panel-exam" aria-selected="${this.activePanel === 'exam'}" tabindex="${this.activePanel === 'exam' ? 0 : -1}">真题</button>
        </div>
        <div id="profile-panel-reading" class="profile-panel" role="tabpanel" data-profile-panel="reading" aria-labelledby="profile-tab-reading" ${this.activePanel === 'reading' ? '' : 'hidden'}>
          ${this.renderReadingPanel()}
        </div>
        <div id="profile-panel-exam" class="profile-panel" role="tabpanel" data-profile-panel="exam" aria-labelledby="profile-tab-exam" ${this.activePanel === 'exam' ? '' : 'hidden'}>
          ${this.renderExamPanel(this.examOverview)}
        </div>
      </section>`;
    this.bindEvents();
  },

  buildReadingModel({ articles, learnWords, vocabWords, readingStats }) {
    const reading = buildReadingAnalytics({ articles, readingStats });
    const learnedWords = learnWords.filter(word => word.reviewCount > 0).length;
    const masteredWords = learnWords.filter(word => word.interval >= 21).length;
    return {
      reading, articles, learnWords,
      favorites: articles.filter(article => article.favorite).length,
      learnedWords,
      masteredWords,
      learningWords: Math.max(0, learnedWords - masteredWords),
      newWords: learnWords.filter(word => !word.reviewCount).length,
      dueWords: SpacedRepetition.getDueCount(learnWords),
      vocabularyCount: vocabWords.length
    };
  },

  renderReadingPanel() {
    const model = this.readingModel;
    const reading = model.reading;
    return `
      <div class="profile-overview-grid">
        ${metric(reading.effectiveReadingCount, '有效阅读')}
        ${metric(this.formatDuration(reading.totalSeconds), '总时长')}
        ${metric(reading.averageWpm, '平均速度', ' WPM')}
        ${metric(reading.streak, '连续天数', ' 天')}
      </div>
      <div class="profile-dashboard-grid">
        <section class="profile-data-card profile-trend-card">
          <div class="profile-section-heading"><div><p class="profile-kicker">READING RHYTHM</p><h2>阅读趋势</h2></div>
            <div class="trend-toggle" aria-label="阅读趋势范围">
              <button type="button" data-trend-mode="week" class="trend-toggle-btn ${this.trendMode === 'week' ? 'active' : ''}">近 7 天</button>
              <button type="button" data-trend-mode="month" class="trend-toggle-btn ${this.trendMode === 'month' ? 'active' : ''}">月度</button>
            </div>
          </div>
          ${reading.recentReadings.length ? this.renderSpeedTrend(reading.recentReadings) : '<p class="profile-empty-copy">完成一次有效阅读后，这里会出现你的节奏变化。</p>'}
        </section>
        <section class="profile-data-card"><p class="profile-kicker">READING BEHAVIOR</p><h2>阅读行为</h2><div class="profile-detail-list">
          ${this.detail('累计词数', reading.totalWords.toLocaleString())}${this.detail('查词数', reading.totalLookups)}${this.detail('资料库文章数', reading.libraryArticleCount)}${this.detail('有效阅读次数', reading.effectiveReadingCount)}${this.detail('读过文章数', reading.distinctReadArticleCount)}${this.detail('最近 30 天有效阅读', reading.recent30EffectiveReadingCount)}${this.detail('收藏文章', model.favorites)}
        </div></section>
        <section class="profile-data-card"><p class="profile-kicker">VOCABULARY</p><h2>词汇成长</h2><div class="profile-detail-list">
          ${this.detail('学习中', model.learningWords)}${this.detail('已掌握', model.masteredWords)}${this.detail('新词', model.newWords)}${this.detail('待复习', model.dueWords)}${this.detail('生词本', model.vocabularyCount)}
        </div><div class="profile-card-actions"><a href="#/vocab">打开生词本</a>${model.dueWords ? `<a href="#/flashcard">复习 ${model.dueWords} 个词</a>` : ''}</div></section>
        <section class="profile-data-card"><p class="profile-kicker">DIFFICULTY</p><h2>难度分布</h2><div class="stats-diff-bars">
          ${this.renderDiffBar('四级', reading.difficultyDistribution.cet4, reading.effectiveReadingCount, 'cet4')}
          ${this.renderDiffBar('六级', reading.difficultyDistribution.cet6, reading.effectiveReadingCount, 'cet6')}
          ${this.renderDiffBar('考研英语一', reading.difficultyDistribution.kaoyan1, reading.effectiveReadingCount, 'kaoyan1')}
          ${this.renderDiffBar('考研英语二', reading.difficultyDistribution.kaoyan2, reading.effectiveReadingCount, 'kaoyan2')}
          ${this.renderDiffBar('考研通用', reading.difficultyDistribution['kaoyan-general'], reading.effectiveReadingCount, 'graduate')}
        </div></section>
        <section class="profile-data-card profile-recent-card"><p class="profile-kicker">RECENT READING</p><h2>最近阅读</h2>
          ${reading.recentReadings.length ? this.renderRecentArticles(reading.recentReadings.slice(0, 5)) : '<p class="profile-empty-copy">还没有有效阅读记录。</p>'}
        </section>
      </div>`;
  },

  renderExamPanel(overview) {
    const totals = overview.totals;
    const review = overview.review;
    const accuracy = totals.objectiveAccuracy === null ? '—' : `${totals.objectiveAccuracy}%`;
    return `
      <div class="profile-exam-toolbar">
        <div><p class="profile-kicker">EXAM PRACTICE</p><h2>真题表现</h2></div>
        <label class="profile-year-select"><span>题库</span><select data-exam-bank-filter>
          <option value="">全部</option><option value="builtin_kaoyan_en1" ${this.selectedExamBank === 'builtin_kaoyan_en1' ? 'selected' : ''}>考研英语一</option><option value="builtin_cet4" ${this.selectedExamBank === 'builtin_cet4' ? 'selected' : ''}>英语四级</option>
        </select></label>
<label class="profile-year-select"><span>统计范围</span><select data-exam-year-filter>
          <option value="">全部年份</option>${overview.availableYears.map(year => `<option value="${year}" ${Number(this.selectedExamYear) === year ? 'selected' : ''}>${year}</option>`).join('')}
        </select></label>
      </div>
      ${overview.status === 'year_unavailable' ? '<div class="profile-notice">该年份尚未安装或没有可用题包，请选择其他年份。</div>' : ''}
      <div class="profile-overview-grid profile-exam-performance">
        ${metric(totals.completedAttempts, '完成练习')}${metric(accuracy, '客观题正确率')}${metric(totals.objectiveAnswered, '客观题作答')}${metric(this.formatDuration(Math.round(totals.activeDurationMs / 1000)), '有效做题时长')}
      </div>
      <div class="profile-dashboard-grid">
        <section class="profile-data-card profile-trend-card"><p class="profile-kicker">RECENT SUBMISSIONS</p><h2>最近提交趋势</h2>${this.renderExamTrend(overview.trend)}</section>
        <section class="profile-data-card"><p class="profile-kicker">BY SECTION</p><h2>各题型表现</h2><div class="profile-type-list">${overview.byType.map(row => this.renderTypeRow(row)).join('')}</div><div class="profile-translation-row"><span>翻译完成</span><strong>${totals.translationSegments} 段</strong><small>不计入客观题正确率</small></div></section>
        <section class="profile-data-card"><p class="profile-kicker">REVIEW HEALTH</p><h2>复习状态</h2><div class="profile-detail-list">${this.detail('活跃错题', review.activeWrong)}${this.detail('最长未复习', `${Math.floor((review.longestUnreviewedMs || 0) / 86400000)} 天`)}${this.detail('累计复习次数', review.completedReviewCount)}${this.detail('已掌握错题', review.masteredWrong)}${this.detail('翻译待复习', review.translationNeedsReview)}</div><div class="profile-card-actions"><a href="#/exam/review">进入错题复习</a></div></section>
        <section class="profile-data-card profile-recent-card"><p class="profile-kicker">RECENT PRACTICE</p><h2>最近做题</h2>${this.renderRecentAttempts(overview.recentAttempts)}</section>
      </div>`;
  },

  detail(label, value) { return `<div><span>${label}</span><strong>${value}</strong></div>`; },

  renderTypeRow(row) {
    const accuracy = row.accuracy === null ? '暂无作答' : `${row.accuracy}%`;
    return `<div class="profile-type-row"><div><strong>${row.label}</strong><span>${row.answered} 题</span></div><b>${accuracy}</b></div>`;
  },

  renderExamTrend(rows) {
    if (!rows.length) return '<p class="profile-empty-copy">提交练习后，这里会显示近期正确率和用时。</p>';
    const maxAttempts = Math.max(...rows.map(row => row.attempts), 1);
    return `<div class="profile-exam-trend">${rows.slice(-7).map(row => `<div class="profile-trend-column"><span>${row.accuracy === null ? '—' : `${row.accuracy}%`}</span><i style="height:${Math.max(12, row.attempts / maxAttempts * 100)}%"></i><small>${row.date.slice(5)}</small></div>`).join('')}</div>`;
  },

  renderRecentAttempts(rows) {
    if (!rows.length) return '<p class="profile-empty-copy">还没有做题记录。可从真题训练开始。</p><div class="profile-card-actions"><a href="#/exam">进入真题训练</a></div>';
    return `<div class="profile-attempt-list">${rows.map(item => {
      const href = item.status === 'submitted' ? `#/exam/result/${encodeURIComponent(item.attemptId)}` : `#/exam/practice/${encodeURIComponent(item.attemptId)}`;
      return `<a href="${href}" class="profile-attempt-row"><span><strong>${item.examLabel && !this.selectedExamBank ? esc(item.examLabel) + ' · ' : ''}${item.year || '—'} · ${esc(item.unitTitle)}</strong><small>${item.status === 'submitted' ? '已提交' : '继续练习'} · ${this.formatDuration(Math.round(item.activeDurationMs / 1000))}</small></span><b>${item.objectiveAccuracy === null ? '—' : `${item.objectiveAccuracy}%`}</b></a>`;
    }).join('')}</div>`;
  },

  bindEvents() {
    if (!this.container?.querySelectorAll) return;
    this._abortController?.abort();
    const controller = new AbortController();
    this._abortController = controller;
    const signal = controller.signal;
    this.container.querySelectorAll('[data-profile-tab]').forEach(tab => {
      tab.addEventListener('click', () => this.activatePanel(tab.dataset.profileTab), { signal });
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const next = tab.dataset.profileTab === 'reading' ? 'exam' : 'reading';
        this.activatePanel(next, true);
      }, { signal });
    });
    this.container.querySelectorAll('[data-trend-mode]').forEach(button => button.addEventListener('click', () => {
      this.trendMode = button.dataset.trendMode;
      const panel = this.container.querySelector('[data-profile-panel="reading"]');
      panel.innerHTML = this.renderReadingPanel();
      this.bindEvents();
    }, { signal }));
    this.container.querySelector('[data-exam-bank-filter]')?.addEventListener('change', event => this.setExamBank(event.target.value), { signal });
    this.container.querySelector('[data-exam-year-filter]')?.addEventListener('change', event => this.setExamYear(event.target.value), { signal });
  },

  activatePanel(panel, focus = false) {
    this.activePanel = panel;
    this.container.querySelectorAll('[data-profile-tab]').forEach(tab => {
      const selected = tab.dataset.profileTab === panel;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    });
    this.container.querySelectorAll('[data-profile-panel]').forEach(item => { item.hidden = item.dataset.profilePanel !== panel; });
  },

  async setExamBank(value) {
    this.selectedExamBank = value || '';
    const panel = this.container.querySelector('[data-profile-panel="exam"]');
    if (!panel) return;
    panel.setAttribute('aria-busy', 'true');
    this.examOverview = await this.examProvider.getOverview({ year: this.selectedExamYear, bankId: this.selectedExamBank || null });
    panel.innerHTML = this.renderExamPanel(this.examOverview);
    panel.removeAttribute('aria-busy');
  },

  async setExamYear(value) {
    this.selectedExamYear = value ? Number(value) : null;
    const panel = this.container.querySelector('[data-profile-panel="exam"]');
    panel.setAttribute('aria-busy', 'true');
    this.examOverview = await this.examProvider.getOverview({ year: this.selectedExamYear, bankId: this.selectedExamBank || null });
    panel.innerHTML = this.renderExamPanel(this.examOverview);
    panel.removeAttribute('aria-busy');
    this.bindEvents();
  },

  cleanup() {
    this._abortController?.abort();
    this._abortController = null;
  },

  emptyExamOverview() {
    return { status: 'unavailable', availableYears: [], totals: { completedAttempts: 0, objectiveAccuracy: null, objectiveAnswered: 0, translationSegments: 0, activeDurationMs: 0 }, byType: [], trend: [], review: { activeWrong: 0, longestUnreviewedMs: 0, completedReviewCount: 0, masteredWrong: 0, translationNeedsReview: 0 }, recentAttempts: [] };
  },

  renderSpeedTrend(stats) {
    const groups = this.trendMode === 'week' ? this.groupByDay(stats, 7) : this.groupByMonth(stats, 12);
    const maxMinutes = Math.max(...groups.map(group => group.minutes), 1);
    return `<div class="profile-reading-trend">${groups.map(group => `<div class="profile-trend-column"><span>${group.minutes}m</span><i style="height:${Math.max(8, group.minutes / maxMinutes * 100)}%"></i><small>${group.label}</small></div>`).join('')}</div>`;
  },

  groupByDay(stats, count) {
    const now = new Date();
    return Array.from({ length: count }, (_, index) => {
      const offset = count - index - 1;
      const day = new Date(now); day.setDate(day.getDate() - offset); day.setHours(0, 0, 0, 0);
      const end = new Date(day); end.setDate(end.getDate() + 1);
      const seconds = stats.filter(item => item.createdAt >= day.getTime() && item.createdAt < end.getTime()).reduce((sum, item) => sum + (item.elapsed || 0), 0);
      return { label: offset === 0 ? '今天' : `${day.getMonth() + 1}/${day.getDate()}`, minutes: Math.round(seconds / 60) };
    });
  },

  groupByMonth(stats, count) {
    const now = new Date();
    return Array.from({ length: count }, (_, index) => {
      const offset = count - index - 1;
      const start = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - offset + 1, 1);
      const seconds = stats.filter(item => item.createdAt >= start.getTime() && item.createdAt < end.getTime()).reduce((sum, item) => sum + (item.elapsed || 0), 0);
      return { label: `${start.getMonth() + 1}月`, minutes: Math.round(seconds / 60) };
    });
  },

  formatDuration(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    if (value < 60) return `${Math.round(value)} 秒`;
    if (value < 3600) return `${Math.floor(value / 60)} 分钟`;
    return `${Math.floor(value / 3600)} 小时 ${Math.floor(value % 3600 / 60)} 分钟`;
  },

  renderDiffBar(label, count, total, cls) {
    const pct = total > 0 ? Math.round(count / total * 100) : 0;
    return `<div class="diff-bar-row"><span class="diff-bar-label"><span class="badge badge-${cls}">${label}</span></span><div class="diff-bar-track"><div class="diff-bar-fill diff-bar-${cls}" style="width:${pct}%"></div></div><span class="diff-bar-count">${count} 篇 (${pct}%)</span></div>`;
  },

  renderRecentArticles(articles) {
    return `<div class="profile-reading-list">${articles.map(article => `<a class="recent-article" href="#/reading/${article.id}"><span><strong>${esc(article.title)}</strong><small>${DIFFICULTY_LABELS[article.difficulty] || article.difficulty}</small></span><time>${formatDate(article.createdAt)}</time></a>`).join('')}</div>`;
  }
};

window.StatsView = StatsView;
