/**
 * Learn Words View
 * Manages imported vocabulary for smart review
 */

const LearnWordsView = {
  manageMode: false,

  // Render learn words view
  async render(container) {
    const words = await DB.getAllLearnWords();

    let cards = '';
    if (words.length === 0) {
      cards = `
        <div class="empty-state">
          <p>学习词库为空</p>
          <p>导入你学过的单词，AI 会在生成文章时自动使用它们帮助你复习。</p>
          <button class="btn btn-primary" onclick="WordImport.showModal()">导入单词</button>
        </div>`;
    } else {
      const headerActions = this.manageMode
        ? `<button class="btn btn-danger btn-sm" onclick="LearnWordsView.clearAll()">清空全部</button>
           <button class="btn btn-outline btn-sm" onclick="LearnWordsView.toggleManage()">完成</button>`
        : `<button class="btn btn-outline btn-sm" onclick="WordImport.showModal()">继续导入</button>
           <button class="btn btn-outline btn-sm" onclick="LearnWordsView.toggleManage()">管理</button>`;

      cards = `
        <div class="learn-words-header">
          <span>共 ${words.length} 个单词</span>
          <div>${headerActions}</div>
        </div>
        <div class="learn-words-grid">`;

      words.forEach(word => {
        const deleteBtn = this.manageMode
          ? `<button class="learn-word-remove" onclick="LearnWordsView.deleteWord(${word.id})" title="移除">×</button>`
          : '';

        cards += `
          <div class="learn-word-chip ${this.manageMode ? 'manage-mode' : ''}" id="learn-word-${word.id}">
            <span class="learn-word-text">${esc(word.word)}</span>
            ${deleteBtn}
          </div>`;
      });

      cards += '</div>';
    }

    container.innerHTML = `
      <div class="learn-words-container">
        <h1 class="page-title">学习词库</h1>
        <p class="page-desc">导入你学过的单词，每次生成文章时会自动融入这些单词帮助你复习。</p>
        ${cards}
      </div>`;
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
