/**
 * Reading View
 * Handles article reading with word lookup and translation toggle
 */

const ReadingView = {
  // Clean up event listeners
  cleanup() {
    if (this._globalClickHandler) {
      document.removeEventListener('click', this._globalClickHandler);
      this._globalClickHandler = null;
    }
    if (this._ttsClickHandler) {
      document.removeEventListener('click', this._ttsClickHandler);
      this._ttsClickHandler = null;
    }
  },

  // Render reading view for an article
  async render(container, articleId) {
    this.cleanup();
    const article = await DB.getArticle(articleId);

    if (!article) {
      container.innerHTML = '<div class="empty-state">文章不存在</div>';
      return;
    }

    const enParas = article.content.split(/\n\n+/).filter(p => p.trim());
    const zhParas = (article.translation || '').split(/\n\n+/).filter(p => p.trim());
    const difficultyLabel = DIFFICULTY_LABELS[article.difficulty] || article.difficulty;

    let parasHTML = '';
    enParas.forEach((p, i) => {
      const hasTranslation = zhParas[i] && zhParas[i].trim();
      parasHTML += `
        <div class="paragraph-pair">
          <p class="en-paragraph">${esc(p.trim())}</p>
          ${hasTranslation ? `<button class="btn-paragraph-translate" onclick="ReadingView.toggleParagraph(this)">译</button>` : ''}
          ${hasTranslation ? `<p class="zh-paragraph" style="display:none">${esc(zhParas[i].trim())}</p>` : ''}
        </div>`;
    });

    container.innerHTML = `
      <div class="reading-container">
        <div class="reading-header">
          <h1 class="reading-title">${esc(article.title)}</h1>
          <div class="reading-meta">
            <span class="badge badge-${article.difficulty}">${difficultyLabel}</span>
            <span class="meta-item">${article.wordCount} 词</span>
            <span class="meta-item">${esc(article.topic)}</span>
          </div>
          <div class="reading-actions">
            <button class="btn btn-outline" onclick="ReadingView.toggleTranslation()">显示翻译</button>
            <a href="#/history" class="btn btn-outline">返回历史</a>
          </div>
          <div class="reading-hint">单击任意单词查看翻译，长按选中句子可问 AI</div>
        </div>
        <div id="articleBody" class="article-body">${parasHTML}</div>
      </div>
      <div id="wordTooltip" class="word-tooltip" style="display:none"></div>`;

    this.initInteractions();
  },

  // Initialize reading view interactions
  initInteractions() {
    const articleBody = document.getElementById('articleBody');
    if (!articleBody) return;

    // Global click handler: dismiss tooltip when clicking outside
    this._globalClickHandler = (e) => {
      const tooltip = document.getElementById('wordTooltip');
      if (!tooltip || tooltip.style.display === 'none') return;
      if (tooltip.contains(e.target)) return;
      Tooltip.hide();
      AIAnalysis.hideButton();
    };
    document.addEventListener('click', this._globalClickHandler);

    // Click to lookup word
    articleBody.addEventListener('click', async (e) => {
      const tooltip = document.getElementById('wordTooltip');
      if (tooltip?.contains(e.target)) return;
      if (e.target.id === 'aiAnalyzeBtn') return;

      const word = Tooltip.getWordAtPoint(e);
      if (!word || word.length < 2) return;

      // Stop propagation so global handler doesn't immediately hide the new tooltip
      e.stopPropagation();

      // Hide previous tooltip before showing new one
      Tooltip.hide();
      AIAnalysis.hideButton();

      Tooltip.showLoading(e.clientX, e.clientY);

      try {
        const data = await Dictionary.lookup(word);
        Tooltip.show(e.clientX, e.clientY, data);
      } catch {
        Tooltip.hide();
      }
    });

    // TTS button click (event delegation)
    this._ttsClickHandler = (e) => {
      if (e.target.classList.contains('btn-speak')) {
        const word = e.target.getAttribute('data-word');
        if (word) TTS.speak(word);
      }
    };
    document.addEventListener('click', this._ttsClickHandler);

    // AI analysis selection detection
    AIAnalysis.initSelectionDetection(articleBody);
  },

  // Toggle all translations visibility
  toggleTranslation() {
    const zhParas = document.querySelectorAll('.zh-paragraph');
    const showing = zhParas[0]?.style.display === 'none';

    zhParas.forEach(p => p.style.display = showing ? 'block' : 'none');

    // Update all paragraph translate buttons
    document.querySelectorAll('.btn-paragraph-translate').forEach(btn => {
      btn.textContent = showing ? '隐' : '译';
      btn.classList.toggle('active', showing);
    });

    const toggleBtn = document.querySelector('.reading-actions .btn-outline');
    if (toggleBtn) toggleBtn.textContent = showing ? '隐藏全部翻译' : '显示全部翻译';
  },

  // Toggle single paragraph translation
  toggleParagraph(btn) {
    const zhPara = btn.nextElementSibling;
    if (!zhPara || !zhPara.classList.contains('zh-paragraph')) return;

    const isVisible = zhPara.style.display !== 'none';
    zhPara.style.display = isVisible ? 'none' : 'block';
    btn.textContent = isVisible ? '译' : '隐';
    btn.classList.toggle('active', !isVisible);
  }
};
