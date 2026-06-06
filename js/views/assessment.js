/**
 * Assessment View
 * Vocabulary level test through reading + self-assessment
 * Based on Krashen's i+1 theory and Nation's 98% coverage threshold
 */

const AssessmentView = {
  // Current assessment state
  state: {
    step: 'select',        // select | reading1 | reading2 | selfassess | result
    targetExam: 'cet4',
    articles: [],
    currentArticle: 0,
    clickedWords: [],      // words user clicked during reading
    selfAssessment: [50, 50],  // per-article self-assessment
    startTime: 0,
    readingTime: 0
  },

  // Reset state
  reset() {
    this.cleanup();
    this.state = {
      step: 'select',
      targetExam: 'cet4',
      articles: [],
      currentArticle: 0,
      clickedWords: [],
      selfAssessment: [50, 50],
      startTime: 0,
      readingTime: 0
    };
  },

  // Render assessment page
  render(container) {
    this.container = container;
    this.reset();
    this.renderSelectStep();
  },

  // Step 1: Select target exam
  renderSelectStep() {
    this.state.step = 'select';
    this.container.innerHTML = `
      <div class="assessment-container">
        <div class="assessment-header">
          <h1 class="page-title">📊 阅读水平测评</h1>
          <p class="assessment-desc">
            通过阅读测试，精准评估你的词汇量和阅读水平。<br>
            系统会根据测试结果自动推荐最适合你的难度和生词比例。
          </p>
        </div>

        <div class="assessment-section">
          <h2 class="settings-section-title">选择你的目标考试</h2>
          <p class="settings-desc">选择你正在准备的考试等级，系统将生成对应难度的测试文章</p>
          <div class="settings-options">
            <label class="settings-radio">
              <input type="radio" name="assessExam" value="cet4" checked>
              <span class="settings-radio-label">
                <span class="settings-radio-title">四级 (CET-4)</span>
                <span class="settings-radio-desc">大学英语四级考试，词汇量约 4500</span>
              </span>
            </label>
            <label class="settings-radio">
              <input type="radio" name="assessExam" value="cet6">
              <span class="settings-radio-label">
                <span class="settings-radio-title">六级 (CET-6)</span>
                <span class="settings-radio-desc">大学英语六级考试，词汇量约 6000（默认已掌握四级词汇）</span>
              </span>
            </label>
            <label class="settings-radio">
              <input type="radio" name="assessExam" value="graduate">
              <span class="settings-radio-label">
                <span class="settings-radio-title">考研</span>
                <span class="settings-radio-desc">研究生入学考试，词汇量约 5500（默认已掌握四级+六级词汇）</span>
              </span>
            </label>
          </div>
        </div>

        <div class="assessment-info-box">
          <h3>📋 测评流程说明</h3>
          <ol>
            <li>系统生成 2 篇目标等级的文章（一易一难）</li>
            <li>逐篇阅读，遇到不认识的单词<strong>点击查看翻译</strong></li>
            <li>阅读完成后，系统显示全文翻译，你<strong>评估自己的理解程度</strong></li>
            <li>系统根据你的查词行为和自评，计算推荐设置</li>
          </ol>
          <p class="assessment-info-note">⏱ 预计用时 3-5 分钟</p>
        </div>

        <div class="assessment-actions">
          <button class="btn btn-primary btn-lg" onclick="AssessmentView.startAssessment()">开始测评</button>
          <a href="#/chat" class="btn btn-outline">跳过，直接使用</a>
        </div>
      </div>`;
  },

  // Start assessment - generate articles (parallel: article 1 first, then article 2 in background)
  async startAssessment() {
    if (!Config.hasApiKey()) {
      Modal.showApiSettings();
      return;
    }

    const exam = document.querySelector('input[name="assessExam"]:checked')?.value || 'cet4';
    this.state.targetExam = exam;
    this.state.clickedWords = [];
    this.state.articles = [];

    // Show loading
    this.container.innerHTML = `
      <div class="assessment-container">
        <div class="assessment-loading">
          <div class="loading-spinner"></div>
          <p>正在生成第 1 篇测试文章...</p>
          <p class="text-muted">${DIFFICULTY_LABELS[exam]}（易）</p>
        </div>
      </div>`;

    try {
      // Generate article 1 (easy) first
      const article1 = await this.generateAssessmentArticle(exam, 'easy');
      this.state.articles.push(article1);

      // Start reading article 1 immediately
      this.state.currentArticle = 0;
      this.renderReadingStep();

      // Generate article 2 (hard) in background
      this.generateAssessmentArticle(exam, 'hard').then(article2 => {
        this.state.articles.push(article2);
      }).catch(() => {
        // If article 2 fails, we'll handle it when user finishes article 1
      });
    } catch (err) {
      this.container.innerHTML = `
        <div class="assessment-container">
          <div class="empty-state">
            <p>生成失败：${esc(err.message)}</p>
            <button class="btn btn-primary" onclick="AssessmentView.startAssessment()">重试</button>
            <a href="#/chat" class="btn btn-outline">返回</a>
          </div>
        </div>`;
    }
  },

  // Generate assessment article with AI
  async generateAssessmentArticle(exam, level) {
    const levelLabel = level === 'easy' ? '易' : '难';
    const difficultyKey = `${exam}_${level}`;

    const prompt = `你是一位英语考试辅导教师。请生成一篇用于词汇水平测试的英文阅读文章。

难度要求：
${API.difficultyRules[difficultyKey] || API.difficultyRules['cet4_easy']}

特殊要求：
- 主题选择通用话题（科技/生活/文化/教育/健康），避免专业术语和文化背景知识
- 文章总词数控制在 280-320 词
- 文章中自然包含以下类型的词汇：
  * 5-8 个高频词（常见基础词汇）
  * 5-8 个中频词（有一定难度的学术词）
  * 3-5 个低频词（较难的专业/学术词）
- 句子结构清晰，适合通过上下文推测词义
- 文章内容完整，有明确的主题和论证结构

请以 JSON 格式回复：
{
  "title": "英文标题",
  "content": "英文文章，段落之间用双换行分隔",
  "translation": "中文翻译，段落结构与英文一一对应，段落之间用双换行分隔"
}`;

    const data = await API.fetch('/chat/completions', {
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `请生成一篇 ${DIFFICULTY_LABELS[exam]}（${levelLabel}）难度的测试文章` }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7
    });

    const result = JSON.parse(data.choices[0].message.content);
    return {
      title: result.title || 'Untitled',
      content: result.content || '',
      translation: result.translation || '',
      difficulty: exam,
      level: level,
      wordCount: (result.content || '').split(/\s+/).length
    };
  },

  // Step 2: Reading step
  renderReadingStep() {
    this.state.step = 'reading';
    this.state.startTime = Date.now();
    const article = this.state.articles[this.state.currentArticle];
    const enParas = article.content.split(/\n\n+/).filter(p => p.trim());
    const levelLabel = article.level === 'easy' ? '易' : '难';
    const articleNum = this.state.currentArticle + 1;

    let parasHTML = '';
    enParas.forEach((p, i) => {
      parasHTML += `<div class="paragraph-pair"><p class="en-paragraph">${esc(p.trim())}</p></div>`;
    });

    this.container.innerHTML = `
      <div class="assessment-container">
        <div class="assessment-progress">
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${articleNum === 1 ? 25 : 60}%"></div>
          </div>
          <span class="progress-text">第 ${articleNum}/2 篇 · ${DIFFICULTY_LABELS[article.difficulty]}（${levelLabel}）</span>
        </div>

        <div class="reading-container">
          <div class="reading-header">
            <h1 class="reading-title">${esc(article.title)}</h1>
            <div class="reading-meta">
              <span class="badge badge-${article.difficulty}">${DIFFICULTY_LABELS[article.difficulty]}（${levelLabel}）</span>
              <span class="meta-item">${article.wordCount} 词</span>
            </div>
            <div class="reading-hint">📖 遇到不认识的单词，点击查看翻译</div>
          </div>
          <div id="articleBody" class="article-body">${parasHTML}</div>
        </div>

        <div class="assessment-reading-footer">
          <div class="reading-stats">
            已查词：<span id="clickCount">0</span> 个
          </div>
          <button class="btn btn-primary" onclick="AssessmentView.finishReading()">阅读完成，下一步</button>
        </div>
      </div>
      <div id="wordTooltip" class="word-tooltip" style="display:none"></div>`;

    this.initReadingInteractions();
  },

  // Initialize reading interactions (click to lookup only)
  initReadingInteractions() {
    const articleBody = document.getElementById('articleBody');
    if (!articleBody) return;

    // Global click handler: dismiss tooltip when clicking outside
    this._globalClickHandler = (e) => {
      const tooltip = document.getElementById('wordTooltip');
      if (!tooltip || tooltip.style.display === 'none') return;
      // Don't dismiss if clicking on tooltip itself (buttons etc.)
      if (tooltip.contains(e.target)) return;
      Tooltip.hide();
    };
    document.addEventListener('click', this._globalClickHandler);

    articleBody.addEventListener('click', async (e) => {
      const tooltip = document.getElementById('wordTooltip');
      // Don't dismiss if clicking on tooltip
      if (tooltip?.contains(e.target)) return;

      const word = Tooltip.getWordAtPoint(e);
      if (!word || word.length < 2) return;

      // Stop propagation so global handler doesn't immediately hide the new tooltip
      e.stopPropagation();

      // Hide previous tooltip before showing new one
      Tooltip.hide();

      Tooltip.showLoading(e.clientX, e.clientY);

      try {
        const data = await Dictionary.lookup(word);
        Tooltip.show(e.clientX, e.clientY, data);

        // Track clicked words for assessment
        const stem = getStemForm(word.toLowerCase());
        const alreadyClicked = this.state.clickedWords.some(w => w.stem === stem);
        if (!alreadyClicked) {
          this.state.clickedWords.push({
            word: word.toLowerCase(),
            stem: stem,
            freqLevel: data.freqLevel || 'unknown',
            articleIndex: this.state.currentArticle
          });
          // Update counter
          const counter = document.getElementById('clickCount');
          if (counter) counter.textContent = this.state.clickedWords.length;
        }
      } catch {
        Tooltip.hide();
      }
    });

    // TTS button click
    this._ttsClickHandler = (e) => {
      if (e.target.classList.contains('btn-speak')) {
        const word = e.target.getAttribute('data-word');
        if (word) TTS.speak(word);
      }
    };
    document.addEventListener('click', this._ttsClickHandler);
  },

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

  // Finish reading current article
  async finishReading() {
    Tooltip.hide();

    if (this.state.currentArticle === 0) {
      // Check if article 2 is ready
      if (this.state.articles.length < 2) {
        // Show loading while waiting for article 2
        this.container.innerHTML = `
          <div class="assessment-container">
            <div class="assessment-loading">
              <div class="loading-spinner"></div>
              <p>第 2 篇文章生成中，请稍候...</p>
              <p class="text-muted">${DIFFICULTY_LABELS[this.state.targetExam]}（难）</p>
            </div>
          </div>`;
        // Wait for article 2 (it's already generating in background)
        while (this.state.articles.length < 2) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
      // Move to article 2
      this.state.currentArticle = 1;
      this.renderReadingStep();
    } else {
      // Both articles done, move to self-assessment
      this.state.readingTime = Math.round((Date.now() - this.state.startTime) / 1000);
      this.renderSelfAssessStep();
    }
  },

  // Step 3: Self-assessment (per-article sliders)
  renderSelfAssessStep() {
    this.cleanup();
    this.state.step = 'selfassess';

    // Calculate stats for display
    const stats = this.calculateStats();
    const stats1 = this.calculateStatsForArticle(0);
    const stats2 = this.calculateStatsForArticle(1);

    // Show both articles' translations for self-assessment, each with its own slider
    let articlesHTML = '';
    this.state.articles.forEach((article, i) => {
      const levelLabel = article.level === 'easy' ? '易' : '难';
      const enParas = article.content.split(/\n\n+/).filter(p => p.trim());
      const zhParas = (article.translation || '').split(/\n\n+/).filter(p => p.trim());
      const articleStats = i === 0 ? stats1 : stats2;

      let parasHTML = '';
      enParas.forEach((p, j) => {
        parasHTML += `<p class="en-paragraph">${esc(p.trim())}</p>`;
        if (zhParas[j]) {
          parasHTML += `<p class="zh-paragraph" style="display:block">${esc(zhParas[j].trim())}</p>`;
        }
      });

      articlesHTML += `
        <div class="assess-article-block">
          <h3>第 ${i + 1} 篇：${esc(article.title)}（${DIFFICULTY_LABELS[article.difficulty]} ${levelLabel}）</h3>
          <div class="assess-article-stats">
            <span>查词：<strong>${articleStats.totalClicked}</strong> 个</span>
            <span>高频：${articleStats.highFreqCount}</span>
            <span>中频：${articleStats.midFreqCount}</span>
            <span>低频：${articleStats.lowFreqCount}</span>
          </div>
          <div class="assess-article-content">${parasHTML}</div>
          <div class="assess-self-rate assess-self-rate-inline">
            <h3>🤔 你对这篇（${levelLabel}）的理解程度：</h3>
            <div class="slider-container">
              <input type="range" id="selfAssessSlider${i}" min="0" max="100" value="${this.state.selfAssessment[i]}"
                oninput="AssessmentView.updateSliderLabel(${i}, this.value)">
              <div class="slider-labels">
                <span>0%</span>
                <span id="sliderValue${i}" class="slider-current">${this.state.selfAssessment[i]}%</span>
                <span>100%</span>
              </div>
              <div class="slider-desc">
                <span>完全不懂</span>
                <span>完全理解</span>
              </div>
            </div>
          </div>
        </div>`;
    });

    this.container.innerHTML = `
      <div class="assessment-container">
        <div class="assessment-progress">
          <div class="progress-bar">
            <div class="progress-fill" style="width: 85%"></div>
          </div>
          <span class="progress-text">自评环节</span>
        </div>

        <div class="assess-stats-box">
          <h3>📊 阅读统计</h3>
          <div class="assess-stats-grid">
            <div class="assess-stat">
              <span class="assess-stat-num">${this.state.clickedWords.length}</span>
              <span class="assess-stat-label">总查词数</span>
            </div>
            <div class="assess-stat">
              <span class="assess-stat-num">${stats.highFreqCount}</span>
              <span class="assess-stat-label">高频词</span>
            </div>
            <div class="assess-stat">
              <span class="assess-stat-num">${stats.midFreqCount}</span>
              <span class="assess-stat-label">中频词</span>
            </div>
            <div class="assess-stat">
              <span class="assess-stat-num">${stats.lowFreqCount}</span>
              <span class="assess-stat-label">低频词</span>
            </div>
          </div>
          <p class="assess-stats-note">阅读用时：${Math.floor(this.state.readingTime / 60)} 分 ${this.state.readingTime % 60} 秒</p>
        </div>

        <div class="assess-articles-review">
          <h3>📖 全文对照 + 分别自评</h3>
          <p class="settings-desc">阅读完两篇文章后，请分别评估你对每篇的理解程度</p>
          ${articlesHTML}
        </div>

        <div class="assessment-actions">
          <button class="btn btn-primary btn-lg" onclick="AssessmentView.showResult()">查看评估结果</button>
        </div>
      </div>`;
  },

  // Update slider label for per-article assessment
  updateSliderLabel(articleIndex, value) {
    const label = document.getElementById('sliderValue' + articleIndex);
    if (label) label.textContent = value + '%';
    this.state.selfAssessment[articleIndex] = parseInt(value);
  },

  // Calculate reading stats (all articles)
  calculateStats() {
    const words = this.state.clickedWords;
    return {
      totalClicked: words.length,
      highFreqCount: words.filter(w => w.freqLevel === 'high').length,
      midFreqCount: words.filter(w => w.freqLevel === 'medium').length,
      lowFreqCount: words.filter(w => w.freqLevel === 'low').length
    };
  },

  // Calculate reading stats for a specific article
  calculateStatsForArticle(articleIndex) {
    const words = this.state.clickedWords.filter(w => w.articleIndex === articleIndex);
    return {
      totalClicked: words.length,
      highFreqCount: words.filter(w => w.freqLevel === 'high').length,
      midFreqCount: words.filter(w => w.freqLevel === 'medium').length,
      lowFreqCount: words.filter(w => w.freqLevel === 'low').length
    };
  },

  // Step 4: Show result
  showResult() {
    // Read per-article sliders
    for (let i = 0; i < this.state.articles.length; i++) {
      const slider = document.getElementById('selfAssessSlider' + i);
      if (slider) this.state.selfAssessment[i] = parseInt(slider.value);
    }
    this.state.step = 'result';

    const result = this.calculateResult();
    this.renderResultStep(result);
  },

  // Calculate assessment result (per-article weighted)
  calculateResult() {
    const stats = this.calculateStats();
    const exam = this.state.targetExam;

    // Base vocabulary for each exam level
    const baseVocab = { cet4: 2000, cet6: 4000, graduate: 5500 };

    // Calculate per-article objective and self rates
    const articleRates = this.state.articles.map((article, i) => {
      const aStats = this.calculateStatsForArticle(i);
      const totalWords = article.wordCount;

      // Weighted unknown rate for this article
      const weightedUnknown = aStats.highFreqCount * 3 + aStats.midFreqCount * 1.5 + aStats.lowFreqCount * 0.5;
      const maxWeight = totalWords * 0.02 * 3;
      const objectiveRate = Math.max(0, Math.min(1, 1 - (weightedUnknown / Math.max(maxWeight, 1))));

      // Self-assessment for this article
      const selfRate = (this.state.selfAssessment[i] || 50) / 100;

      // Combined (objective 60%, self 40%)
      const combined = objectiveRate * 0.6 + selfRate * 0.4;

      return { objectiveRate, selfRate, combined, level: article.level };
    });

    // Easy article weighted 30%, hard article weighted 70%
    // (hard article is more diagnostic)
    const easyRate = articleRates.find(r => r.level === 'easy') || articleRates[0];
    const hardRate = articleRates.find(r => r.level === 'hard') || articleRates[1] || articleRates[0];
    const finalRate = easyRate.combined * 0.3 + hardRate.combined * 0.7;

    // Estimate vocabulary
    const estimatedVocab = Math.round(baseVocab[exam] * (0.4 + finalRate * 0.8));

    // Determine frequency profile
    const highFreqRate = stats.highFreqCount <= 2 ? 'excellent' : stats.highFreqCount <= 5 ? 'good' : 'weak';
    const midFreqRate = stats.midFreqCount <= 5 ? 'excellent' : stats.midFreqCount <= 10 ? 'good' : 'weak';

    // Recommend difficulty based on final rate
    let recommendedDifficulty = exam;
    let recommendedLevel = 'easy';
    if (finalRate >= 0.90) {
      recommendedLevel = 'hard';
    } else if (finalRate >= 0.70) {
      recommendedLevel = 'easy';
    } else {
      if (exam === 'graduate') {
        recommendedDifficulty = 'cet6';
        recommendedLevel = finalRate >= 0.50 ? 'easy' : 'hard';
      } else if (exam === 'cet6') {
        recommendedDifficulty = 'cet4';
        recommendedLevel = 'hard';
      } else {
        recommendedLevel = 'easy';
      }
    }

    // Recommend coverage
    let recommendedCoverage, recommendedNewWordPercent;
    if (finalRate >= 0.95) {
      recommendedCoverage = 98;
      recommendedNewWordPercent = 2;
    } else if (finalRate >= 0.85) {
      recommendedCoverage = 95;
      recommendedNewWordPercent = 5;
    } else if (finalRate >= 0.70) {
      recommendedCoverage = 90;
      recommendedNewWordPercent = 10;
    } else {
      recommendedCoverage = 85;
      recommendedNewWordPercent = 15;
    }

    return {
      estimatedVocab,
      finalRate: Math.round(finalRate * 100),
      easyRate: Math.round(easyRate.combined * 100),
      hardRate: Math.round(hardRate.combined * 100),
      highFreqRate,
      midFreqRate,
      stats,
      recommendedDifficulty,
      recommendedLevel,
      recommendedCoverage,
      recommendedNewWordPercent,
      exam
    };
  },

  // Render result step
  renderResultStep(result) {
    const examLabels = { cet4: '四级', cet6: '六级', graduate: '考研' };
    const levelLabels = { easy: '易', hard: '难' };
    const freqIcons = { excellent: '✅', good: '⚠️', weak: '🔶' };
    const freqTexts = { excellent: '优秀', good: '良好', weak: '需加强' };

    this.container.innerHTML = `
      <div class="assessment-container">
        <div class="assessment-progress">
          <div class="progress-bar">
            <div class="progress-fill" style="width: 100%"></div>
          </div>
          <span class="progress-text">测评完成</span>
        </div>

        <div class="result-card">
          <h2 class="result-title">📊 你的阅读水平评估报告</h2>

          <div class="result-main">
            <div class="result-vocab">
              <span class="result-vocab-num">${result.estimatedVocab}</span>
              <span class="result-vocab-label">预估词汇量</span>
            </div>
            <div class="result-bar-container">
              <div class="result-bar">
                <div class="result-bar-fill" style="width: ${Math.min(100, result.finalRate)}%"></div>
              </div>
              <span class="result-bar-text">综合理解率 ${result.finalRate}%</span>
            </div>
          </div>

          <div class="result-detail-grid">
            <div class="result-detail-item">
              <span class="result-detail-icon">${freqIcons[result.highFreqRate]}</span>
              <span class="result-detail-label">高频词掌握</span>
              <span class="result-detail-value">${freqTexts[result.highFreqRate]}</span>
            </div>
            <div class="result-detail-item">
              <span class="result-detail-icon">${freqIcons[result.midFreqRate]}</span>
              <span class="result-detail-label">中频词掌握</span>
              <span class="result-detail-value">${freqTexts[result.midFreqRate]}</span>
            </div>
            <div class="result-detail-item">
              <span class="result-detail-icon">📝</span>
              <span class="result-detail-label">查词总数</span>
              <span class="result-detail-value">${result.stats.totalClicked} 个</span>
            </div>
            <div class="result-detail-item">
              <span class="result-detail-icon">⏱</span>
              <span class="result-detail-label">阅读用时</span>
              <span class="result-detail-value">${Math.floor(this.state.readingTime / 60)}分${this.state.readingTime % 60}秒</span>
            </div>
          </div>

          <div class="result-per-article">
            <div class="result-per-article-item">
              <span>第 1 篇（易）理解率</span>
              <strong>${result.easyRate}%</strong>
            </div>
            <div class="result-per-article-item">
              <span>第 2 篇（难）理解率</span>
              <strong>${result.hardRate}%</strong>
            </div>
          </div>

          <div class="result-recommend">
            <h3>🎯 推荐设置</h3>
            <div class="result-recommend-grid">
              <div class="result-recommend-item">
                <span class="result-recommend-label">推荐难度</span>
                <span class="result-recommend-value">
                  <span class="badge badge-${result.recommendedDifficulty}">${examLabels[result.recommendedDifficulty]}</span>
                  ${levelLabels[result.recommendedLevel]}
                </span>
              </div>
              <div class="result-recommend-item">
                <span class="result-recommend-label">词汇覆盖率</span>
                <span class="result-recommend-value">${result.recommendedCoverage}%</span>
              </div>
              <div class="result-recommend-item">
                <span class="result-recommend-label">新词比例</span>
                <span class="result-recommend-value">${result.recommendedNewWordPercent}%（每100词约${result.recommendedNewWordPercent}个新词）</span>
              </div>
            </div>
          </div>

          <div class="result-explain">
            <h3>📖 说明</h3>
            <ul>
              <li><strong>词汇覆盖率 ${result.recommendedCoverage}%</strong>：每100个词中你认识约 ${result.recommendedCoverage} 个，符合 Krashen 的 i+1 理论</li>
              <li><strong>新词比例 ${result.recommendedNewWordPercent}%</strong>：文章中约 ${result.recommendedNewWordPercent}% 的词是新词，其余为你已掌握的词汇</li>
              <li>这些设置可以在「设置」页面随时手动调整</li>
            </ul>
          </div>

          <div class="assessment-actions">
            <button class="btn btn-primary btn-lg" onclick="AssessmentView.applyResult()">应用推荐设置</button>
            <button class="btn btn-outline" onclick="AssessmentView.renderSelectStep()">重新测评</button>
            <a href="#/chat" class="btn btn-outline">跳过</a>
          </div>
        </div>
      </div>`;
  },

  // Apply assessment result to config
  applyResult() {
    const result = this.calculateResult();

    // Save assessment result
    Config.set('assessment_done', 'true');
    Config.set('assessment_vocab', result.estimatedVocab.toString());
    Config.set('assessment_date', new Date().toISOString());

    // Apply recommended settings
    Config.set('exam_level', result.recommendedDifficulty);
    Config.set('level', result.recommendedLevel);
    Config.set('coverage', result.recommendedCoverage.toString());
    Config.set('new_word_percent', result.recommendedNewWordPercent.toString());

    alert('设置已应用！\n\n' +
      `难度：${DIFFICULTY_LABELS[result.recommendedDifficulty]}（${result.recommendedLevel === 'easy' ? '易' : '难'}）\n` +
      `覆盖率：${result.recommendedCoverage}%\n` +
      `新词比例：${result.recommendedNewWordPercent}%\n\n` +
      '可在「设置」页面随时调整。'
    );

    location.hash = '#/chat';
  }
};
