/**
 * Flashcard View
 * Spaced repetition review mode using SM-2 algorithm
 * Uses learnWords table with SRS scheduling
 */

const FlashcardView = {
  words: [],
  currentIndex: 0,
  ratingCounts: { 1: 0, 3: 0, 5: 0 },

  // Render flashcard view
  async render(container) {
    const allWords = await DB.getAllLearnWords();
    const dueWords = SpacedRepetition.getDueWords(allWords);

    if (dueWords.length === 0) {
      const totalWords = allWords.length;
      const masteredCount = allWords.filter(w => SpacedRepetition.getStatus(w) === 'mastered').length;
      container.innerHTML = `
        <div class="flashcard-container">
          <div class="empty-state">
            <p>🎉 暂时没有需要复习的单词</p>
            ${totalWords > 0 ? `<p>共 ${totalWords} 个单词，${masteredCount} 个已掌握</p>` : ''}
            <p>去阅读页面收藏新单词，或导入单词到学习词库。</p>
            <div style="display:flex;gap:12px;justify-content:center;margin-top:16px">
              <a href="#/chat" class="btn btn-primary">去阅读</a>
              <a href="#/learn-words" class="btn btn-outline">学习词库</a>
            </div>
          </div>
        </div>`;
      return;
    }

    this.words = dueWords;
    this.currentIndex = 0;
    this.ratingCounts = { 1: 0, 3: 0, 5: 0 };

    this.renderCard(container);
  },

  // Render a single flashcard
  renderCard(container) {
    if (this.currentIndex >= this.words.length) {
      this.renderResult(container);
      return;
    }

    const word = this.words[this.currentIndex];
    const statusInfo = SpacedRepetition.getStatusDisplay(word);
    const progress = Math.round((this.currentIndex / this.words.length) * 100);

    container.innerHTML = `
      <div class="flashcard-container">
        <div class="flashcard-progress">
          ${this.currentIndex + 1} / ${this.words.length}
          <span class="flashcard-status-badge" style="background:${statusInfo.color}">${statusInfo.icon} ${statusInfo.label}</span>
        </div>
        <div class="flashcard-progress-bar">
          <div class="flashcard-progress-fill" style="width:${progress}%"></div>
        </div>
        <div class="flashcard" onclick="this.classList.toggle('flipped')">
          <div class="flashcard-front">
            <div class="flashcard-word">${esc(word.word)}</div>
            ${word.phonetic ? `<div class="flashcard-phonetic">[${esc(word.phonetic)}]</div>` : ''}
            <div class="flashcard-hint">点击查看释义</div>
          </div>
          <div class="flashcard-back">
            <div class="flashcard-translation">${esc(word.translation || '暂无翻译')}</div>
            ${word.interval ? `<div class="flashcard-interval">当前间隔：${SpacedRepetition.getIntervalText(word.interval)}</div>` : ''}
            <div class="flashcard-hint">根据记忆程度选择评分</div>
          </div>
        </div>
        <div class="flashcard-actions">
          ${SpacedRepetition.ratings.map(r => `
            <button class="flashcard-rating-btn" style="border-color:${r.color};color:${r.color}"
              onclick="FlashcardView.rate(${r.quality})" title="${r.desc}">
              ${r.label}
            </button>
          `).join('')}
        </div>
        <div class="flashcard-skip">
          <button class="btn btn-outline btn-sm" onclick="FlashcardView.skip()">跳过</button>
        </div>
      </div>`;
  },

  // Rate current word
  async rate(quality) {
    const word = this.words[this.currentIndex];

    // Calculate next review using SM-2
    const srsData = SpacedRepetition.calculateNext(word, quality);

    // Update in database
    await DB.updateLearnWordSRS(word.id, srsData);

    // Track rating
    this.ratingCounts[quality] = (this.ratingCounts[quality] || 0) + 1;

    // Next card
    this.currentIndex++;
    this.renderCard(document.getElementById('app'));
  },

  // Skip current word (don't rate)
  skip() {
    this.currentIndex++;
    this.renderCard(document.getElementById('app'));
  },

  // Render completion result
  renderResult(container) {
    const total = this.ratingCounts[1] + this.ratingCounts[3] + this.ratingCounts[5];
    const accuracy = total > 0 ? Math.round((this.ratingCounts[5] + this.ratingCounts[3]) / total * 100) : 0;

    container.innerHTML = `
      <div class="flashcard-container">
        <div class="flashcard-result">
          <h2>📊 复习完成！</h2>
          <div class="flashcard-result-stats">
            <div class="flashcard-result-stat">
              <span class="flashcard-result-num">${total}</span>
              <span class="flashcard-result-label">总复习</span>
            </div>
            <div class="flashcard-result-stat">
              <span class="flashcard-result-num" style="color:#27ae60">${this.ratingCounts[5]}</span>
              <span class="flashcard-result-label">认识</span>
            </div>
            <div class="flashcard-result-stat">
              <span class="flashcard-result-num" style="color:#f39c12">${this.ratingCounts[3]}</span>
              <span class="flashcard-result-label">模糊</span>
            </div>
            <div class="flashcard-result-stat">
              <span class="flashcard-result-num" style="color:#e74c3c">${this.ratingCounts[1]}</span>
              <span class="flashcard-result-label">忘记</span>
            </div>
          </div>
          <div class="flashcard-result-accuracy">
            正确率：${accuracy}%
          </div>
          <p class="flashcard-result-hint">
            ${accuracy >= 80 ? '💪 表现很好！继续保持。' : accuracy >= 50 ? '📖 还需要多复习，加油！' : '🔄 建议降低复习难度，循序渐进。'}
          </p>
          <div style="display:flex;gap:12px;justify-content:center;margin-top:16px">
            <a href="#/chat" class="btn btn-primary">返回阅读</a>
            <a href="#/learn-words" class="btn btn-outline">词库管理</a>
            <button class="btn btn-outline" onclick="FlashcardView.render(document.getElementById('app'))">再来一轮</button>
          </div>
        </div>
      </div>`;
  }
};
