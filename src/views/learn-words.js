/**
 * Learn Words View
 * Manages imported vocabulary with SRS status display
 */

const LearnWordsView = {
  manageMode: false,
  filterMode: 'all',  // all | new | learning | review | mastered

  // Render learn words view
  async render(container) {
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
          <div class="learn-word-chip ${this.manageMode ? 'manage-mode' : ''}" id="learn-word-${word.id}">
            <span class="learn-word-status" style="color:${statusInfo.color}" title="${statusInfo.label}">${statusInfo.icon}</span>
            <span class="learn-word-text">${esc(word.word)}</span>
            ${word.interval ? `<span class="learn-word-interval">${SpacedRepetition.getIntervalText(word.interval)}</span>` : ''}
            ${deleteBtn}
          </div>`;
      });

      cards += '</div>';
    }

    container.innerHTML = `
      <div class="learn-words-container">
        <h1 class="page-title">学习词库</h1>
        <p class="page-desc">导入你学过的单词，每次生成文章时会自动融入这些单词帮助你复习。使用间隔重复算法自动调度复习。</p>
        ${cards}
      </div>`;
  },

  // Set filter mode
  setFilter(mode) {
    this.filterMode = mode;
    this.render(document.getElementById('app'));
  },

  // Toggle manage mode
  toggleManage() {
    this.manageMode = !this.manageMode;
    this.render(document.getElementById('app'));
  },

  // Delete a word
  async deleteWord(id) {
    await DB.deleteLearnWord(id);
    const el = document.getElementById(`learn-word-${id}`);
    if (el) el.remove();

    // Check if list is now empty
    const words = await DB.getAllLearnWords();
    if (words.length === 0) {
      this.manageMode = false;
      this.render(document.getElementById('app'));
    }
  },

  // Clear all words
  async clearAll() {
    if (!confirm('确定要清空所有学习单词吗？此操作不可撤销。')) return;
    await DB.clearLearnWords();
    this.manageMode = false;
    this.render(document.getElementById('app'));
  }
};
