/**
 * Assessment View
 * Reading calibration through comprehension, pace, lookup behaviour and confidence
 * Based on Krashen's i+1 theory and Nation's 98% coverage threshold
 */

import { Config } from '../config.js';
import { DIFFICULTY_LABELS, esc, getStemForm } from '../helpers.js';
import { API } from '../api.js';
import { Tooltip } from '../components/tooltip.js';
import { Dictionary } from '../dictionary.js';
import { AudioCache } from '../audio-cache.js';
import { Modal } from '../components/modal.js';
import { buildReadingProfile } from '../reading-profile.mjs';
import { formatProfileConstraints, getDifficultyProfile, normalizeCoveragePreference, validateArticle } from '../difficulty-profile.mjs';
import { hasCompleteAnswers, normalizeQuestionSet } from '../assessment-questions.mjs';

export const AssessmentView = {
  // Current assessment state
  state: {
    step: 'select',        // select | reading1 | reading2 | selfassess | result
    targetExam: 'cet4',
    articles: [],
    currentArticle: 0,
    secondArticleError: '',
    clickedWords: [],      // words user clicked during reading
    selfAssessment: [50, 50],  // per-article self-assessment
    articleReadStartedAt: 0,
    readingDurations: [0, 0],
    readingTime: 0,
    quizAnswers: [{}, {}],
    assessmentRunId: 0,
    generationController: null
  },

  // Reset state
  reset() {
    const assessmentRunId = (this.state?.assessmentRunId || 0) + 1;
    this.cleanup();
    this.state = {
      step: 'select',
      targetExam: 'cet4',
      articles: [],
      currentArticle: 0,
      secondArticleError: '',
      clickedWords: [],
      selfAssessment: [50, 50],
      articleReadStartedAt: 0,
      readingDurations: [0, 0],
      readingTime: 0,
      quizAnswers: [{}, {}],
      assessmentRunId,
      generationController: null
    };
  },

  beginAssessmentRun() {
    this.state.generationController?.abort();
    const controller = new AbortController();
    this.state.assessmentRunId += 1;
    this.state.generationController = controller;
    return { runId: this.state.assessmentRunId, controller };
  },

  isRunActive(runId, controller) {
    return this.state.assessmentRunId === runId
      && this.state.generationController === controller
      && !controller.signal.aborted;
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
      <section class="app-standard-page assessment-container" aria-labelledby="assessmentContentTitle">
        <h2 id="assessmentContentTitle" class="sr-only">水平测评内容</h2>
        <div class="assessment-header">
          <p class="page-eyebrow">05 / BASELINE</p>
          <h1 class="page-title app-route-heading">阅读水平测评</h1>
          <p class="assessment-desc">
            用两篇短文和理解题校准你的阅读起点；结果会推荐合适的材料压力。
          </p>
        </div>

        <div class="assessment-section">
          <h2 class="settings-section-title">选择你的目标考试</h2>
          <p class="settings-desc">选择你正在准备的考试等级，系统将生成对应的目标考试导向材料</p>
          <div class="settings-options">
            <label class="settings-radio">
              <input type="radio" name="assessExam" value="cet4" checked>
              <span class="settings-radio-label">
                <span class="settings-radio-title">四级 (CET-4)</span>
                <span class="settings-radio-desc">大学英语四级导向的阅读语篇</span>
              </span>
            </label>
            <label class="settings-radio">
              <input type="radio" name="assessExam" value="cet6">
              <span class="settings-radio-label">
                <span class="settings-radio-title">六级 (CET-6)</span>
                <span class="settings-radio-desc">大学英语六级导向的阅读语篇</span>
              </span>
            </label>
            <label class="settings-radio">
              <input type="radio" name="assessExam" value="graduate">
              <span class="settings-radio-label">
                <span class="settings-radio-title">考研</span>
                <span class="settings-radio-desc">研究生入学考试导向的阅读语篇</span>
              </span>
            </label>
          </div>
        </div>

        <div class="assessment-info-box">
          <h3>📋 测评流程说明</h3>
          <ol>
            <li>系统生成 2 篇同一目标考试导向的短文，分别采用「巩固」和「加压」材料压力</li>
            <li>逐篇阅读，遇到不认识的单词<strong>点击查看翻译</strong></li>
            <li>阅读完成后，系统显示全文翻译，完成<strong>阅读理解题</strong>并评估理解程度</li>
            <li>系统根据理解题、阅读速度、查词行为和自评，计算推荐设置</li>
          </ol>
          <p class="assessment-info-note">⏱ 预计用时 3-5 分钟</p>
        </div>

        <div class="assessment-actions">
          <button class="btn btn-primary btn-lg" onclick="AssessmentView.startAssessment()">开始测评</button>
          <a href="#/chat" class="btn btn-outline">跳过，直接使用</a>
        </div>
      </section>`;
  },

  // Start assessment - generate articles (parallel: article 1 first, then article 2 in background)
  async startAssessment() {
    if (!Config.hasApiKey()) {
      Modal.showApiSettings();
      return;
    }

    const exam = document.querySelector('input[name="assessExam"]:checked')?.value || 'cet4';
    const { runId, controller } = this.beginAssessmentRun();
    this.state.targetExam = exam;
    this.state.clickedWords = [];
    this.state.articles = [];
    this.state.secondArticleError = '';
    this.state.currentArticle = 0;
    this.state.readingDurations = [0, 0];
    this.state.readingTime = 0;
    this.state.quizAnswers = [{}, {}];

    // Show loading
    this.container.innerHTML = `
      <div class="assessment-container">
        <div class="assessment-loading">
          <div class="loading-spinner"></div>
          <p>正在生成第 1 篇测试文章...</p>
          <p class="text-muted">${DIFFICULTY_LABELS[exam]}（巩固）</p>
        </div>
      </div>`;

    try {
      // Generate article 1 (easy) first
      const article1 = await this.generateAssessmentArticle(exam, 'easy', { signal: controller.signal });
      if (!this.isRunActive(runId, controller)) return;
      this.state.articles.push(article1);

      // Start reading article 1 immediately
      this.state.currentArticle = 0;
      this.renderReadingStep();

      // Generate article 2 (hard) in background
      this.generateAssessmentArticle(exam, 'hard', { signal: controller.signal }).then(article2 => {
        if (!this.isRunActive(runId, controller)) return;
        this.state.articles.push(article2);
        this.state.secondArticleError = '';
      }).catch((err) => {
        if (!this.isRunActive(runId, controller)) return;
        this.state.secondArticleError = err.message || '网络或 API 限流';
      }).finally(() => {
        if (this.state.generationController === controller) this.state.generationController = null;
      });
    } catch (err) {
      if (!this.isRunActive(runId, controller)) return;
      this.state.generationController = null;
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
  async generateAssessmentArticle(exam, level, { signal = null } = {}) {
    const levelLabel = level === 'easy' ? '巩固' : '加压';
    const challenge = level === 'easy' ? 'support' : 'stretch';
    const profile = getDifficultyProfile(exam, challenge);

    const prompt = `你是一位英语考试辅导教师。请生成一篇用于词汇水平测试的英文阅读文章。

难度要求：
${formatProfileConstraints(profile)}

特殊要求：
- 主题选择通用话题（科技/生活/文化/教育/健康），避免专业术语和文化背景知识
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
  "translation": "中文翻译，段落结构与英文一一对应，段落之间用双换行分隔",
  "questions": [
    { "question": "英文理解题", "options": ["A", "B", "C", "D"], "answer": 0 },
    { "question": "英文理解题", "options": ["A", "B", "C", "D"], "answer": 1 },
    { "question": "英文理解题", "options": ["A", "B", "C", "D"], "answer": 2 }
  ]
}`;

    let validation;
    let questionValidation;
    for (let attempt = 0; attempt < 2; attempt++) {
      const retryHint = attempt === 0
        ? `请生成一篇 ${DIFFICULTY_LABELS[exam]}（${levelLabel}材料压力）的测试文章`
        : `上次输出未通过校验（${[
          ...(validation?.deviations || []).map(item => item.code),
          ...(questionValidation?.valid ? [] : ['questions'])
        ].join('、')}）。请调整后重新生成，严格遵守所有要求。`;
      const data = await API.fetch('/chat/completions', {
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: retryHint }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7
      }, 60000, signal);
      const result = JSON.parse(data.choices[0].message.content);
      validation = validateArticle(result.content || '', profile);
      questionValidation = normalizeQuestionSet(result.questions);
      if (!validation.passed || !questionValidation.valid) continue;
      return {
        title: result.title || 'Untitled',
        content: result.content || '',
        translation: result.translation || '',
        questions: questionValidation.questions,
        difficulty: exam,
        level,
        challenge,
        difficultyReport: validation,
        wordCount: validation.metrics.wordCount
      };
    }
    throw new Error('测试文章或阅读理解题未通过校验，请重试');
  },

  // Step 2: Reading step
  renderReadingStep() {
    this.state.step = 'reading';
    this.state.articleReadStartedAt = Date.now();
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

    // 先移除上一篇残留的 document 级监听(读第2篇会再次进入此函数, 否则累积泄漏)
    if (this._globalClickHandler) document.removeEventListener('click', this._globalClickHandler);
    if (this._audioClickHandler) document.removeEventListener('click', this._audioClickHandler);
    if (this._tooltipDismissCleanup) this._tooltipDismissCleanup();

    // Global click handler: dismiss tooltip when clicking outside
    this._globalClickHandler = (e) => {
      const tooltip = document.getElementById('wordTooltip');
      if (!tooltip || tooltip.style.display === 'none') return;
      // Don't dismiss if clicking on tooltip itself (buttons etc.)
      if (tooltip.contains(e.target)) return;
      Tooltip.hide();
    };
    document.addEventListener('click', this._globalClickHandler);
    this._tooltipDismissCleanup = Tooltip.attachAutoDismiss();

    articleBody.addEventListener('click', async (e) => {
      const tooltip = document.getElementById('wordTooltip');
      // 阅读控件和 tooltip 内点击不进入基于 caret 的查词逻辑
      if (tooltip?.contains(e.target) || e.target.closest('button, a, input, textarea, select, [role="button"]')) return;

      // 卡片打开时，正文第一次点击只负责收起，不立即查询其他单词。
      if (Tooltip.isVisible()) {
        e.stopPropagation();
        Tooltip.hide();
        return;
      }

      const word = Tooltip.getWordAtPoint(e);
      if (!word || word.length < 2) return;

      // Stop propagation so global handler doesn't immediately hide the new tooltip
      e.stopPropagation();

      const lookupId = Tooltip.beginLookup(e.clientX, e.clientY);

      try {
        const data = await Dictionary.lookup(word);
        const shown = await Tooltip.show(lookupId, e.clientX, e.clientY, data);
        if (!shown) return;

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
        if (Tooltip.isCurrent(lookupId)) Tooltip.hide();
      }
    });

    // Audio button click
    this._audioClickHandler = (e) => {
      const btn = e.target.closest('.btn-speak');
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        const word = btn.getAttribute('data-word');
        if (word) {
          AudioCache.getAudio(word).catch(err => console.warn('Audio play failed:', err));
        }
      }
    };
    document.addEventListener('click', this._audioClickHandler);
  },

  // Clean up event listeners
  cleanup() {
    if (this.state) {
      this.state.generationController?.abort();
      this.state.generationController = null;
      this.state.assessmentRunId += 1;
    }
    if (this._globalClickHandler) {
      document.removeEventListener('click', this._globalClickHandler);
      this._globalClickHandler = null;
    }
    if (this._audioClickHandler) {
      document.removeEventListener('click', this._audioClickHandler);
      this._audioClickHandler = null;
    }
    if (this._tooltipDismissCleanup) {
      this._tooltipDismissCleanup();
      this._tooltipDismissCleanup = null;
    }
    Tooltip.hide();
  },

  // Finish reading current article
  async finishReading() {
    const runId = this.state.assessmentRunId;
    Tooltip.hide();
    const articleIndex = this.state.currentArticle;
    this.state.readingDurations[articleIndex] = Math.max(1, Math.round((Date.now() - this.state.articleReadStartedAt) / 1000));
    this.state.readingTime = this.state.readingDurations.reduce((total, seconds) => total + seconds, 0);

    if (this.state.currentArticle === 0) {
      // Check if article 2 is ready
      if (this.state.articles.length < 2) {
        // Show loading while waiting for article 2
        this.container.innerHTML = `
          <div class="assessment-container">
            <div class="assessment-loading">
              <div class="loading-spinner"></div>
              <p>第 2 篇文章生成中，请稍候...</p>
              <p class="text-muted">${DIFFICULTY_LABELS[this.state.targetExam]}（加压）</p>
            </div>
          </div>`;
        // Wait for article 2 (it's already generating in background, with 60s timeout)
        const waitStart = Date.now();
        while (this.state.articles.length < 2) {
          if (this.state.assessmentRunId !== runId) return;
          if (this.state.secondArticleError || Date.now() - waitStart > 60000) {
            const reason = esc(this.state.secondArticleError || '网络或 API 限流');
            this.container.innerHTML = `
              <div class="assessment-container">
                <div class="empty-state">
                  <p>第二篇文章生成失败（${reason}）。</p>
                  <button class="btn btn-primary" onclick="AssessmentView.retrySecondArticle()">重新生成第二篇</button>
                  <a href="#/chat" class="btn btn-outline">返回</a>
                </div>
              </div>`;
            return;
          }
          await new Promise(r => setTimeout(r, 500));
        }
      }
      if (this.state.assessmentRunId !== runId) return;
      // Move to article 2
      this.state.currentArticle = 1;
      this.renderReadingStep();
    } else {
      // Both articles done, move to self-assessment
      this.renderSelfAssessStep();
    }
  },

  // Regenerate only the failed second article, preserving completed first-article progress.
  async retrySecondArticle() {
    if (this.state.articles.length >= 2) {
      this.state.currentArticle = 1;
      this.renderReadingStep();
      return;
    }
    const runId = this.state.assessmentRunId;
    this.state.generationController?.abort();
    const controller = new AbortController();
    this.state.generationController = controller;
    this.state.secondArticleError = '';
    this.container.innerHTML = `
      <div class="assessment-container">
        <div class="assessment-loading">
          <div class="loading-spinner"></div>
          <p>正在重新生成第 2 篇测试文章...</p>
          <p class="text-muted">${DIFFICULTY_LABELS[this.state.targetExam]}（加压）</p>
        </div>
    </div>`;
    try {
      const article = await this.generateAssessmentArticle(this.state.targetExam, 'hard', { signal: controller.signal });
      if (!this.isRunActive(runId, controller)) return;
      this.state.articles.push(article);
      this.state.currentArticle = 1;
      this.renderReadingStep();
    } catch (err) {
      if (!this.isRunActive(runId, controller)) return;
      this.state.secondArticleError = err.message || '网络或 API 限流';
      const reason = esc(this.state.secondArticleError);
      this.container.innerHTML = `
        <div class="assessment-container">
          <div class="empty-state">
            <p>第二篇文章生成失败（${reason}）。</p>
            <button class="btn btn-primary" onclick="AssessmentView.retrySecondArticle()">再次重试</button>
            <a href="#/chat" class="btn btn-outline">返回</a>
        </div>
      </div>`;
    } finally {
      if (this.state.generationController === controller) this.state.generationController = null;
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
      const questionsHTML = (article.questions || []).map((question, questionIndex) => `
        <fieldset class="assessment-question">
          <legend>${questionIndex + 1}. ${esc(question.question)}</legend>
          ${question.options.map((option, optionIndex) => `
            <label><input type="radio" name="assessmentQuestion-${i}-${questionIndex}" value="${optionIndex}"> ${esc(option)}</label>`).join('')}
        </fieldset>`).join('');

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
          ${questionsHTML ? `<div class="assessment-questions"><h4>阅读理解</h4>${questionsHTML}</div>` : ''}
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
    this.readQuizAnswers();
    const allQuestionsAnswered = this.state.articles.every((article, articleIndex) =>
      hasCompleteAnswers(article.questions, this.state.quizAnswers[articleIndex])
    );
    if (!allQuestionsAnswered) {
      this.showIncompleteQuestionMessage();
      return;
    }
    this.state.step = 'result';

    const result = this.calculateResult();
    this.renderResultStep(result);
  },

  showIncompleteQuestionMessage() {
    const actions = this.container?.querySelector('.assessment-actions');
    if (!actions || document.getElementById('assessmentQuizError')) return;
    actions.insertAdjacentHTML('beforebegin', `
      <div id="assessmentQuizError" class="assessment-info-box" role="alert">
        请完成全部阅读理解题后查看结果
      </div>`);
  },

  readQuizAnswers() {
    this.state.quizAnswers = this.state.articles.map((article, articleIndex) =>
      Object.fromEntries((article.questions || []).map((_, questionIndex) => {
        const selected = document.querySelector(`input[name="assessmentQuestion-${articleIndex}-${questionIndex}"]:checked`);
        return [questionIndex, selected ? Number.parseInt(selected.value, 10) : null];
      }))
    );
  },

  // Calculate a transparent reading profile from observable assessment signals.
  calculateResult() {
    const stats = this.calculateStats();
    const attempts = this.state.articles.map((article, i) => {
      const aStats = this.calculateStatsForArticle(i);
      const questions = article.questions || [];
      const answers = this.state.quizAnswers[i] || {};
      return {
        wordCount: article.wordCount,
        elapsedSeconds: this.state.readingDurations[i] || 0,
        comprehensionCorrect: questions.filter((question, questionIndex) => answers[questionIndex] === question.answer).length,
        comprehensionTotal: questions.length,
        explicitLookups: aStats.totalClicked,
        confidence: 1 + ((this.state.selfAssessment[i] || 50) / 100) * 4
      };
    });
    const readingProfile = buildReadingProfile(attempts);
    const perArticleProfiles = attempts.map(attempt => buildReadingProfile([attempt]));

    // Determine frequency profile
    const highFreqRate = stats.highFreqCount <= 2 ? 'excellent' : stats.highFreqCount <= 5 ? 'good' : 'weak';
    const midFreqRate = stats.midFreqCount <= 5 ? 'excellent' : stats.midFreqCount <= 10 ? 'good' : 'weak';
    const recommendedChallenge = readingProfile.comprehensionAccuracy === null || readingProfile.comprehensionAccuracy < 65 || readingProfile.averageConfidence < 3
      ? 'support'
      : readingProfile.comprehensionAccuracy >= 82 && readingProfile.lookupRate <= 18 ? 'stretch' : 'standard';
    const coveragePreference = normalizeCoveragePreference(recommendedChallenge);
    const recommendedDifficulty = this.state.targetExam;
    const recommendedLevel = recommendedChallenge === 'support' ? 'easy' : recommendedChallenge === 'stretch' ? 'hard' : 'normal';
    const recommendedCoverage = coveragePreference.coverage;
    const recommendedNewWordPercent = 100 - recommendedCoverage;

    return {
      readingProfile,
      perArticleProfiles,
      highFreqRate,
      midFreqRate,
      stats,
      recommendedDifficulty,
      recommendedChallenge,
      recommendedLevel,
      recommendedCoverage,
      recommendedNewWordPercent
    };
  },

  // Render result step
  renderResultStep(result) {
    const examLabels = { cet4: '四级', cet6: '六级', kaoyan1: '考研英语一', kaoyan2: '考研英语二', graduate: '考研通用' };
    const levelLabels = { easy: '巩固', normal: '对标', hard: '加压' };
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
              <span class="result-vocab-num">${result.readingProfile.averageWpm}</span>
              <span class="result-vocab-label">平均阅读速度（词/分钟）</span>
            </div>
            <div class="result-bar-container">
              <div class="result-bar">
                <div class="result-bar-fill" style="width: ${Math.min(100, result.readingProfile.comprehensionAccuracy ?? 0)}%"></div>
              </div>
              <span class="result-bar-text">理解题正确率 ${result.readingProfile.comprehensionAccuracy ?? '暂无'}${result.readingProfile.comprehensionAccuracy === null ? '' : '%'}</span>
            </div>
          </div>

          <div class="result-detail-grid">
            <div class="result-detail-item">
              <span class="result-detail-icon">${freqIcons[result.highFreqRate]}</span>
              <span class="result-detail-label">高频词阅读表现</span>
              <span class="result-detail-value">${freqTexts[result.highFreqRate]}</span>
            </div>
            <div class="result-detail-item">
              <span class="result-detail-icon">${freqIcons[result.midFreqRate]}</span>
              <span class="result-detail-label">中频词阅读表现</span>
              <span class="result-detail-value">${freqTexts[result.midFreqRate]}</span>
            </div>
            <div class="result-detail-item">
              <span class="result-detail-icon">📝</span>
              <span class="result-detail-label">显式查词率</span>
              <span class="result-detail-value">${result.readingProfile.lookupRate} / 千词</span>
            </div>
            <div class="result-detail-item">
              <span class="result-detail-icon">⏱</span>
              <span class="result-detail-label">自评信心</span>
              <span class="result-detail-value">${result.readingProfile.averageConfidence} / 5</span>
            </div>
          </div>

          <div class="result-per-article">
            <div class="result-per-article-item">
              <span>第 1 篇（巩固）理解率</span>
              <strong>${result.perArticleProfiles[0]?.comprehensionAccuracy ?? '暂无'}${result.perArticleProfiles[0]?.comprehensionAccuracy === null ? '' : '%'}</strong>
            </div>
            <div class="result-per-article-item">
              <span>第 2 篇（加压）理解率</span>
              <strong>${result.perArticleProfiles[1]?.comprehensionAccuracy ?? '暂无'}${result.perArticleProfiles[1]?.comprehensionAccuracy === null ? '' : '%'}</strong>
            </div>
          </div>

          <div class="result-recommend">
            <h3>🎯 推荐设置</h3>
            <div class="result-recommend-grid">
              <div class="result-recommend-item">
                <span class="result-recommend-label">目标考试与材料压力</span>
                <span class="result-recommend-value">
                  <span class="badge badge-${result.recommendedDifficulty}">${examLabels[result.recommendedDifficulty]}</span>
                  ${levelLabels[result.recommendedLevel]}
                </span>
              </div>
              <div class="result-recommend-item">
                <span class="result-recommend-label">材料目标覆盖率</span>
                <span class="result-recommend-value">${result.recommendedCoverage}%（词汇压力约 ${result.recommendedNewWordPercent}%）</span>
              </div>
            </div>
          </div>

          <div class="result-explain">
            <h3>📖 说明</h3>
            <ul>
              <li><strong>材料目标覆盖率 ${result.recommendedCoverage}%</strong>：用于控制生成材料的词汇压力；不是对你已掌握词汇的估计</li>
              <li>Nation 的词汇覆盖率研究将 98% 作为舒适阅读的参考；本应用该范围设定材料目标，不把它当成个人词汇量结论</li>
              <li>本报告只汇总理解题、阅读速度、显式查词与自评信心；不会由这些行为推算你的词汇总量</li>
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
    Config.set('assessment_profile', JSON.stringify(result.readingProfile));
    Config.set('assessment_date', new Date().toISOString());

    // Apply recommended settings (coverage derived from new_word_percent)
    // The chosen target exam is never inferred from performance. This legacy
    // screen only updates the material pressure; new calibration uses
    // CalibrationView instead.
    Config.set('reading_mode', result.recommendedChallenge);
    Config.set('level', result.recommendedLevel);
    Config.set('new_word_percent', result.recommendedNewWordPercent.toString());
    Config.set('coverage', result.recommendedCoverage.toString());

    const challengeLabel = result.recommendedChallenge === 'support' ? '巩固'
      : result.recommendedChallenge === 'stretch' ? '加压' : '对标';
    alert('设置已应用！\n\n' +
      `目标考试：${DIFFICULTY_LABELS[result.recommendedDifficulty]}\n` +
      `材料压力：${challengeLabel}\n` +
      `材料目标覆盖率：${result.recommendedCoverage}%（词汇压力约 ${result.recommendedNewWordPercent}%）\n\n` +
      '可在「设置」页面随时调整。'
    );

    location.hash = '#/chat';
  }
};

window.AssessmentView = AssessmentView;
