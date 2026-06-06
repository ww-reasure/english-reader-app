/**
 * Vocabulary View
 * Displays and manages saved words
 */

const VocabularyView = {
  // Render vocabulary view
  async render(container) {
    const words = await DB.getAllWords();

    let cards = '';
    if (words.length === 0) {
      cards = '<div class="empty-state">还没有收藏单词。在阅读页面单击单词即可收藏！</div>';
    } else {
      words.forEach(word => {
        cards += `
          <div class="vocab-card" id="vocab-${word.id}">
            <div class="vocab-word">
              <span class="word">${esc(word.word)}</span>
              ${word.phonetic ? `<span class="phonetic">[${esc(word.phonetic)}]</span>` : ''}
            </div>
            <div class="vocab-translation">${esc(word.translation)}</div>
            <button class="btn btn-sm btn-danger" onclick="VocabularyView.deleteWord(${word.id})">移除</button>
          </div>`;
      });
    }

    const reviewBtn = words.length > 0 ? '<a href="#/flashcard" class="btn btn-primary btn-sm">开始复习</a>' : '';

    container.innerHTML = `
      <div class="vocab-container">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <h1 class="page-title" style="margin-bottom:0">我的生词本</h1>
          ${reviewBtn}
        </div>
        <div class="vocab-list">${cards}</div>
      </div>`;
  },

  // Delete a word
  async deleteWord(id) {
    await DB.deleteWord(id);
    const el = document.getElementById(`vocab-${id}`);
    if (el) el.remove();
  }
};
