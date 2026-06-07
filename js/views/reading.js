/**
 * Reading View
 * Article reading with auto-timer, word lookup, and completion summary
 */

const ReadingView = {
  timer: null,
  articleData: null,
  clickedWords: [],
  MIN_READ_TIME: 15,

  cleanup() {
    if (this._globalClickHandler) {
      document.removeEventListener('click', this._globalClickHandler);
      this._globalClickHandler = null;
    }
    if (this._audioClickHandler) {
      document.removeEventListener('click', this._audioClickHandler);
      this._audioClickHandler = null;
    }
    if (this._resumeHandler) {
      document.removeEventListener('touchstart', this._resumeHandler);
      document.removeEventListener('scroll', this._resumeHandler);
      this._resumeHandler = null;
    }
    if (this.timer) { this.timer.stop(); this.timer = null; }
  },

  async render(container, articleId) {
    this.cleanup();
    this.clickedWords = [];
    const article = await DB.getArticle(articleId);
    if (!article) {
      container.innerHTML = '<div class="empty-state">文章不存在</div>';
      return;
    }
    this.articleData = article;

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
            <a href="#/history" class="btn btn-outline">返回</a>
          </div>
          <div class="reading-timer-bar" id="timerBar">
            <span id="timerDisplay" class="timer-display">0:00</span>
            <div class="timer-progress"><div id="timerProgress" class="timer-progress-fill"></div></div>
            <span id="timerWpm" class="timer-wpm"></span>
            <span id="timerStatus" class="timer-status"></span>
          </div>
          <div class="reading-hint">单击单词查词，长按句子问 AI</div>
        </div>
        <div id="articleBody" class="article-body">${parasHTML}</div>
        <div class="reading-finish-bar">
          <button class="btn btn-success btn-lg" onclick="ReadingView.finishReading()">✓ 阅读完成</button>
        </div>
      </div>
      <div id="wordTooltip" class="word-tooltip" style="display:none"></div>
      <div id="readingSummary" class="modal-overlay" style="display:none"></div>`;

    this.initInteractions();
    AudioCache.preloadWords(article.content).catch(() => {});

    // Auto-start timer
    this.autoStartTimer();
  },

  initInteractions() {
    const articleBody = document.getElementById('articleBody');
    if (!articleBody) return;

    this._globalClickHandler = (e) => {
      const tooltip = document.getElementById('wordTooltip');
      if (!tooltip || tooltip.style.display === 'none') return;
      if (tooltip.contains(e.target)) return;
      Tooltip.hide();
      AIAnalysis.hideButton();
    };
    document.addEventListener('click', this._globalClickHandler);

    articleBody.addEventListener('click', async (e) => {
      const tooltip = document.getElementById('wordTooltip');
      if (tooltip?.contains(e.target)) return;
      if (e.target.id === 'aiAnalyzeBtn') return;

      const word = Tooltip.getWordAtPoint(e);
      if (!word || word.length < 2) return;
      e.stopPropagation();

      Tooltip.hide();
      AIAnalysis.hideButton();
      Tooltip.showLoading(e.clientX, e.clientY);

      try {
        const data = await Dictionary.lookup(word);
        Tooltip.show(e.clientX, e.clientY, data);
        const stem = getStemForm(word.toLowerCase());
        if (!this.clickedWords.some(w => w.stem === stem)) {
          this.clickedWords.push({ word: word.toLowerCase(), stem, freqLevel: data.freqLevel || 'unknown' });
        }
      } catch {
        Tooltip.hide();
      }
    });

    this._audioClickHandler = (e) => {
      if (e.target.classList.contains('btn-speak')) {
        const word = e.target.getAttribute('data-word');
        if (word) AudioCache.getAudio(word);
      }
    };
    document.addEventListener('click', this._audioClickHandler);

    AIAnalysis.initSelectionDetection(articleBody);
  },

  // ===== Timer =====
  autoStartTimer() {
    const wordCount = this.articleData?.wordCount || 300;
    this.timer = new ReadingTimer(wordCount);

    this.timer.onTick = (elapsed, wpm) => {
      const display = document.getElementById('timerDisplay');
      const wpmEl = document.getElementById('timerWpm');
      const statusEl = document.getElementById('timerStatus');
      if (display) display.textContent = this.timer.getDisplay();
      if (wpmEl) wpmEl.textContent = wpm + ' 词/分';
      if (statusEl) statusEl.textContent = this.timer.isPaused ? '⏸ 已暂停' : '';
    };

    this.timer.start();

    // Resume on touch/scroll
    this._resumeHandler = () => { if (this.timer?.isPaused) this.timer.resume(); };
    document.addEventListener('touchstart', this._resumeHandler, { passive: true });
    document.addEventListener('scroll', this._resumeHandler, { passive: true });
  },

  // Finish reading
  async finishReading() {
    this.timer?.stop();

    // Clean up listeners
    if (this._resumeHandler) {
      document.removeEventListener('touchstart', this._resumeHandler);
      document.removeEventListener('scroll', this._resumeHandler);
      this._resumeHandler = null;
    }

    const elapsed = this.timer?.elapsed || 0;

    // Check minimum time threshold
    if (elapsed < this.MIN_READ_TIME) {
      // Too short, don't count — just go back
      history.back();
      return;
    }

    // Save reading stat
    const wpm = this.timer?.getWPM() || 0;
    const wordCount = this.articleData?.wordCount || 0;
    await DB.saveReadingStat({
      articleId: this.articleData?.id,
      wordCount,
      elapsed,
      wpm,
      clickCount: this.clickedWords.length,
      clickedWords: this.clickedWords.map(w => w.word)
    });

    // Show summary popup
    await this.showSummary(elapsed, wpm);
  },

  async showSummary(elapsed, wpm) {
    const avgWpm = await DB.getAverageWPM();
    const diff = avgWpm > 0 ? wpm - avgWpm : 0;
    const diffPct = avgWpm > 0 ? Math.round(diff / avgWpm * 100) : 0;
    const clickCount = this.clickedWords.length;

    const overlay = document.getElementById('readingSummary');
    overlay.innerHTML = `
      <div class="modal modal-wide">
        <h2>📊 阅读完成！</h2>
        <div class="summary-stats">
          <div class="summary-stat">
            <span class="summary-stat-icon">⏱</span>
            <span class="summary-stat-num">${this.formatTime(elapsed)}</span>
            <span class="summary-stat-label">用时</span>
          </div>
          <div class="summary-stat">
            <span class="summary-stat-icon">📖</span>
            <span class="summary-stat-num">${wpm}</span>
            <span class="summary-stat-label">词/分</span>
          </div>
          ${avgWpm > 0 ? `
          <div class="summary-stat">
            <span class="summary-stat-icon">📈</span>
            <span class="summary-stat-num">${avgWpm}</span>
            <span class="summary-stat-label">历史平均</span>
          </div>
          <div class="summary-stat">
            <span class="summary-stat-icon">${diff >= 0 ? '⬆️' : '⬇️'}</span>
            <span class="summary-stat-num" style="color:${diff >= 0 ? 'var(--success)' : 'var(--danger)'}">${diff >= 0 ? '+' : ''}${diffPct}%</span>
            <span class="summary-stat-label">vs 平均</span>
          </div>` : ''}
          <div class="summary-stat">
            <span class="summary-stat-icon">🔍</span>
            <span class="summary-stat-num">${clickCount}</span>
            <span class="summary-stat-label">查词数</span>
          </div>
        </div>
        ${this.clickedWords.length > 0 ? `
        <div class="summary-words">
          <h3>📝 本篇查词</h3>
          <div class="summary-word-list">
            ${this.clickedWords.map(w => `<span class="summary-word-chip">${esc(w.word)}</span>`).join('')}
          </div>
        </div>` : ''}
        <div class="modal-actions summary-actions">
          ${this.clickedWords.length > 0 ? `
          <button class="btn btn-outline" onclick="ReadingView.addToReview()">加入词库</button>
          <button class="btn btn-primary" onclick="ReadingView.generateReview()">生成巩固阅读</button>` : ''}
          <button class="btn" onclick="ReadingView.closeAndExit()">关闭</button>
        </div>
      </div>`;
    overlay.style.display = 'flex';
  },

  formatTime(seconds) {
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return min > 0 ? `${min} 分 ${sec} 秒` : `${sec} 秒`;
  },

  // Close summary and exit article
  closeAndExit() {
    document.getElementById('readingSummary').style.display = 'none';
    history.back();
  },

  // Add clicked words to review
  async addToReview() {
    let added = 0;
    for (const w of this.clickedWords) {
      try {
        await DB.saveLearnWord({ word: w.word, createdAt: Date.now() });
        added++;
      } catch {}
    }
    alert(`已将 ${added} 个单词加入学习词库`);
  },

  // Generate review article from clicked words
  async generateReview() {
    if (!Config.hasApiKey()) { Modal.showApiSettings(); return; }
    const words = this.clickedWords.map(w => w.word);
    if (words.length < 2) { alert('查词太少，无法生成'); return; }

    document.getElementById('readingSummary').style.display = 'none';
    location.hash = '#/chat';
    await new Promise(r => setTimeout(r, 100));

    const keywords = words.join(', ');
    const difficulty = this.articleData?.difficulty || 'cet4';
    ChatView.addMessage('system', `📝 使用本篇查词生成巩固阅读（${words.length} 个词）`);
    try {
      const article = await API.generateArticle(
        `请生成一篇文章，自然融入以下词汇：${keywords}。`, difficulty, '阅读巩固', keywords, 350);
      const id = await DB.saveArticle(article);
      ChatView.addArticleCard({ ...article, id });
      ChatView.addMessage('system', '✅ 巩固阅读已生成');
    } catch (err) {
      ChatView.addMessage('error', `生成失败：${err.message}`);
    }
  },

  // ===== Translation =====
  toggleTranslation() {
    const zhParas = document.querySelectorAll('.zh-paragraph');
    const showing = zhParas[0]?.style.display === 'none';
    zhParas.forEach(p => p.style.display = showing ? 'block' : 'none');
    document.querySelectorAll('.btn-paragraph-translate').forEach(btn => {
      btn.textContent = showing ? '隐' : '译';
      btn.classList.toggle('active', showing);
    });
    const toggleBtn = document.querySelector('.reading-actions .btn-outline');
    if (toggleBtn) toggleBtn.textContent = showing ? '隐藏全部翻译' : '显示全部翻译';
  },

  toggleParagraph(btn) {
    const zhPara = btn.nextElementSibling;
    if (!zhPara || !zhPara.classList.contains('zh-paragraph')) return;
    const isVisible = zhPara.style.display !== 'none';
    zhPara.style.display = isVisible ? 'none' : 'block';
    btn.textContent = isVisible ? '译' : '隐';
    btn.classList.toggle('active', !isVisible);
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
