/**
 * Vocabulary View
 * Displays and manages saved words with manage mode
 */

import { DB } from '../db.js';
import { Dictionary } from '../dictionary.js';
import { esc } from '../helpers.js';
import { formatPhonetic, getDefinitionDisplayLines, getSavableTranslation } from '../components/definition-trust.mjs';
import { ensureSavedWordDefinition } from '../components/saved-word-definition.mjs';
import { WordStudyDetail } from '../components/word-study-detail.js';

function renderDefinitionPreview(word) {
  const primary = getDefinitionDisplayLines(word)[0];
  return primary ? `${primary.label} ${primary.glossZh}` : getSavableTranslation(word) || '待重新查询';
}

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
        <div class="vocab-list" data-vocab-grid="vocab">`;

      words.forEach(word => {
        const deleteBtn = this.manageMode
          ? `<button class="learn-word-remove" onclick="VocabularyView.deleteWord(${word.id})" title="移除">×</button>`
          : '';

        cards += `
          <div class="vocab-card ${this.manageMode ? 'manage-mode' : ''}" id="vocab-${word.id}"
               ${!this.manageMode ? `onclick="VocabularyView.showWordDetail(${word.id})"` : ''}>
            <div class="vocab-word">
              <span class="word">${esc(word.word)}</span>
              ${formatPhonetic(word.phonetic) ? `<span class="phonetic">${esc(formatPhonetic(word.phonetic))}</span>` : ''}
            </div>
            <div class="vocab-translation">${esc(renderDefinitionPreview(word))}</div>
            ${deleteBtn}
          </div>`;
      });

      cards += '</div>';
    }

    container.innerHTML = `
      <section class="app-standard-page vocab-container" aria-labelledby="vocabularyContentTitle">
        <h2 id="vocabularyContentTitle" class="sr-only">词汇学习内容</h2>
        <header class="page-heading app-route-heading">
          <p class="page-eyebrow">03 / WORD NOTES</p>
          <h1 class="page-title">我的生词本</h1>
          <p class="page-desc">把阅读时停下来的词，整理成以后会再遇见的笔记。</p>
        </header>
        ${cards}
      </section>`;
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

  // Show word detail popup
  async showWordDetail(id) {
    const words = await DB.getAllWords();
    let word = words.find(w => w.id === id);
    if (!word) return;

    word = await ensureSavedWordDefinition(word, {
      lookup: Dictionary.lookup.bind(Dictionary),
      update: DB.updateWordDefinition.bind(DB)
    });
    WordStudyDetail.open({
      word: word.word,
      definition: word,
      sourceMeta: {
        eyebrow: 'WORD NOTE',
        originLabel: '我的生词本',
        contextSentence: word.contextSentence || ''
      }
    });
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

window.VocabularyView = VocabularyView;
