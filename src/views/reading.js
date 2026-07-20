/**
 * Reading View
 * Article reading with auto-timer, word lookup, and completion summary
 */

import { DB } from '../db.js';
import { DIFFICULTY_LABELS, esc, escAttr, getStemForm, ReadingTimer } from '../helpers.js';
import { Tooltip } from '../components/tooltip.js';
import { AIAnalysis } from '../components/ai-analysis.js';
import { Dictionary } from '../dictionary.js';
import { AudioCache } from '../audio-cache.js';
import { Config, ARTICLE_SERVER_URL } from '../config.js';
import { Modal } from '../components/modal.js';
import { API } from '../api.js';
import { ChatView } from './chat.js';
import { SpacedRepetition } from '../spaced-repetition.js';

export const ReadingView = {
  timer: null,
  articleData: null,
  clickedWords: [],
  MIN_READ_TIME: 15,
  reviewMode: false,
  reviewWordsMap: new Map(), // stem -> word data
  paragraphTranslations: [], // 按英文段落索引对齐，允许书架文章乱序按段翻译

  _getParagraphTranslations(article, enParas) {
    // 新格式保存稀疏数组，避免“先翻第3段”后刷新时发生段落错配
    if (Array.isArray(article.paragraphTranslations)) {
      return enParas.map((_, i) => article.paragraphTranslations[i] || '');
    }
    // 兼容 AI 生成文章的旧全文 translation（通常是连续完整段落）
    const legacy = this._splitParas(article.translation);
    return enParas.map((_, i) => legacy[i] || '');
  },

  _syncTranslationText() {
    return this.paragraphTranslations.join('\n\n');
  },

  // 安全切段：防空崩溃。云端已清洗杂段,这里只做防空,保留所有 \n\n 段(含真小标题)
  _splitParas(content) {
    return (content || '').split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  },

  cleanup() {
    if (this._globalClickHandler) {
      document.removeEventListener('click', this._globalClickHandler);
      this._globalClickHandler = null;
    }
    if (this._audioClickHandler) {
      document.removeEventListener('click', this._audioClickHandler);
      this._audioClickHandler = null;
    }
    if (this._reviewRatedHandler) {
      document.removeEventListener('review-rated', this._reviewRatedHandler);
      this._reviewRatedHandler = null;
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
    this.reviewWordsMap = new Map();
    const article = await DB.getArticle(articleId);
    if (!article) {
      container.innerHTML = '<div class="empty-state">文章不存在</div>';
      return;
    }
    this.articleData = article;
    this.reviewMode = !!article.reviewMode;

    // 空 content 防护: 云端分段在修/抓取异常时可能存入空正文
    if (!article.content || !article.content.trim()) {
      container.innerHTML = `
        <div class="reading-container">
          <div class="reading-header">
            <h1 class="reading-title">${esc(article.title || '文章')}</h1>
            <div class="reading-actions">
              <a href="javascript:history.back()" class="btn btn-outline">返回</a>
            </div>
          </div>
          <div class="empty-state">⏳ 文章正文尚未就绪，请稍后重试或重新打开</div>
        </div>`;
      return;
    }

    // Load review words if in review mode
    if (this.reviewMode) {
      const learnWords = await DB.getAllLearnWords();
      learnWords.forEach(w => {
        const stem = getStemForm(w.word.toLowerCase());
        this.reviewWordsMap.set(stem, w);
      });
    }

    const enParas = this._splitParas(article.content);
    this.paragraphTranslations = this._getParagraphTranslations(article, enParas);
    const difficultyLabel = DIFFICULTY_LABELS[article.difficulty] || article.difficulty;

    let parasHTML = '';
    enParas.forEach((p, i) => {
      const zhText = this.paragraphTranslations[i] || '';
      const hasTranslation = !!zhText.trim();
      const paraHTML = this.reviewMode ? this._highlightReviewWords(p.trim()) : esc(p.trim());
      parasHTML += `
        <div class="paragraph-pair" data-paragraph-index="${i}">
          <p class="en-paragraph">${paraHTML}</p>
          <button class="btn-paragraph-translate" data-paragraph-index="${i}" onclick="ReadingView.toggleParagraph(this)">译</button>
          ${hasTranslation ? `<p class="zh-paragraph" style="display:none">${esc(zhText.trim())}</p>` : ''}
        </div>`;
    });

    container.innerHTML = `
      <div class="reading-container">
        <header class="reading-header">
          <p class="page-eyebrow">02 / READING NOTE</p>
          <h1 class="reading-title">${esc(article.title)}</h1>
          <div class="reading-meta">
            <span class="badge badge-${article.difficulty}">${difficultyLabel}</span>
            <span class="meta-item">${article.wordCount} 词</span>
            <span class="meta-item">${esc(article.topic)}</span>
          </div>
          <div class="reading-actions">
            <button class="btn btn-outline" onclick="ReadingView.toggleFavorite(${article.id})" id="favBtn">${article.favorite ? '⭐' : '☆'} 收藏</button>
            <button class="btn btn-outline" onclick="ReadingView.toggleTranslation()" id="translateBtn">${this.paragraphTranslations.some(Boolean) ? '显示翻译' : '翻译全文'}</button>
            <a href="javascript:history.back()" class="btn btn-outline">返回</a>
          </div>
          <div class="reading-timer-bar collapsed" id="timerBar" onclick="this.classList.toggle('collapsed')">
            <span class="timer-toggle" title="点击展开/折叠计时">⏱</span>
            <div class="timer-expanded">
              <span id="timerDisplay" class="timer-display">0:00</span>
              <div class="timer-progress"><div id="timerProgress" class="timer-progress-fill"></div></div>
              <span id="timerWpm" class="timer-wpm"></span>
              <span id="timerStatus" class="timer-status"></span>
            </div>
          </div>
          <div class="reading-hint">${this.reviewMode ? '复习标记词：点击后记录你的掌握程度' : '点击单词查释义；选中句子可以请求 AI 分析'}</div>
        </header>
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

    // Listen for review rating events from tooltip
    this._reviewRatedHandler = (e) => {
      const { quality, stem } = e.detail;
      const existing = this.clickedWords.find(w => w.stem === stem);
      if (existing) {
        existing.quality = quality;
      }
    };
    document.addEventListener('review-rated', this._reviewRatedHandler);

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
        const stem = getStemForm(word.toLowerCase());
        const isReviewWord = this.reviewMode && this.reviewWordsMap.has(stem);

        Tooltip.show(e.clientX, e.clientY, data, isReviewWord);

        if (!this.clickedWords.some(w => w.stem === stem)) {
          this.clickedWords.push({
            word: word.toLowerCase(),
            stem,
            translation: data.translation || '',
            phonetic: data.phonetic || '',
            freqLevel: data.freqLevel || 'unknown',
            isReviewWord,
            quality: isReviewWord ? 3 : null // Default to 模糊 for review words
          });
        }
      } catch {
        Tooltip.hide();
      }
    });

    // Audio button click (direct binding in tooltip.js, this is backup)
    this._audioClickHandler = (e) => {
      const btn = e.target.closest('.btn-speak');
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        const word = btn.getAttribute('data-word');
        if (word && window.AudioCache) {
          window.AudioCache.getAudio(word).catch(err => console.warn('Audio play failed:', err));
        }
      }
    };
    document.addEventListener('click', this._audioClickHandler);

    AIAnalysis.initSelectionDetection(articleBody);
  },

  // Highlight review words in text
  _highlightReviewWords(text) {
    if (!this.reviewWordsMap.size) return esc(text);

    // Build regex from review word stems
    const stems = Array.from(this.reviewWordsMap.keys());
    const pattern = new RegExp('\\b(' + stems.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\w*\\b', 'gi');

    return esc(text).replace(pattern, (match) => {
      const stem = getStemForm(match.toLowerCase());
      const wordData = this.reviewWordsMap.get(stem);
      if (!wordData) return match;
      const status = SpacedRepetition.getStatus(wordData);
      const cssClass = status === 'new' ? 'review-new' : status === 'mastered' ? '' : 'review-learning';
      if (!cssClass) return match; // Don't highlight mastered words
      return `<mark class="review-word ${cssClass}" data-stem="${escAttr(stem)}">${match}</mark>`;
    });
  },

  // Update SRS ratings after review reading
  async _updateReviewSRS() {
    const learnWords = await DB.getAllLearnWords();
    const clickedStems = new Set(this.clickedWords.filter(w => w.isReviewWord).map(w => w.stem));

    for (const word of learnWords) {
      const stem = getStemForm(word.word.toLowerCase());
      if (!this.reviewWordsMap.has(stem)) continue;

      let quality;
      if (clickedStems.has(stem)) {
        // User clicked this word - use their rating
        const clicked = this.clickedWords.find(w => w.stem === stem);
        quality = clicked?.quality || 3; // Default to 模糊
      } else {
        // User didn't click - they recognized it
        quality = 5;
      }

      const srsData = SpacedRepetition.calculateNext(word, quality);
      await DB.updateLearnWordSRS(word.id, srsData);
    }
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
      // Too short, don't count — cleanup 全部监听再返回(避免靠下次 render 才回收)
      this.cleanup();
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

    // Update SRS for review mode
    if (this.reviewMode) {
      await this._updateReviewSRS();
    }

    // Show summary popup
    await this.showSummary(elapsed, wpm);
  },

  async showSummary(elapsed, wpm) {
    const avgWpm = await DB.getAverageWPM();
    const diff = avgWpm > 0 ? wpm - avgWpm : 0;
    const diffPct = avgWpm > 0 ? Math.round(diff / avgWpm * 100) : 0;
    const clickCount = this.clickedWords.length;

    // Review mode statistics
    const reviewClicked = this.clickedWords.filter(w => w.isReviewWord);
    const reviewClickedCount = reviewClicked.length;
    const reviewTotal = this.reviewWordsMap.size;
    const reviewRecognized = reviewTotal - reviewClickedCount;

    const overlay = document.getElementById('readingSummary');
    overlay.innerHTML = `
      <div class="modal modal-wide">
        <h2>${this.reviewMode ? '🔄 复习阅读完成！' : '📊 阅读完成！'}</h2>
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
        ${this.reviewMode ? `
        <div class="summary-stats" style="margin-top:12px">
          <div class="summary-stat">
            <span class="summary-stat-icon">📝</span>
            <span class="summary-stat-num">${reviewTotal}</span>
            <span class="summary-stat-label">标记词数</span>
          </div>
          <div class="summary-stat">
            <span class="summary-stat-icon">✅</span>
            <span class="summary-stat-num" style="color:var(--success)">${reviewRecognized}</span>
            <span class="summary-stat-label">认识</span>
          </div>
          <div class="summary-stat">
            <span class="summary-stat-icon">❌</span>
            <span class="summary-stat-num" style="color:var(--danger)">${reviewClickedCount}</span>
            <span class="summary-stat-label">不熟/不认识</span>
          </div>
        </div>` : ''}
        ${reviewClickedCount > 0 ? `
        <div class="summary-words">
          <h3>${this.reviewMode ? '❌ 不熟/不认识的词' : '📝 本篇查词'}</h3>
          <div class="summary-word-list">
            ${reviewClicked.map(w => `<span class="summary-word-chip">${esc(w.word)}</span>`).join('')}
          </div>
        </div>` : ''}
        <div class="modal-actions summary-actions">
          ${!this.reviewMode && this.clickedWords.length > 0 ? `
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
    let skipped = 0;
    for (const w of this.clickedWords) {
      try {
        const existing = await DB.findLearnWord(w.word);
        if (existing) {
          skipped++;
          continue;
        }
        await DB.saveLearnWord({
          word: w.word,
          translation: w.translation || '',
          phonetic: w.phonetic || '',
          createdAt: Date.now()
        });
        added++;
      } catch {}
    }
    const msg = added > 0
      ? `已将 ${added} 个单词加入学习词库${skipped > 0 ? `（${skipped} 个已存在，已跳过）` : ''}`
      : `所有 ${skipped} 个单词已在学习词库中`;
    alert(msg);
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
  async _persistParagraphTranslations() {
    const translation = this._syncTranslationText();
    await DB.updateArticle(this.articleData.id, {
      paragraphTranslations: this.paragraphTranslations,
      translation
    });
    this.articleData.paragraphTranslations = [...this.paragraphTranslations];
    this.articleData.translation = translation;
  },

  _renderParagraphTranslation(index, visible = true) {
    const pair = document.querySelector(`.paragraph-pair[data-paragraph-index="${index}"]`);
    if (!pair) return;
    const text = this.paragraphTranslations[index] || '';
    if (!text) return;
    const btn = pair.querySelector('.btn-paragraph-translate');
    let zhEl = pair.querySelector('.zh-paragraph');
    if (!zhEl) {
      zhEl = document.createElement('p');
      zhEl.className = 'zh-paragraph';
      pair.appendChild(zhEl);
    }
    zhEl.textContent = text;
    zhEl.style.display = visible ? 'block' : 'none';
    if (btn) {
      btn.textContent = visible ? '隐' : '译';
      btn.classList.toggle('active', visible);
    }
  },

  async toggleTranslation() {
    const toggleBtn = document.getElementById('translateBtn');
    const missing = this.paragraphTranslations
      .map((text, index) => text ? -1 : index)
      .filter(index => index >= 0);
    const available = this.paragraphTranslations.filter(Boolean).length;

    // 全部已有翻译时，只切换显示/隐藏，不再请求 API
    if (missing.length === 0 && available > 0) {
      const anyVisible = Array.from(document.querySelectorAll('.zh-paragraph'))
        .some(p => p.style.display !== 'none');
      this.paragraphTranslations.forEach((text, index) => {
        if (text) this._renderParagraphTranslation(index, !anyVisible);
      });
      if (toggleBtn) toggleBtn.textContent = anyVisible ? '显示翻译' : '隐藏全部翻译';
      return;
    }

    if (!Config.hasApiKey()) {
      alert('需要 API Key 才能翻译');
      return;
    }
    if (toggleBtn) {
      toggleBtn.disabled = true;
      toggleBtn.textContent = '翻译全文中…';
    }

    const articleId = this.articleData.id;
    const enParas = this._splitParas(this.articleData.content);
    try {
      // 只补齐未译段，已通过单段翻译得到的内容绝不重复请求
      for (const index of missing) {
        const text = await API.translateSentence(enParas[index]);
        if (this.articleData?.id !== articleId) return;
        if (text) this.paragraphTranslations[index] = text;
      }
      await this._persistParagraphTranslations();
      this.paragraphTranslations.forEach((text, index) => {
        if (text) this._renderParagraphTranslation(index, true);
      });
      if (toggleBtn) toggleBtn.textContent = '隐藏全部翻译';
    } catch (e) {
      console.warn('全文翻译失败:', e);
      if (toggleBtn) toggleBtn.textContent = available ? '显示翻译' : '翻译全文';
    } finally {
      if (toggleBtn && this.articleData?.id === articleId) toggleBtn.disabled = false;
    }
  },

  async toggleParagraph(btn) {
    const index = Number(btn.dataset.paragraphIndex);
    const pair = btn.closest('.paragraph-pair');
    const existing = pair?.querySelector('.zh-paragraph');

    // 已有译文：只切换本段，不请求 API
    if (existing && (this.paragraphTranslations[index] || existing.textContent.trim())) {
      const isVisible = existing.style.display !== 'none';
      existing.style.display = isVisible ? 'none' : 'block';
      btn.textContent = isVisible ? '译' : '隐';
      btn.classList.toggle('active', !isVisible);
      return;
    }

    if (!Config.hasApiKey()) {
      alert('需要 API Key 才能翻译');
      return;
    }
    if (btn.disabled) return;

    const articleId = this.articleData.id;
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = '翻译中…';
    try {
      // 从数据源取原文，避免复习模式的 <mark> 高亮标签进入翻译请求
      const enParagraph = this._splitParas(this.articleData.content)[index];
      const translation = await API.translateSentence(enParagraph);
      if (!translation || this.articleData?.id !== articleId) return;
      this.paragraphTranslations[index] = translation;
      await this._persistParagraphTranslations();
      this._renderParagraphTranslation(index, true);
      const toggleBtn = document.getElementById('translateBtn');
      if (toggleBtn) toggleBtn.textContent = '显示翻译';
    } catch (e) {
      console.warn('段落翻译失败:', e);
    } finally {
      if (this.articleData?.id === articleId) {
        btn.disabled = false;
        if (!this.paragraphTranslations[index]) btn.textContent = originalLabel;
      }
    }
  },

  // ===== Favorite =====
  async toggleFavorite(articleId) {
    const article = await DB.getArticle(articleId);
    if (!article) return;
    const newFav = article.favorite ? 0 : 1;
    // 收藏时确保本地正文齐全: 云端后续删除也仍可在本地阅读
    if (newFav === 1) {
      if (!article.content || !article.content.trim()) {
        const url = article.url || article.sourceUrl || '';
        if (url) {
          try {
            const serverUrl = ARTICLE_SERVER_URL;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15000);
            const resp = await fetch(`${serverUrl}/api/articles/${article.id}`, { signal: controller.signal });
            clearTimeout(timer);
            if (resp.ok) {
              const full = await resp.json();
              if (full && full.content && full.content.trim()) {
                await DB.updateArticle(articleId, { content: full.content, summary: full.summary || article.summary });
              }
            }
          } catch (e) {
            console.warn('补抓全文失败:', e);
          }
        }
      }
    }
    await DB.updateArticle(articleId, { favorite: newFav });
    const btn = document.getElementById('favBtn');
    if (btn) btn.textContent = newFav ? '⭐ 收藏' : '☆ 收藏';
  }
};

window.ReadingView = ReadingView;
