/**
 * Flashcard View
 * Spaced repetition review mode using SM-2 algorithm
 * Uses learnWords table with SRS scheduling
 */

const FlashcardView = {
  words: [],
  currentIndex: 0,
  ratingCounts: { 1: 0, 3: 0, 5: 0 },
  reviewedWords: [],  // Track words reviewed this session for article generation

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
        // Cache back to DB for next time
        await DB.updateLearnWordSRS(word.id, { translation, phonetic });
      } catch {
        translation = '暂无翻译';
      }
    }

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
            ${phonetic ? `<div class="flashcard-phonetic">[${esc(phonetic)}]</div>` : ''}
            <div class="flashcard-hint">点击查看释义</div>
          </div>
          <div class="flashcard-back">
            <div class="flashcard-translation">${esc(translation)}</div>
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

    // Track reviewed word for article generation
    this.reviewedWords.push({
      word: word.word,
      translation: word.translation || '',
      quality
    });

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
    const reviewedCount = this.reviewedWords.length;

    // Categorize reviewed words
    const forgot = this.reviewedWords.filter(w => w.quality === 1).map(w => w.word);
    const fuzzy = this.reviewedWords.filter(w => w.quality === 3).map(w => w.word);
    const knew = this.reviewedWords.filter(w => w.quality === 5).map(w => w.word);

    // Words that need reinforcement (forgot + fuzzy)
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
      // Only forgot + fuzzy words
      words = this.reviewedWords.filter(w => w.quality <= 3).map(w => w.word);
    } else {
      // All reviewed words
      words = this.reviewedWords.map(w => w.word);
    }

    if (words.length < 2) {
      alert('词汇太少，无法生成文章');
      return;
    }

    // Determine difficulty from exam level
    const difficulty = Config.get('exam_level') || 'cet4';
    const level = Config.get('level') || 'easy';

    // Smart split: if words are diverse, split into 2 short articles
    const shouldSplit = words.length > 8;
    const halfLen = Math.ceil(words.length / 2);

    // Navigate to chat and generate
    location.hash = '#/chat';

    // Wait for chat view to render
    await new Promise(r => setTimeout(r, 100));

    if (shouldSplit) {
      // Generate 2 short articles
      const group1 = words.slice(0, halfLen).join(', ');
      const group2 = words.slice(halfLen).join(', ');

      ChatView.addMessage('system', `📝 使用今天复习的 ${words.length} 个词汇生成阅读（分两篇短文）`);

      try {
        // Article 1
        const prompt1 = `请生成一篇短文，自然融入以下词汇：${group1}。主题可以是日常生活、科技、教育、文化中选择。`;
        const article1 = await API.generateArticle(prompt1, difficulty, '复习巩固', group1, 250);
        const id1 = await DB.saveArticle(article1);
        ChatView.addArticleCard({ ...article1, id: id1 });

        // Article 2
        const prompt2 = `请生成一篇短文，自然融入以下词汇：${group2}。选择与上一篇不同的主题。`;
        const article2 = await API.generateArticle(prompt2, difficulty, '复习巩固', group2, 250);
        const id2 = await DB.saveArticle(article2);
        ChatView.addArticleCard({ ...article2, id: id2 });

        ChatView.addMessage('system', '✅ 两篇巩固阅读已生成，点击阅读全文');
      } catch (err) {
        ChatView.addMessage('error', `生成失败：${err.message}`);
      }
    } else {
      // Generate 1 article
      const keywords = words.join(', ');
      ChatView.addMessage('system', `📝 使用今天复习的 ${words.length} 个词汇生成阅读`);

      try {
        const prompt = `请生成一篇文章，自然融入以下词汇：${keywords}。这些词汇来自今天的复习，需要在语境中反复出现帮助巩固记忆。`;
        const article = await API.generateArticle(prompt, difficulty, '复习巩固', keywords, 350);
        const id = await DB.saveArticle(article);
        ChatView.addArticleCard({ ...article, id });
        ChatView.addMessage('system', '✅ 巩固阅读已生成，点击阅读全文');
      } catch (err) {
        ChatView.addMessage('error', `生成失败：${err.message}`);
      }
    }
  }
};
