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
    if (this._audioClickHandler) {
      document.removeEventListener('click', this._audioClickHandler);
      this._audioClickHandler = null;
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
            <button class="btn btn-outline" onclick="ReadingView.toggleFavorite(${article.id})" id="favBtn">${article.favorite ? '⭐' : '☆'} 收藏</button>
            <button class="btn btn-outline" onclick="ReadingView.toggleTranslation()">显示翻译</button>
            <a href="#/history" class="btn btn-outline">返回历史</a>
          </div>
          <div class="reading-timer-bar" id="timerBar" style="display:none">
            <span id="timerDisplay" class="timer-display">0:00</span>
            <div class="timer-progress"><div id="timerProgress" class="timer-progress-fill"></div></div>
            <span id="timerStatus" class="timer-status"></span>
          </div>
          <div class="reading-tools">
            <span class="reading-hint">单击单词查词，长按句子问 AI</span>
            <div class="timer-controls">
              <select id="timerSpeed" onchange="ReadingView.setTimerSpeed()">
                <option value="0">不限时</option>
                <option value="150">150 词/分</option>
                <option value="200">200 词/分</option>
                <option value="250">250 词/分</option>
              </select>
              <button class="btn btn-sm btn-outline" id="timerToggle" onclick="ReadingView.toggleTimer()" style="display:none">▶ 开始</button>
            </div>
          </div>
        </div>
        <div id="articleBody" class="article-body">${parasHTML}</div>
      </div>
      <div id="wordTooltip" class="word-tooltip" style="display:none"></div>`;

    this.initInteractions();

    // Preload audio for article words in background
    AudioCache.preloadWords(article.content).catch(() => {});
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

    // Audio button click (event delegation)
    this._audioClickHandler = (e) => {
      if (e.target.classList.contains('btn-speak')) {
        const word = e.target.getAttribute('data-word');
        if (word) AudioCache.getAudio(word);
      }
    };
    document.addEventListener('click', this._audioClickHandler);

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
  },

  // ===== Timer =====
  timer: null,

  setTimerSpeed() {
    const wpm = parseInt(document.getElementById('timerSpeed')?.value || 0);
    const toggleBtn = document.getElementById('timerToggle');
    const timerBar = document.getElementById('timerBar');

    if (wpm === 0) {
      // Disable timer
      if (this.timer) { this.timer.stop(); this.timer = null; }
      if (toggleBtn) toggleBtn.style.display = 'none';
      if (timerBar) timerBar.style.display = 'none';
      return;
    }

    // Create new timer
    const wordCount = document.querySelectorAll('.en-paragraph').length * 50; // rough estimate
    const article = document.querySelector('.reading-meta .meta-item');
    const actualWords = article ? parseInt(article.textContent) : wordCount;

    if (this.timer) this.timer.stop();
    this.timer = new CountdownTimer(actualWords, wpm);
    this.timer.onTick = (remaining, elapsed) => {
      const display = document.getElementById('timerDisplay');
      const progress = document.getElementById('timerProgress');
      const status = document.getElementById('timerStatus');
      if (display) display.textContent = this.timer.getDisplay();
      if (progress) progress.style.width = (this.timer.getProgress() * 100) + '%';
      if (status) {
        if (this.timer.isPaused) status.textContent = '⏸ 已暂停';
        else if (this.timer.isExpired()) status.textContent = '⏱ 已超时';
        else status.textContent = '';
      }
    };
    this.timer.onComplete = () => {
      const status = document.getElementById('timerStatus');
      if (status) status.textContent = '⏱ 时间到！继续阅读即可';
    };

    if (toggleBtn) { toggleBtn.style.display = 'inline-block'; toggleBtn.textContent = '▶ 开始'; }
    if (timerBar) timerBar.style.display = 'flex';
    const display = document.getElementById('timerDisplay');
    if (display) display.textContent = this.timer.getDisplay();
  },

  toggleTimer() {
    if (!this.timer) return;
    const btn = document.getElementById('timerToggle');
    if (this.timer.isActive()) {
      this.timer.stop();
      if (btn) btn.textContent = '▶ 继续';
    } else {
      this.timer.start();
      if (btn) btn.textContent = '⏸ 暂停';
    }
  },

  // ===== Favorite =====
  async toggleFavorite(articleId) {
    const article = await DB.getArticle(articleId);
    if (!article) return;
    const newFav = article.favorite ? 0 : 1;
    await DB.updateArticle(articleId, { favorite: newFav });
    const btn = document.getElementById('favBtn');
    if (btn) btn.textContent = newFav ? '⭐ 收藏' : '☆ 收藏';
  }
};
