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

import { DB } from '../db.js';
import { SpacedRepetition } from '../spaced-repetition.js';
import { Dictionary } from '../dictionary.js';
import { esc } from '../helpers.js';
import { Config } from '../config.js';
import { Modal } from '../components/modal.js';
import { API } from '../api.js';
import { ChatView } from './chat.js';
import { Examples } from '../examples.js';
import { Affixes } from '../affixes.js';
import {
  REVIEW_PHASES,
  createReviewState,
  revealMeaning,
  startRating,
  finishRating,
  skipWord,
  nextWord
} from '../flashcard-flow.mjs';

export const FlashcardView = {
  words: [],
  currentIndex: 0,
  ratingCounts: { 1: 0, 3: 0, 5: 0 },
  reviewedWords: [],       // Current session
  reviewState: createReviewState(),
  studyTab: 'examples',
  studyDetails: { examples: [], rootAnalysis: null, loading: false },
  cardSession: 0,
  container: null,
  currentTranslation: '',
  currentPhonetic: '',

  // Today's reviewed words (persisted across sessions)
  TODAY_KEY: 'todayReviewedWords',

  getTodayKey() {
    // Use local timezone (not UTC) so day resets at midnight local time
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },

  loadTodayWords() {
    try {
      const data = JSON.parse(localStorage.getItem(this.TODAY_KEY));
      if (data && data.date === this.getTodayKey()) return data.words;
    } catch {}
    return [];
  },

  saveTodayWords(words) {
    localStorage.setItem(this.TODAY_KEY, JSON.stringify({
      date: this.getTodayKey(),
      words
    }));
  },

  addTodayWord(wordData) {
    const today = this.loadTodayWords();
    const idx = today.findIndex(w => w.word === wordData.word);
    if (idx === -1) {
      today.push(wordData);
    } else {
      // 同词再次评分: 用最新 quality 覆盖(否则巩固词集会用陈旧评分)
      today[idx] = { ...today[idx], ...wordData };
    }
    this.saveTodayWords(today);
  },

  // Render flashcard view
  async render(container) {
    this.container = container;
    const allWords = await DB.getAllLearnWords();
    const dueWords = SpacedRepetition.getDueWords(allWords);

    if (dueWords.length === 0) {
      const totalWords = allWords.length;
      const masteredCount = allWords.filter(w => SpacedRepetition.getStatus(w) === 'mastered').length;
      container.innerHTML = `
        <section class="app-standard-page flashcard-review-shell flashcard-review-shell--empty" aria-labelledby="flashcardContentTitle">
          <div class="flashcard-container">
          <h2 id="flashcardContentTitle" class="sr-only">单词复习内容</h2>
          <div class="empty-state flashcard-empty-sheet">
            <p>🎉 暂时没有需要复习的单词</p>
            ${totalWords > 0 ? `<p>共 ${totalWords} 个单词，${masteredCount} 个已掌握</p>` : ''}
            <p>去阅读页面收藏新单词，或导入单词到学习词库。</p>
            <div style="display:flex;gap:12px;justify-content:center;margin-top:16px">
              <a href="#/chat" class="btn btn-primary">去阅读</a>
              <a href="#/learn-words" class="btn btn-outline">学习词库</a>
            </div>
          </div>
          </div>
        </section>`;
      return;
    }

    this.words = dueWords;
    this.currentIndex = 0;
    this.ratingCounts = { 1: 0, 3: 0, 5: 0 };
    this.reviewedWords = [];

    this.renderCard(container);
  },

  // Check how many words are due
  async getDueCount() {
    const allWords = await DB.getAllLearnWords();
    return SpacedRepetition.getDueCount(allWords);
  },

  // Render a single word at the start of its recall phase.
  async renderCard(container) {
    if (this.currentIndex >= this.words.length) {
      this.renderResult(container);
      return;
    }

    const session = ++this.cardSession;
    const word = this.words[this.currentIndex];
    this.reviewState = createReviewState();
    this.studyTab = 'examples';
    this.studyDetails = { examples: [], rootAnalysis: null, loading: false };
    this.reviewNotice = '';

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

    if (session !== this.cardSession) return;
    this.currentTranslation = translation;
    this.currentPhonetic = phonetic;
    this.renderRecall(container);
  },

  renderProgress(phase) {
    const word = this.words[this.currentIndex];
    const statusInfo = SpacedRepetition.getStatusDisplay(word);
    const progress = Math.round((this.currentIndex / this.words.length) * 100);
    return `
      <div class="flashcard-progress-block">
      <div class="flashcard-progress">
        <span class="page-eyebrow">03 / ${phase}</span>
        <span class="flashcard-progress-count">${this.currentIndex + 1} / ${this.words.length}</span>
        <span class="flashcard-status-badge" style="--status-color:${statusInfo.color}">${statusInfo.icon} ${statusInfo.label}</span>
      </div>
      <div class="flashcard-progress-bar" aria-hidden="true">
        <div class="flashcard-progress-fill" style="width:${progress}%"></div>
      </div>
      </div>`;
  },

  renderRecall(container) {
    const word = this.words[this.currentIndex];
    const { meaningRevealed, isSubmitting } = this.reviewState;
    const knownDisabled = meaningRevealed || isSubmitting;
    const submitLabel = isSubmitting ? '保存中…' : '';

    container.innerHTML = `
      <main class="app-standard-page flashcard-review-shell flashcard-review-shell--recall" aria-labelledby="flashcardContentTitle">
        <div class="flashcard-container">
          <h2 id="flashcardContentTitle" class="sr-only">单词回忆评分</h2>
          ${this.renderProgress('RECALL')}
          <section class="flashcard flashcard-recall-card flashcard-recall-stage" aria-live="polite">
            <div class="flashcard-front">
              <div class="flashcard-word">${esc(word.word)}</div>
              ${this.currentPhonetic ? `<div class="flashcard-phonetic">[${esc(this.currentPhonetic)}]</div>` : ''}
              ${meaningRevealed
                ? `<div class="flashcard-recall-meaning">${esc(this.currentTranslation)}</div><p class="flashcard-hint">已查看释义，请按真实回忆选择“模糊”或“忘了”</p>`
                : `<button class="flashcard-reveal-btn" type="button" onclick="FlashcardView.showMeaning()">点击查看释义</button>`}
            </div>
          </section>
          ${this.reviewNotice ? `<p class="flashcard-review-notice" role="alert">${esc(this.reviewNotice)}</p>` : ''}
          <div class="flashcard-actions flashcard-rating-group" aria-label="回忆评分">
            <button class="flashcard-rating-btn flashcard-btn-knew" type="button" ${knownDisabled ? 'disabled' : ''}
              onclick="FlashcardView.submitRating(5)" title="未查看释义就认识"><i class="fa-regular fa-face-smile flashcard-rating-icon" aria-hidden="true"></i><span>${submitLabel || '认识'}</span></button>
            <button class="flashcard-rating-btn flashcard-btn-fuzzy" type="button" ${isSubmitting ? 'disabled' : ''}
              onclick="FlashcardView.submitRating(3)" title="记得不够确定"><i class="fa-regular fa-face-meh flashcard-rating-icon" aria-hidden="true"></i><span>${submitLabel || '模糊'}</span></button>
            <button class="flashcard-rating-btn flashcard-btn-forgot" type="button" ${isSubmitting ? 'disabled' : ''}
              onclick="FlashcardView.submitRating(1)" title="没有回忆起来"><i class="fa-regular fa-face-frown flashcard-rating-icon" aria-hidden="true"></i><span>${submitLabel || '忘了'}</span></button>
          </div>
          <div class="flashcard-skip">
            <button class="flashcard-skip-btn" type="button" ${isSubmitting ? 'disabled' : ''} onclick="FlashcardView.skip()">跳过</button>
          </div>
        </div>
      </main>`;
  },

  showMeaning() {
    const nextState = revealMeaning(this.reviewState);
    if (nextState === this.reviewState) return;
    this.reviewState = nextState;
    this.renderRecall(this.container);
  },

  async submitRating(quality) {
    const submittingState = startRating(this.reviewState, quality);
    if (!submittingState) return;

    const session = this.cardSession;
    this.reviewState = submittingState;
    this.renderRecall(this.container);

    try {
      await this.recordRating(quality);
    } catch {
      if (session !== this.cardSession) return;
      this.reviewState = {
        ...this.reviewState,
        pendingQuality: null,
        isSubmitting: false
      };
      this.reviewNotice = '评分保存失败，请重试。';
      this.renderRecall(this.container);
      return;
    }

    if (session !== this.cardSession) return;
    this.reviewState = finishRating(this.reviewState);
    this.studyDetails = { examples: [], rootAnalysis: null, loading: true };
    this.renderStudy(this.container);
    this.loadStudyDetails(session);
  },

  renderStudy(container) {
    const word = this.words[this.currentIndex];
    const tabs = [
      ['examples', '例句'],
      ['roots', '词根'],
      ['related', '同根词'],
      ['memory', '记忆法']
    ];

    container.innerHTML = `
      <main class="app-standard-page flashcard-review-shell flashcard-review-shell--study" aria-labelledby="flashcardStudyTitle">
        <div class="flashcard-container">
          <h2 id="flashcardStudyTitle" class="sr-only">单词学习详情</h2>
          ${this.renderProgress('STUDY')}
          <section class="flashcard-study-sheet">
            <div class="flashcard-study-head">
              <div class="flashcard-study-word">${esc(word.word)}</div>
              ${this.currentPhonetic ? `<div class="flashcard-phonetic">[${esc(this.currentPhonetic)}]</div>` : ''}
              <div class="flashcard-study-translation">${esc(this.currentTranslation)}</div>
              ${word.interval ? `<div class="flashcard-interval">当前间隔：${SpacedRepetition.getIntervalText(word.interval)}</div>` : ''}
            </div>
            <div class="flashcard-study-panel" role="tabpanel">
              ${this.renderStudyPanel()}
            </div>
            <div class="flashcard-study-tabs" role="tablist" aria-label="学习资料">
              ${tabs.map(([id, label]) => `<button class="flashcard-study-tab ${this.studyTab === id ? 'active' : ''}" type="button" role="tab" aria-selected="${this.studyTab === id}" onclick="FlashcardView.setStudyTab('${id}')">${label}</button>`).join('')}
            </div>
          </section>
          <div class="flashcard-study-next">
            <button class="flashcard-next-btn" type="button" onclick="FlashcardView.advanceToNextWord()">下一词</button>
          </div>
        </div>
      </main>`;
  },

  renderStudyPanel() {
    if (this.studyDetails.loading) {
      return '<div class="flashcard-study-loading">正在整理学习资料…</div>';
    }

    const { examples, rootAnalysis } = this.studyDetails;
    if (this.studyTab === 'examples') {
      if (!examples.length) return '<div class="flashcard-study-empty">暂无例句，下一次复习时会继续补充。</div>';
      return `<ol class="flashcard-example-list">${examples.map((example, index) => `
        <li class="flashcard-example-item">
          <p>${esc(example)}</p>
          <button class="example-translate-btn" type="button" onclick="FlashcardView.translateExample(${index}, this)" title="翻译例句">译</button>
          <div class="example-translation" id="exTrans${index}"></div>
        </li>`).join('')}</ol>`;
    }

    if (this.studyTab === 'roots') {
      if (!rootAnalysis?.breakdown && !rootAnalysis?.origin) return '<div class="flashcard-study-empty">暂无词根分析。</div>';
      return `
        ${rootAnalysis.breakdown ? `<div class="flashcard-root-breakdown">${esc(rootAnalysis.breakdown)}</div>` : ''}
        ${rootAnalysis.origin ? `<div class="flashcard-root-origin">词源：${esc(rootAnalysis.origin)}</div>` : ''}`;
    }

    if (this.studyTab === 'related') {
      const relatedWords = Affixes.getRelatedWordDetails(rootAnalysis);
      if (!relatedWords.length) return '<div class="flashcard-study-empty">暂无同根词。</div>';
      return `<div class="flashcard-related-list">${relatedWords.map(({ word, translation }) => `
        <div class="flashcard-related-word">
          <span class="flashcard-related-term">${esc(word)}</span>
          <span class="flashcard-related-translation">${translation ? esc(translation) : '暂无释义'}</span>
        </div>`).join('')}</div>`;
    }

    if (!rootAnalysis?.memoryTip) return '<div class="flashcard-study-empty">暂无记忆法。</div>';
    return `<p class="flashcard-memory-tip">${esc(rootAnalysis.memoryTip)}</p>`;
  },

  setStudyTab(tab) {
    if (this.reviewState.phase !== REVIEW_PHASES.STUDY || !['examples', 'roots', 'related', 'memory'].includes(tab)) return;
    this.studyTab = tab;
    this.renderStudy(this.container);
  },

  async loadStudyDetails(session) {
    const word = this.words[this.currentIndex];
    const [examples, rootAnalysis] = await Promise.all([
      Examples.getExamples(word.word).catch(() => []),
      Affixes.getAnalysis(word.word).catch(() => null)
    ]);

    if (session !== this.cardSession || this.reviewState.phase !== REVIEW_PHASES.STUDY) return;
    this._currentExamples = examples;
    this.studyDetails = { examples, rootAnalysis, loading: false };
    this.renderStudy(this.container);
    this.loadRelatedTranslations(session, word.word, rootAnalysis);
  },

  async loadRelatedTranslations(session, word, rootAnalysis) {
    if (!rootAnalysis || Affixes.getRelatedWordDetails(rootAnalysis).every(item => item.translation)) return;
    const enriched = await Affixes.enrichRelatedTranslations(word, rootAnalysis).catch(() => rootAnalysis);
    if (session !== this.cardSession || this.reviewState.phase !== REVIEW_PHASES.STUDY || !enriched) return;
    this.studyDetails = { ...this.studyDetails, rootAnalysis: enriched };
    if (this.studyTab === 'related') this.renderStudy(this.container);
  },

  advanceToNextWord() {
    if (!nextWord(this.reviewState)) return;
    this.currentIndex++;
    this.renderCard(this.container);
  },

  restart() {
    this.render(this.container);
  },

  // Record a rating
  async recordRating(quality) {
    const word = this.words[this.currentIndex];
    const srsData = SpacedRepetition.calculateNext(word, quality);
    await DB.updateLearnWordSRS(word.id, srsData);

    this.ratingCounts[quality] = (this.ratingCounts[quality] || 0) + 1;

    const wordData = {
      word: word.word,
      translation: word.translation || this.currentTranslation,
      quality
    };
    this.reviewedWords.push(wordData);

    // Persist to today's words
    this.addTodayWord(wordData);
  },

  // Skip current word (don't rate)
  skip() {
    if (!skipWord(this.reviewState)) return;
    this.currentIndex++;
    this.renderCard(this.container);
  },

  // Render completion result
  renderResult(container) {
    const total = this.ratingCounts[1] + this.ratingCounts[3] + this.ratingCounts[5];
    const accuracy = total > 0 ? Math.round((this.ratingCounts[5] + this.ratingCounts[3]) / total * 100) : 0;
    // Today's accumulated words (across multiple review sessions)
    const todayWords = this.loadTodayWords();
    const todayTotal = todayWords.length;
    const todayForgot = todayWords.filter(w => w.quality === 1).map(w => w.word);
    const todayFuzzy = todayWords.filter(w => w.quality === 3).map(w => w.word);
    const todayReinforce = [...todayForgot, ...todayFuzzy];
    const canGenerate = todayTotal >= 3;

    container.innerHTML = `
      <main class="app-standard-page flashcard-review-shell flashcard-review-shell--result" aria-labelledby="flashcardResultTitle">
      <div class="flashcard-container">
        <section class="flashcard-result flashcard-result-sheet">
          <h2 id="flashcardResultTitle">复习完成</h2>
          <div class="flashcard-result-stats">
            <div class="flashcard-result-stat">
              <span class="flashcard-result-num">${total}</span>
              <span class="flashcard-result-label">总复习</span>
            </div>
            <div class="flashcard-result-stat">
              <span class="flashcard-result-num" style="color:var(--success)">${this.ratingCounts[5]}</span>
              <span class="flashcard-result-label">认识</span>
            </div>
            <div class="flashcard-result-stat">
              <span class="flashcard-result-num" style="color:var(--warning)">${this.ratingCounts[3]}</span>
              <span class="flashcard-result-label">模糊</span>
            </div>
            <div class="flashcard-result-stat">
              <span class="flashcard-result-num" style="color:var(--danger)">${this.ratingCounts[1]}</span>
              <span class="flashcard-result-label">忘记</span>
            </div>
          </div>
          <div class="flashcard-result-accuracy">
            正确率：${accuracy}%
          </div>
          <p class="flashcard-result-hint">
            ${accuracy >= 80 ? '💪 表现很好！继续保持。' : accuracy >= 50 ? '📖 还需要多复习，加油！' : '🔄 建议降低复习难度，循序渐进。'}
          </p>

          ${todayTotal > this.reviewedWords.length ? `
          <div class="flashcard-result-today">
            📅 今日累计复习：<strong>${todayTotal}</strong> 个单词（本轮 ${this.reviewedWords.length} 个）
          </div>` : ''}

          ${canGenerate ? `
          <div class="flashcard-result-generate">
            <h3>📝 巩固阅读</h3>
            <p class="flashcard-result-hint">使用今天复习的词汇生成阅读文章，在语境中巩固记忆${todayReinforce.length > 0 ? '（优先使用记不住的词）' : ''}</p>
            <div style="display:flex;gap:8px;justify-content:center;margin-top:10px;flex-wrap:wrap">
              <button class="btn btn-primary" onclick="FlashcardView.generateReviewArticle('all')">生成阅读（今日全部 ${todayTotal} 词）</button>
              ${todayReinforce.length > 0 && todayReinforce.length < todayTotal ? `
              <button class="btn btn-outline" onclick="FlashcardView.generateReviewArticle('weak')">重点巩固（${todayReinforce.length} 个薄弱词）</button>
              ` : ''}
            </div>
          </div>` : todayTotal > 0 ? `
          <div class="flashcard-result-generate">
            <p class="flashcard-result-hint">今日已复习 ${todayTotal} 个词，再复习 ${3 - todayTotal} 个即可生成巩固阅读</p>
          </div>` : ''}

          <div style="display:flex;gap:12px;justify-content:center;margin-top:16px;flex-wrap:wrap">
            <a href="#/chat" class="btn btn-outline">返回阅读</a>
            <a href="#/learn-words" class="btn btn-outline">词库管理</a>
            <button class="btn btn-outline" onclick="FlashcardView.restart()">再来一轮</button>
          </div>
        </section>
      </div>
      </main>`;
  },

  // Translate an example sentence
  async translateExample(index, btn) {
    const transEl = document.getElementById(`exTrans${index}`);
    if (!transEl) return;

    // Toggle if already translated
    if (transEl.textContent) {
      transEl.textContent = '';
      btn.textContent = '译';
      return;
    }

    btn.textContent = '...';
    const examples = this._currentExamples;
    if (!examples || !examples[index]) return;

    try {
      const translation = await API.translateSentence(examples[index]);
      transEl.textContent = translation;
      btn.textContent = '收';
    } catch {
      btn.textContent = '译';
    }
  },

  // Generate article using today's reviewed words
  async generateReviewArticle(mode) {
    if (!Config.hasApiKey()) {
      Modal.showApiSettings();
      return;
    }

    // Use today's accumulated words (not just current session)
    const todayWords = this.loadTodayWords();

    let words;
    if (mode === 'weak') {
      words = todayWords.filter(w => w.quality <= 3).map(w => w.word);
    } else {
      words = todayWords.map(w => w.word);
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

window.FlashcardView = FlashcardView;
