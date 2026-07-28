/**
 * Learn Words View
 * Manages imported vocabulary with SRS status display
 */

import { DB } from '../db.js';
import { SpacedRepetition } from '../spaced-repetition.js';
import { Dictionary } from '../dictionary.js';
import { esc } from '../helpers.js';
import { ensureSavedWordDefinition } from '../components/saved-word-definition.mjs';
import { WordStudyDetail } from '../components/word-study-detail.js';

export const LearnWordsView = {
  manageMode: false,
  filterMode: 'all',  // all | new | learning (includes relearning) | review | stable
  container: null,

  // Render learn words view
  async render(container) {
    this.container = container;
    const words = await DB.getAllLearnWords();
    const dueCount = SpacedRepetition.getDueCount(words);

    let cards = '';
    if (words.length === 0) {
      cards = `
        <div class="empty-state">
          <p>学习词库为空</p>
          <p>导入你学过的单词，AI 会在生成文章时自动使用它们帮助你复习。</p>
          <button class="btn btn-primary" onclick="WordImport.showModal()">导入单词</button>
        </div>`;
    } else {
      // Filter words
      const filtered = this.filterMode === 'all' ? words
        : words.filter(w => this.filterMode === 'learning'
          ? SpacedRepetition.getStatus(w) === 'learning' || SpacedRepetition.getStatus(w) === 'relearning'
          : SpacedRepetition.getStatus(w) === this.filterMode);

      const headerActions = this.manageMode
        ? `<button class="btn btn-danger btn-sm" onclick="LearnWordsView.clearAll()">清空全部</button>
           <button class="btn btn-outline btn-sm" onclick="LearnWordsView.toggleManage()">完成</button>`
        : `<button class="btn btn-outline btn-sm" onclick="WordImport.showModal()">继续导入</button>
           <button class="btn btn-outline btn-sm" onclick="LearnWordsView.toggleManage()">管理</button>`;

      // Stats
      const stats = {
        new: words.filter(w => SpacedRepetition.getStatus(w) === 'new').length,
        learning: words.filter(w => SpacedRepetition.getStatus(w) === 'learning' || SpacedRepetition.getStatus(w) === 'relearning').length,
        review: words.filter(w => SpacedRepetition.getStatus(w) === 'review').length,
        stable: words.filter(w => SpacedRepetition.isStable(w)).length
      };

      cards = `
        <div class="learn-words-header">
          <span>共 ${words.length} 个单词</span>
          <div>${headerActions}</div>
        </div>

        ${dueCount > 0 ? `
        <div class="due-reminder due-reminder-inline">
          📢 ${dueCount} 个单词待复习
          <a href="#/flashcard" class="btn btn-primary btn-sm">开始复习</a>
        </div>` : ''}

        <div class="learn-words-stats">
          <button class="learn-words-stat-btn ${this.filterMode === 'all' ? 'active' : ''}"
            onclick="LearnWordsView.setFilter('all')">全部 ${words.length}</button>
          <button class="learn-words-stat-btn ${this.filterMode === 'new' ? 'active' : ''}"
            onclick="LearnWordsView.setFilter('new')">🆕 ${stats.new}</button>
          <button class="learn-words-stat-btn ${this.filterMode === 'learning' ? 'active' : ''}"
            onclick="LearnWordsView.setFilter('learning')">📖 ${stats.learning}</button>
          <button class="learn-words-stat-btn ${this.filterMode === 'review' ? 'active' : ''}"
            onclick="LearnWordsView.setFilter('review')">🔄 ${stats.review}</button>
          <button class="learn-words-stat-btn ${this.filterMode === 'stable' ? 'active' : ''}"
            onclick="LearnWordsView.setFilter('stable')">✅ 长期巩固 ${stats.stable}</button>
        </div>

        <div class="learn-words-grid">`;

      filtered.forEach(word => {
        const statusInfo = SpacedRepetition.getStatusDisplay(word);
        const deleteBtn = this.manageMode
          ? `<button class="learn-word-remove" onclick="LearnWordsView.deleteWord(${word.id})" title="移除">×</button>`
          : '';

        cards += `
          <div class="learn-word-chip ${this.manageMode ? 'manage-mode' : ''}" id="learn-word-${word.id}"
               ${!this.manageMode ? `onclick="LearnWordsView.showWordDetail(${word.id})"` : ''}>
            <span class="learn-word-status" style="color:${statusInfo.color}" title="${statusInfo.label}">${statusInfo.icon}</span>
            <span class="learn-word-text">${esc(word.word)}</span>
            ${word.interval ? `<span class="learn-word-interval">${SpacedRepetition.getIntervalText(word.interval)}</span>` : ''}
            ${deleteBtn}
          </div>`;
      });

      cards += '</div>';
    }

    container.innerHTML = `
      <section class="app-standard-page learn-words-container" aria-labelledby="learningWordsContentTitle">
        <h2 id="learningWordsContentTitle" class="sr-only">学习词库内容</h2>
        <header class="page-heading app-route-heading">
          <p class="page-eyebrow">03 / STUDY QUEUE</p>
          <h1 class="page-title">学习词库</h1>
          <p class="page-desc">导入你学过的单词；每次阅读会自然带它们回来。间隔重复会安排下一次相遇。</p>
        </header>
        ${cards}
      </section>`;
  },

  // Set filter mode
  setFilter(mode) {
    this.filterMode = mode;
    this.render(this.container);
  },

  // Toggle manage mode
  toggleManage() {
    this.manageMode = !this.manageMode;
    this.render(this.container);
  },

  // Delete a word
  async deleteWord(id) {
    await DB.deleteLearnWord(id);
    const words = await DB.getAllLearnWords();
    if (words.length === 0) {
      this.manageMode = false;
    }
    await this.render(this.container);
  },

  // Show word detail popup
  async showWordDetail(id) {
    const words = await DB.getAllLearnWords();
    let word = words.find(w => w.id === id);
    if (!word) return;

    const statusInfo = SpacedRepetition.getStatusDisplay(word);
    const intervalText = SpacedRepetition.getIntervalText(word.interval);

    word = await ensureSavedWordDefinition(word, {
      lookup: Dictionary.lookup.bind(Dictionary),
      update: DB.updateLearnWordDefinition.bind(DB)
    });
    WordStudyDetail.open({
      word: word.word,
      definition: word,
      sourceMeta: {
        eyebrow: 'STUDY NOTE',
        status: statusInfo,
        schedule: word.interval ? `下次复习间隔：${intervalText}` : ''
      }
    });
  },

  // Clear all words
  async clearAll() {
    if (!confirm('确定要清空所有学习单词吗？此操作不可撤销。')) return;
    await DB.clearLearnWords();
    this.manageMode = false;
    this.render(this.container);
  }
};

window.LearnWordsView = LearnWordsView;
