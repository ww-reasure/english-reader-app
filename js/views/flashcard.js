/**
 * Flashcard View
 * Spaced repetition review mode for vocabulary
 */

const FlashcardView = {
  words: [],
  currentIndex: 0,
  rememberedCount: 0,

  // Render flashcard view
  async render(container) {
    const allWords = await DB.getAllWords();

    if (allWords.length === 0) {
      container.innerHTML = '<div class="flashcard-container"><div class="empty-state">生词本为空，先去阅读页面收藏单词吧！</div></div>';
      return;
    }

    // Shuffle words for review
    this.words = shuffleArray(allWords);
    this.currentIndex = 0;
    this.rememberedCount = 0;

    this.renderCard(container);
  },

  // Render a single flashcard
  renderCard(container) {
    if (this.currentIndex >= this.words.length) {
      this.renderResult(container);
      return;
    }

    const word = this.words[this.currentIndex];

    container.innerHTML = `
      <div class="flashcard-container">
        <div class="flashcard-progress">${this.currentIndex + 1} / ${this.words.length}</div>
        <div class="flashcard" onclick="this.classList.toggle('flipped')">
          <div class="flashcard-front">
            <div class="flashcard-word">${esc(word.word)}</div>
            ${word.phonetic ? `<div class="flashcard-phonetic">[${esc(word.phonetic)}]</div>` : ''}
            <div class="flashcard-hint">点击翻转</div>
          </div>
          <div class="flashcard-back">
            <div class="flashcard-translation">${esc(word.translation)}</div>
            <div class="flashcard-hint">点击翻回</div>
          </div>
        </div>
        <div class="flashcard-actions">
          <button class="btn btn-danger" onclick="FlashcardView.next(false)">继续</button>
          <button class="btn btn-primary" onclick="FlashcardView.next(true)">记住了</button>
        </div>
      </div>`;
  },

  // Handle next card
  async next(remembered) {
    if (remembered) {
      this.rememberedCount++;
      await DB.deleteWord(this.words[this.currentIndex].id);
    }

    this.currentIndex++;
    this.renderCard(document.getElementById('app'));
  },

  // Render completion result
  renderResult(container) {
    container.innerHTML = `
      <div class="flashcard-container">
        <div class="flashcard-result">
          <h2>复习完成！</h2>
          <p>共 ${this.words.length} 个单词，记住了 ${this.rememberedCount} 个</p>
          <div style="display:flex;gap:12px;justify-content:center">
            <a href="#/vocab" class="btn btn-primary">返回生词本</a>
            <button class="btn btn-outline" onclick="FlashcardView.render(document.getElementById('app'))">再来一轮</button>
          </div>
        </div>
      </div>`;
  }
};
