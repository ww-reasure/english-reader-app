/**
 * Learn Words View
 * Manages imported vocabulary with SRS status display
 */

import { DB } from '../db.js';
import { SpacedRepetition } from '../spaced-repetition.js';
import { Dictionary } from '../dictionary.js';
import { AudioCache } from '../audio-cache.js';
import { Affixes } from '../affixes.js';
import { Examples } from '../examples.js';
import { esc } from '../helpers.js';

export const LearnWordsView = {
  manageMode: false,
  filterMode: 'all',  // all | new | learning | review | mastered
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
        : words.filter(w => SpacedRepetition.getStatus(w) === this.filterMode);

      const headerActions = this.manageMode
        ? `<button class="btn btn-danger btn-sm" onclick="LearnWordsView.clearAll()">清空全部</button>
           <button class="btn btn-outline btn-sm" onclick="LearnWordsView.toggleManage()">完成</button>`
        : `<button class="btn btn-outline btn-sm" onclick="WordImport.showModal()">继续导入</button>
           <button class="btn btn-outline btn-sm" onclick="LearnWordsView.toggleManage()">管理</button>`;

      // Stats
      const stats = {
        new: words.filter(w => SpacedRepetition.getStatus(w) === 'new').length,
        learning: words.filter(w => SpacedRepetition.getStatus(w) === 'learning').length,
        review: words.filter(w => SpacedRepetition.getStatus(w) === 'review').length,
        mastered: words.filter(w => SpacedRepetition.getStatus(w) === 'mastered').length
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
          <button class="learn-words-stat-btn ${this.filterMode === 'mastered' ? 'active' : ''}"
            onclick="LearnWordsView.setFilter('mastered')">✅ ${stats.mastered}</button>
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
    const word = words.find(w => w.id === id);
    if (!word) return;

    const statusInfo = SpacedRepetition.getStatusDisplay(word);
    const intervalText = SpacedRepetition.getIntervalText(word.interval);

    // Get translation and phonetic
    let translation = word.translation || '';
    let phonetic = word.phonetic || '';
    if (!translation) {
      try {
        const dictResult = await Dictionary.lookup(word.word);
        translation = dictResult.translation || '暂无翻译';
        phonetic = phonetic || dictResult.phonetic || '';
      } catch {
        translation = '暂无翻译';
      }
    }

    // Create modal overlay
    let overlay = document.getElementById('wordDetailOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'wordDetailOverlay';
      overlay.className = 'modal-overlay';
      overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;justify-content:center;align-items:center';
      document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
      <div class="modal word-detail-modal" role="dialog" aria-modal="true" aria-label="${esc(word.word)} 的学习详情">
        <header class="word-detail-head">
          <div>
            <p class="page-eyebrow">STUDY NOTE</p>
            <div class="word-detail-title">${esc(word.word)} <button class="btn-speak" data-word="${esc(word.word)}" aria-label="朗读 ${esc(word.word)}">听</button></div>
          </div>
          <span class="word-status-mark" style="--status-color:${statusInfo.color}">${statusInfo.icon} ${statusInfo.label}</span>
        </header>
        ${phonetic ? `<div class="word-detail-phonetic">[${esc(phonetic)}]</div>` : ''}
        <div class="word-detail-translation">${esc(translation)}</div>
        ${word.interval ? `<div class="word-detail-schedule">下次复习间隔：${intervalText}</div>` : ''}
        <div id="wordDetailExtras" class="word-detail-extras"><div class="text-muted">正在整理词根与例句…</div></div>
        <div class="modal-actions">
          <button class="btn" onclick="document.getElementById('wordDetailOverlay').style.display='none'">关闭笔记</button>
        </div>
      </div>`;

    overlay.style.display = 'flex';
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.style.display = 'none';
    };

    // Bind audio button
    const speakBtn = overlay.querySelector('.btn-speak');
    if (speakBtn) {
      speakBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.AudioCache) window.AudioCache.getAudio(word.word);
      });
    }

    // Load extras (word root + examples)
    this._loadWordExtras(word.word);
  },

  // Load word root analysis and examples
  async _loadWordExtras(word) {
    const el = document.getElementById('wordDetailExtras');
    if (!el) return;

    try {
      const [examples, rootAnalysis] = await Promise.all([
        Examples.getExamples(word).catch(() => []),
        Affixes.getAnalysis(word).catch(() => null)
      ]);

      let html = '';

      if (rootAnalysis) {
        if (rootAnalysis.breakdown) {
          html += `<div style="margin-bottom:8px"><span style="font-size:13px;color:var(--text-muted)">🔤 词根拆解</span><div style="margin-top:4px">${esc(rootAnalysis.breakdown)}</div></div>`;
        }
        if (rootAnalysis.memoryTip) {
          html += `<div style="margin-bottom:8px"><span style="font-size:13px;color:var(--text-muted)">💡 记忆法</span><div style="margin-top:4px">${esc(rootAnalysis.memoryTip)}</div></div>`;
        }
      }

      if (examples.length > 0) {
        html += `<div><span style="font-size:13px;color:var(--text-muted)">📝 例句</span>`;
        examples.forEach(ex => {
          html += `<div style="margin-top:4px;font-size:14px;color:var(--text-secondary)">• ${esc(ex)}</div>`;
        });
        html += '</div>';
      }

      el.innerHTML = html || '<div style="color:var(--text-muted);font-size:13px">暂无详情</div>';
    } catch {
      el.innerHTML = '';
    }
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
