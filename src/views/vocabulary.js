import { DB } from "../db.js";
import { esc } from "../helpers.js";
/**
 * Vocabulary View
 * Displays and manages saved words with manage mode
 */

export const VocabularyView = {
  manageMode: false,

  // Render vocabulary view
  async render(container) {
    const words = await DB.getAllWords();

    let cards = '';
    if (words.length === 0) {
      cards = '<div class="empty-state">还没有收藏单词。在阅读页面单击单词即可收藏！</div>';
    } else {
      const headerActions = this.manageMode
        ? `<button class="btn btn-danger btn-sm" onclick="VocabularyView.clearAll()">清空全部</button>
           <button class="btn btn-outline btn-sm" onclick="VocabularyView.toggleManage()">完成</button>`
        : `<a href="#/flashcard" class="btn btn-primary btn-sm">开始复习</a>
           <button class="btn btn-outline btn-sm" onclick="VocabularyView.toggleManage()">管理</button>`;

      cards = `
        <div class="learn-words-header">
          <span>共 ${words.length} 个单词</span>
          <div>${headerActions}</div>
        </div>
        <div class="vocab-list">`;

      words.forEach(word => {
        const deleteBtn = this.manageMode
          ? `<button class="learn-word-remove" onclick="VocabularyView.deleteWord(${word.id})" title="移除">×</button>`
          : '';

        cards += `
          <div class="vocab-card ${this.manageMode ? 'manage-mode' : ''}" id="vocab-${word.id}">
            <div class="vocab-word">
              <span class="word">${esc(word.word)}</span>
              ${word.phonetic ? `<span class="phonetic">[${esc(word.phonetic)}]</span>` : ''}
            </div>
            <div class="vocab-translation">${esc(word.translation)}</div>
            ${deleteBtn}
          </div>`;
      });

      cards += '</div>';
    }

    container.innerHTML = `
      <div class="vocab-container">
        <h1 class="page-title">我的生词本</h1>
        <div class="vocab-list">${cards}</div>
      </div>`;
  },

  // Toggle manage mode
  toggleManage() {
    this.manageMode = !this.manageMode;
    this.render(document.getElementById('app'));
  },

  // Delete a word
  async deleteWord(id) {
    await DB.deleteWord(id);
    const el = document.getElementById(`vocab-${id}`);
    if (el) el.remove();

    // Check if list is now empty
    const words = await DB.getAllWords();
    if (words.length === 0) {
      this.manageMode = false;
      this.render(document.getElementById('app'));
    }
  },

  // Clear all words
  async clearAll() {
    if (!confirm('确定要清空所有收藏单词吗？此操作不可撤销。')) return;
    const words = await DB.getAllWords();
    for (const w of words) {
      await DB.deleteWord(w.id);
    }
    this.manageMode = false;
    this.render(document.getElementById('app'));
  }
};
