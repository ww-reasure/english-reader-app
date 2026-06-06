/**
 * Flashcard View
 * Spaced repetition review mode using SM-2 algorithm
 * Uses learnWords table with SRS scheduling
 *
 * Flow:
 *   Card front (word only)
 *   ├── Click "认识" → next word (quality 5, knew without seeing translation)
 *   ├── Click "模糊" → auto-flip → show "下一词" (quality 3)
 *   ├── Click "忘了" → auto-flip → show "下一词" (quality 1)
 *   └── Click card to flip → "认识" disabled → must pick 模糊/忘了
 */

const FlashcardView = {
  words: [],
  currentIndex: 0,
  ratingCounts: { 1: 0, 3: 0, 5: 0 },
  reviewedWords: [],
  isFlipped: false,        // Whether card is currently flipped
  pendingQuality: null,    // Quality chosen before "下一词"
  currentTranslation: '',  // Cached translation for current card
  currentPhonetic: '',     // Cached phonetic for current card

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
    this.reviewedWords = [];

    this.renderCard(container);
  },

  // Render a single flashcard
  async renderCard(container) {
    if (this.currentIndex >= this.words.length) {
      this.renderResult(container);
      return;
    }

    this.isFlipped = false;
    this.pendingQuality = null;

    const word = this.words[this.currentIndex];
    const statusInfo = SpacedRepetition.getStatusDisplay(word);
    const progress = Math.round((this.currentIndex / this.words.length) * 100);

    // Get translation and phonetic (from DB or dictionary lookup)
    let translation = word.translation || '';
    let phonetic = word.phonetic || '';
    if (!translation) {
      try {
        const dictResult = await Dictionary.lookup(word.word);
        translation = dictResult.translation || '暂无翻译';
        phonetic = phonetic || dictResult.phonetic || '';
        await DB.updateLearnWordSRS(word.id, { translation, phonetic });
      } catch {
        translation = '暂无翻译';
      }
    }
    this.currentTranslation = translation;
    this.currentPhonetic = phonetic;

    container.innerHTML = `
      <div class="flashcard-container">
        <div class="flashcard-progress">
          ${this.currentIndex + 1} / ${this.words.length}
          <span class="flashcard-status-badge" style="background:${statusInfo.color}">${statusInfo.icon} ${statusInfo.label}</span>
        </div>
        <div class="flashcard-progress-bar">
          <div class="flashcard-progress-fill" style="width:${progress}%"></div>
        </div>
        <div class="flashcard" id="flashcard" onclick="FlashcardView.flipCard()">
          <div class="flashcard-front" id="flashcardFront">
            <div class="flashcard-word">${esc(word.word)}</div>
            ${phonetic ? `<div class="flashcard-phonetic">[${esc(phonetic)}]</div>` : ''}
            <div class="flashcard-hint">点击查看释义</div>
          </div>
          <div class="flashcard-back" id="flashcardBack" style="display:none">
            <div class="flashcard-translation">${esc(translation)}</div>
            ${word.interval ? `<div class="flashcard-interval">当前间隔：${SpacedRepetition.getIntervalText(word.interval)}</div>` : ''}
            <div class="flashcard-hint" id="flashcardBackHint">根据记忆程度选择评分</div>
          </div>
        </div>
        <div class="flashcard-actions" id="flashcardActions">
          <button class="flashcard-rating-btn flashcard-btn-knew" id="btnKnew"
            onclick="FlashcardView.rate(5)" title="没翻就知道意思">
            认识
          </button>
          <button class="flashcard-rating-btn flashcard-btn-fuzzy"
            onclick="FlashcardView.rateAndFlip(3)" title="想了一下">
            模糊
          </button>
          <button class="flashcard-rating-btn flashcard-btn-forgot"
            onclick="FlashcardView.rateAndFlip(1)" title="完全不认识">
            忘了
          </button>
        </div>
        <div id="flashcardNext" style="display:none" class="flashcard-next-container">
          <button class="btn btn-primary" onclick="FlashcardView.goNext()">下一词</button>
        </div>
        <div class="flashcard-skip">
          <button class="btn btn-outline btn-sm" onclick="FlashcardView.skip()">跳过</button>
        </div>
      </div>`;
  },

  // Flip card manually (by clicking the card)
  flipCard() {
    if (this.isFlipped) return;
    this.isFlipped = true;

    const card = document.getElementById('flashcard');
    const front = document.getElementById('flashcardFront');
    const back = document.getElementById('flashcardBack');
    const btnKnew = document.getElementById('btnKnew');

    if (card) card.classList.add('flipped');
    if (front) front.style.display = 'none';
    if (back) back.style.display = 'block';

    // Disable "认识" — user flipped, so they didn't know immediately
    if (btnKnew) {
      btnKnew.disabled = true;
      btnKnew.style.opacity = '0.3';
      btnKnew.style.cursor = 'not-allowed';
    }
  },

  // Rate as "认识" (5) — only works when NOT flipped
  async rate(quality) {
    if (this.isFlipped) return; // Should not happen, but guard

    // Record and go next immediately
    await this.recordRating(quality);
    this.currentIndex++;
    this.renderCard(document.getElementById('app'));
  },

  // Rate as 模糊(3) or 忘了(1) — auto flip, then show "下一词"
  async rateAndFlip(quality) {
    this.pendingQuality = quality;

    // Auto flip if not already
    if (!this.isFlipped) {
      this.flipCard();
    }

    // Show "下一词" button, hide rating buttons
    const actions = document.getElementById('flashcardActions');
    const nextBtn = document.getElementById('flashcardNext');
    const hint = document.getElementById('flashcardBackHint');

    if (actions) actions.style.display = 'none';
    if (nextBtn) nextBtn.style.display = 'block';
    if (hint) {
      const labels = { 1: '❌ 忘了', 3: '🔶 模糊' };
      hint.textContent = labels[quality] + ' — 点击「下一词」继续';
    }
  },

  // Go to next word (after rating 模糊/忘了)
  async goNext() {
    if (this.pendingQuality !== null) {
      await this.recordRating(this.pendingQuality);
    }
    this.currentIndex++;
    this.renderCard(document.getElementById('app'));
  },

  // Record a rating
  async recordRating(quality) {
    const word = this.words[this.currentIndex];
    const srsData = SpacedRepetition.calculateNext(word, quality);
    await DB.updateLearnWordSRS(word.id, srsData);

    this.ratingCounts[quality] = (this.ratingCounts[quality] || 0) + 1;
    this.reviewedWords.push({
      word: word.word,
      translation: word.translation || this.currentTranslation,
      quality
    });
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
    const reviewedCount = this.reviewedWords.length;

    const forgot = this.reviewedWords.filter(w => w.quality === 1).map(w => w.word);
    const fuzzy = this.reviewedWords.filter(w => w.quality === 3).map(w => w.word);
    const reinforceWords = [...forgot, ...fuzzy];
    const canGenerate = reviewedCount >= 3;

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

          ${canGenerate ? `
          <div class="flashcard-result-generate">
            <h3>📝 巩固阅读</h3>
            <p class="flashcard-result-hint">生成一篇使用今天复习词汇的阅读文章，在语境中巩固记忆${reinforceWords.length > 0 ? '（优先使用记不住的词）' : ''}</p>
            <div style="display:flex;gap:8px;justify-content:center;margin-top:10px;flex-wrap:wrap">
              <button class="btn btn-primary" onclick="FlashcardView.generateReviewArticle('all')">生成阅读（全部 ${reviewedCount} 词）</button>
              ${reinforceWords.length > 0 && reinforceWords.length < reviewedCount ? `
              <button class="btn btn-outline" onclick="FlashcardView.generateReviewArticle('weak')">重点巩固（${reinforceWords.length} 个薄弱词）</button>
              ` : ''}
            </div>
          </div>` : ''}

          <div style="display:flex;gap:12px;justify-content:center;margin-top:16px;flex-wrap:wrap">
            <a href="#/chat" class="btn btn-outline">返回阅读</a>
            <a href="#/learn-words" class="btn btn-outline">词库管理</a>
            <button class="btn btn-outline" onclick="FlashcardView.render(document.getElementById('app'))">再来一轮</button>
          </div>
        </div>
      </div>`;
  },

  // Generate article using reviewed words
  async generateReviewArticle(mode) {
    if (!Config.hasApiKey()) {
      Modal.showApiSettings();
      return;
    }

    let words;
    if (mode === 'weak') {
      words = this.reviewedWords.filter(w => w.quality <= 3).map(w => w.word);
    } else {
      words = this.reviewedWords.map(w => w.word);
    }

    if (words.length < 2) {
      alert('词汇太少，无法生成文章');
      return;
    }

    const difficulty = Config.get('exam_level') || 'cet4';
    const shouldSplit = words.length > 8;
    const halfLen = Math.ceil(words.length / 2);

    location.hash = '#/chat';
    await new Promise(r => setTimeout(r, 100));

    if (shouldSplit) {
      const group1 = words.slice(0, halfLen).join(', ');
      const group2 = words.slice(halfLen).join(', ');

      ChatView.addMessage('system', `📝 使用今天复习的 ${words.length} 个词汇生成阅读（分两篇短文）`);

      try {
        const article1 = await API.generateArticle(
          `请生成一篇短文，自然融入以下词汇：${group1}。`, difficulty, '复习巩固', group1, 250);
        const id1 = await DB.saveArticle(article1);
        ChatView.addArticleCard({ ...article1, id: id1 });

        const article2 = await API.generateArticle(
          `请生成一篇短文，自然融入以下词汇：${group2}。选择与上一篇不同的主题。`, difficulty, '复习巩固', group2, 250);
        const id2 = await DB.saveArticle(article2);
        ChatView.addArticleCard({ ...article2, id: id2 });

        ChatView.addMessage('system', '✅ 两篇巩固阅读已生成，点击阅读全文');
      } catch (err) {
        ChatView.addMessage('error', `生成失败：${err.message}`);
      }
    } else {
      const keywords = words.join(', ');
      ChatView.addMessage('system', `📝 使用今天复习的 ${words.length} 个词汇生成阅读`);

      try {
        const article = await API.generateArticle(
          `请生成一篇文章，自然融入以下词汇：${keywords}。`, difficulty, '复习巩固', keywords, 350);
        const id = await DB.saveArticle(article);
        ChatView.addArticleCard({ ...article, id });
        ChatView.addMessage('system', '✅ 巩固阅读已生成，点击阅读全文');
      } catch (err) {
        ChatView.addMessage('error', `生成失败：${err.message}`);
      }
    }
  }
};
