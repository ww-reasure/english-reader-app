/**
 * Vocabulary View
 * Displays and manages saved words with manage mode
 */

import { DB } from '../db.js';
import { Dictionary } from '../dictionary.js';
import { esc } from '../helpers.js';
import { formatPhonetic, getDefinitionDisplayLines, getSavableTranslation } from '../components/definition-trust.mjs';
import { ensureSavedWordDefinition } from '../components/saved-word-definition.mjs';
import { WordStudyDetail } from '../components/word-study-detail.js';
import { resolvePracticeScope, createPracticeSession, getPracticeScopeStatus } from '../review-practice.mjs';

function renderDefinitionPreview(word) {
  const primary = getDefinitionDisplayLines(word)[0];
  return primary ? `${primary.label} ${primary.glossZh}` : getSavableTranslation(word) || '待重新查询';
}

export const VocabularyView = {
  container: null,
  manageMode: false,
  selectionMode: false,
  selectedWordIds: new Set(),
  learnWordsByWord: new Map(),

  // Render vocabulary view
  async render(container) {
    this.container = container;
    const words = await DB.getAllWords();
    const learnWords = await DB.getAllLearnWords();
    this.learnWordsByWord = new Map();
    for (const learnWord of learnWords) {
      const key = String(learnWord?.word || '').trim().toLowerCase();
      if (key && !this.learnWordsByWord.has(key)) this.learnWordsByWord.set(key, learnWord);
    }

    const practiceable = words.filter(word => this.learnWordsByWord.has(String(word.word || '').trim().toLowerCase()));
    const dayMs = 24 * 60 * 60 * 1000;
    const todayBoundary = new Date();
    todayBoundary.setHours(0, 0, 0, 0);
    // 当前词集按学习词库 id 去重计算，与 resolvePracticeScope 口径一致；
    // 未进入学习词库的词（practiceable 之外的）不计入，也不参与解锁。
    const idsFor = (filtered) => [...new Set(filtered.map(word => {
      const libraryWord = this.learnWordsByWord.get(String(word.word || '').trim().toLowerCase());
      return libraryWord ? Number(libraryWord.id) : null;
    }).filter(Number.isFinite))];
    const todayStatus = getPracticeScopeStatus({
      scope: 'today_added',
      currentWordIds: idsFor(practiceable.filter(word => Number(word.createdAt) >= todayBoundary.getTime()))
    });
    const recentStatus = getPracticeScopeStatus({
      scope: 'recent_added',
      currentWordIds: idsFor(practiceable.filter(word => Number(word.createdAt) >= Date.now() - 7 * dayMs))
    });

    let cards = '';
    if (words.length === 0) {
      cards = '<div class="empty-state">还没有收藏单词。在阅读页面单击单词即可收藏！</div>';
    } else {
      const headerActions = this.manageMode
        ? `<button class="btn btn-danger btn-sm" onclick="VocabularyView.clearAll()">清空全部</button>
           <button class="btn btn-outline btn-sm" onclick="VocabularyView.toggleManage()">完成</button>`
        : `${this.selectionMode
            ? `<button class="btn btn-primary btn-sm vocab-practice-start-btn" onclick="VocabularyView.startManualPractice()">开始复习（${this.selectedWordIds.size}）</button>
               <button class="btn btn-outline btn-sm" onclick="VocabularyView.toggleSelection()">取消</button>`
            : `<a href="#/flashcard" class="btn btn-primary btn-sm">开始复习</a>
               <button class="btn btn-outline btn-sm" onclick="VocabularyView.toggleSelection()">选词复习</button>`}
           <button class="btn btn-outline btn-sm" onclick="VocabularyView.toggleManage()">管理</button>`;

      cards = `
        <div class="learn-words-header">
          <span>共 ${words.length} 个单词</span>
          <div>${headerActions}</div>
        </div>
        ${this.selectionMode ? `
        <div class="vocab-practice-note">勾选要专项复习的单词，点击“开始复习”进入练习。练习只记录本次结果，不影响正式复习计划。</div>` : `
        <section class="vocab-practice" aria-label="专项复习">
          <h3 class="vocab-practice-title">专项复习</h3>
          <p class="vocab-practice-desc">只练你指定的词，不动正式复习计划。</p>
          <div class="vocab-practice-grid">
            ${this.renderPracticeEntry({ scope: 'today_added', name: '今日新增', status: todayStatus })}
            ${this.renderPracticeEntry({ scope: 'recent_added', name: '最近 7 天', status: recentStatus })}
            <button type="button" class="vocab-practice-entry" onclick="VocabularyView.toggleSelection()">
              <span class="vocab-practice-entry-name">自选单词</span>
              <span class="vocab-practice-entry-count">手动勾选</span>
            </button>
          </div>
        </section>`}
        <div class="vocab-list" data-vocab-grid="vocab">`;

      words.forEach(word => {
        const deleteBtn = this.manageMode
          ? `<button class="learn-word-remove" onclick="VocabularyView.deleteWord(${word.id})" title="移除">×</button>`
          : '';
        const selectBox = this.selectionMode
          ? `<label class="vocab-practice-check" title="选择此单词">
               <input type="checkbox" data-practice-word="${word.id}" ${this.selectedWordIds.has(word.id) ? 'checked' : ''}
                 onchange="VocabularyView.toggleSelectedWord(${word.id}, this.checked)">
             </label>`
          : '';
        const practiceableMark = this.selectionMode && !this.learnWordsByWord.has(String(word.word || '').trim().toLowerCase())
          ? '<span class="vocab-practice-unavailable" title="尚未进入学习词库，无法专项复习">未入词库</span>'
          : '';

        cards += `
          <div class="vocab-card ${this.manageMode ? 'manage-mode' : ''} ${this.selectionMode ? 'selection-mode' : ''}" id="vocab-${word.id}"
               ${!this.manageMode && !this.selectionMode ? `onclick="VocabularyView.showWordDetail(${word.id})"` : ''}>
            ${selectBox}
            <div class="vocab-word">
              <span class="word">${esc(word.word)}</span>
              ${formatPhonetic(word.phonetic) ? `<span class="phonetic">${esc(formatPhonetic(word.phonetic))}</span>` : ''}
            </div>
            <div class="vocab-translation">${esc(renderDefinitionPreview(word))}${practiceableMark}</div>
            ${deleteBtn}
          </div>`;
      });

      cards += '</div>';
    }

    container.innerHTML = `
      <section class="app-standard-page vocab-container" aria-labelledby="vocabularyContentTitle">
        <h2 id="vocabularyContentTitle" class="sr-only">词汇学习内容</h2>
        <header class="page-heading app-route-heading">
          <p class="page-eyebrow">03 / WORD NOTES</p>
          <h1 class="page-title">我的生词本</h1>
          <p class="page-desc">把阅读时停下来的词，整理成以后会再遇见的笔记。</p>
        </header>
        ${cards}
      </section>`;
  },

  // Render one time-scoped practice entry with three states:
  //  - open:        nothing reviewed yet, starts a full round;
  //  - incremental: reviewed words exist and new words arrived, starts with only the new words;
  //  - locked:      every current word was reviewed today, only “再来一轮” reopens it.
  renderPracticeEntry({ scope, name, status }) {
    const reviewedCount = status.reviewedIds.length;
    const newCount = status.newIds.length;
    const totalCount = reviewedCount + newCount;
    if (status.done) {
      return `<div class="vocab-practice-entry vocab-practice-entry--done" title="今天已完成一轮，可再来一轮">
        <span class="vocab-practice-entry-name">${name}<span class="vocab-practice-done-badge">今日已复习</span></span>
        <span class="vocab-practice-entry-count">已复习 ${reviewedCount} 词 · 当前 ${totalCount} 词</span>
        <button type="button" class="vocab-practice-again" onclick="VocabularyView.startPractice('${scope}', { reviewAll: true })">再来一轮</button>
      </div>`;
    }
    const countLabel = reviewedCount > 0
      ? `已复习 ${reviewedCount} 词 · 新增 ${newCount} 词`
      : `${totalCount} 词`;
    return `<button type="button" class="vocab-practice-entry" onclick="VocabularyView.startPractice('${scope}')">
      <span class="vocab-practice-entry-name">${name}</span>
      <span class="vocab-practice-entry-count">${countLabel}</span>
    </button>`;
  },

  // Toggle manage mode
  async toggleManage() {
    if (this.selectionMode) this.selectionMode = false;
    this.selectedWordIds.clear();
    this.manageMode = !this.manageMode;
    await this.render(this.container);
  },

  async toggleSelection() {
    if (this.manageMode) this.manageMode = false;
    this.selectionMode = !this.selectionMode;
    this.selectedWordIds.clear();
    await this.render(this.container);
  },

  toggleSelectedWord(id, checked) {
    if (checked) this.selectedWordIds.add(Number(id));
    else this.selectedWordIds.delete(Number(id));
    const button = document.querySelector('.vocab-practice-start-btn');
    if (button) button.textContent = `开始复习（${this.selectedWordIds.size}）`;
  },

  async startPractice(scope, options = {}) {
    const reviewAll = Boolean(options?.reviewAll);
    const result = await resolvePracticeScope({ db: DB, scope, now: Date.now() });
    if (!result.words.length) {
      alert('这些词还没有进入学习词库。先在阅读页收藏并同步，或到“学习词库”导入后即可专项复习。');
      return;
    }
    const currentIds = result.words.map(word => word.id);
    let wordIds = currentIds;
    if (!reviewAll) {
      const status = getPracticeScopeStatus({ scope, currentWordIds: currentIds });
      if (status.done) {
        alert('今天已完成一轮，可点“再来一轮”重新复习。');
        return;
      }
      if (status.reviewedIds.length > 0) {
        // 已有部分词复习过：本轮只复习新增词，已复习词不再出现
        wordIds = status.newIds;
      }
    }
    createPracticeSession({
      scope,
      wordIds,
      skipped: result.skipped
    });
    location.hash = `#/flashcard/practice/${scope}`;
  },

  async startManualPractice() {
    if (!this.selectedWordIds.size) {
      alert('请先勾选要复习的单词。');
      return;
    }
    const result = await resolvePracticeScope({ db: DB, scope: 'manual', wordIds: [...this.selectedWordIds] });
    if (!result.words.length) {
      alert('所选单词都还没有进入学习词库，无法开始专项复习。');
      return;
    }
    createPracticeSession({
      scope: 'manual',
      wordIds: result.words.map(word => word.id),
      skipped: result.skipped
    });
    this.selectionMode = false;
    this.selectedWordIds.clear();
    location.hash = '#/flashcard/practice/manual';
  },

  // Delete a word
  async deleteWord(id) {
    await DB.deleteWord(id);
    const el = document.getElementById(`vocab-${id}`);
    if (el) el.remove();

    // Check if list is now empty
    const words = await DB.getAllWords();
    if (words.length === 0) {
      this.manageMode = false;
      await this.render(this.container);
    }
  },

  // Show word detail popup
  async showWordDetail(id) {
    const words = await DB.getAllWords();
    let word = words.find(w => w.id === id);
    if (!word) return;

    word = await ensureSavedWordDefinition(word, {
      lookup: Dictionary.lookup.bind(Dictionary),
      update: DB.updateWordDefinition.bind(DB)
    });
    WordStudyDetail.open({
      word: word.word,
      definition: word,
      sourceMeta: {
        eyebrow: 'WORD NOTE',
        originLabel: '我的生词本',
        contextSentence: word.contextSentence || ''
      }
    });
  },

  // Clear all words
  async clearAll() {
    if (!confirm('确定要清空所有收藏单词吗？此操作不可撤销。')) return;
    const words = await DB.getAllWords();
    for (const w of words) {
      await DB.deleteWord(w.id);
    }
    this.manageMode = false;
    await this.render(this.container);
  }
};

window.VocabularyView = VocabularyView;
