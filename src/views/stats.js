/**
 * Learning profile — a calm editorial surface for reading progress.
 */

import { DB } from '../db.js';
import { DIFFICULTY_LABELS, formatDate, esc } from '../helpers.js';
import { SpacedRepetition } from '../spaced-repetition.js';
import { buildReadingAnalytics } from '../reading-analytics.mjs';

const metric = (value, label, suffix = '') => `
  <article class="profile-metric">
    <strong>${value}${suffix}</strong><span>${label}</span>
  </article>`;

export const StatsView = {
  activePanel: 'reading',
  trendMode: 'week',
  container: null,
  readingModel: null,
  _abortController: null,
  _preloadedModel: null,

  async _loadDashboardModel() {
    const [articles, learnWords, readingStats] = await Promise.all([
      DB.getAllArticles(), DB.getAllLearnWords(), DB.getAllReadingStats()
    ]);
    const readingModel = this.buildReadingModel({ articles, learnWords, readingStats });
    return { readingModel };
  },

  async preloadData() {
    this._preloadedModel = await this._loadDashboardModel();
    return this._preloadedModel;
  },

  async render(container) {
    this.cleanup();
    this.container = container;
    const model = this._preloadedModel || await this._loadDashboardModel();
    this._preloadedModel = null;
    this.readingModel = model.readingModel;

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
        </div>
        <div id="profile-panel-reading" class="profile-panel" role="tabpanel" data-profile-panel="reading" aria-labelledby="profile-tab-reading" ${this.activePanel === 'reading' ? '' : 'hidden'}>
          ${this.renderReadingPanel()}
        </div>
      </section>`;
    this.bindEvents();
  },

  buildReadingModel({ articles, learnWords, readingStats }) {
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
      vocabularyCount: learnWords.length
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
          ${this.detail('学习中', model.learningWords)}${this.detail('已掌握', model.masteredWords)}${this.detail('新词', model.newWords)}${this.detail('待复习', model.dueWords)}${this.detail('词汇总数', model.vocabularyCount)}
        </div><div class="profile-card-actions"><a href="#/vocab">打开我的词汇</a>${model.dueWords ? `<a href="#/flashcard">复习 ${model.dueWords} 个词</a>` : ''}</div></section>
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


  detail(label, value) { return `<div><span>${label}</span><strong>${value}</strong></div>`; },




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
        const next = 'reading';
        this.activatePanel(next, true);
      }, { signal });
    });
    this.container.querySelectorAll('[data-trend-mode]').forEach(button => button.addEventListener('click', () => {
      this.trendMode = button.dataset.trendMode;
      const panel = this.container.querySelector('[data-profile-panel="reading"]');
      panel.innerHTML = this.renderReadingPanel();
      this.bindEvents();
    }, { signal }));
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



  cleanup() {
    this._abortController?.abort();
    this._abortController = null;
  },

  deactivate() {
    this.cleanup();
  },

  activate(container) {
    if (container) this.container = container;
    this.bindEvents();
  },

  dispose() {
    this.cleanup();
    this.container = null;
    this.readingModel = null;
    this._preloadedModel = null;
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
