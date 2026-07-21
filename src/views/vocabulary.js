/**
 * Vocabulary View
 * Displays and manages saved words with manage mode
 */

import { DB } from '../db.js';
import { Dictionary } from '../dictionary.js';
import { AudioCache } from '../audio-cache.js';
import { Affixes } from '../affixes.js';
import { Examples } from '../examples.js';
import { esc } from '../helpers.js';

export const VocabularyView = {
  manageMode: false,

  // Render vocabulary view
  async render(container) {
    const words = await DB.getAllWords();

    let cards = '';
    if (words.length === 0) {
      cards = '<div class="empty-state">还没有收藏单词。在阅读页面单击单词即可收藏！</div>';
    } else {
      const headerActions = this.manageMode
        ? `<button class="btn btn-danger btn-sm" onclick="VocabularyView.clearAll()">清空全部</button>
           <button class="btn btn-outline btn-sm" onclick="VocabularyView.toggleManage()">完成</button>`
        : `<a href="#/flashcard" class="btn btn-primary btn-sm">开始复习</a>
           <button class="btn btn-outline btn-sm" onclick="VocabularyView.toggleManage()">管理</button>`;

      cards = `
        <div class="learn-words-header">
          <span>共 ${words.length} 个单词</span>
          <div>${headerActions}</div>
        </div>
        <div class="vocab-list">`;

      words.forEach(word => {
        const deleteBtn = this.manageMode
          ? `<button class="learn-word-remove" onclick="VocabularyView.deleteWord(${word.id})" title="移除">×</button>`
          : '';

        cards += `
          <div class="vocab-card ${this.manageMode ? 'manage-mode' : ''}" id="vocab-${word.id}"
               ${!this.manageMode ? `onclick="VocabularyView.showWordDetail(${word.id})"` : ''}>
            <div class="vocab-word">
              <span class="word">${esc(word.word)}</span>
              ${word.phonetic ? `<span class="phonetic">[${esc(word.phonetic)}]</span>` : ''}
            </div>
            <div class="vocab-translation">${esc(word.translation)}</div>
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
        <div class="vocab-list">${cards}</div>
      </section>`;
  },

  // Toggle manage mode
  toggleManage() {
    this.manageMode = !this.manageMode;
    this.render(document.getElementById('app'));
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
      this.render(document.getElementById('app'));
    }
  },

  // Show word detail popup
  async showWordDetail(id) {
    const words = await DB.getAllWords();
    const word = words.find(w => w.id === id);
    if (!word) return;

    let translation = word.translation || '';
    let phonetic = word.phonetic || '';
    if (!translation) {
      try {
        const dictResult = await Dictionary.lookup(word.word);
        translation = dictResult.translation || '暂无翻译';
        phonetic = phonetic || dictResult.phonetic || '';
      } catch {
        translation = '暂无翻译';
      }
    }

    let overlay = document.getElementById('wordDetailOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'wordDetailOverlay';
      overlay.className = 'modal-overlay';
      overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;justify-content:center;align-items:center';
      document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
      <div class="modal word-detail-modal" role="dialog" aria-modal="true" aria-label="${esc(word.word)} 的单词详情">
        <header class="word-detail-head">
          <div>
            <p class="page-eyebrow">WORD NOTE</p>
            <div class="word-detail-title">${esc(word.word)} <button class="btn-speak" data-word="${esc(word.word)}" aria-label="朗读 ${esc(word.word)}">听</button></div>
          </div>
        </header>
        ${phonetic ? `<div class="word-detail-phonetic">[${esc(phonetic)}]</div>` : ''}
        <div class="word-detail-translation">${esc(translation)}</div>
        ${word.contextSentence ? `<blockquote class="word-detail-context">${esc(word.contextSentence)}</blockquote>` : ''}
        <div id="wordDetailExtras" class="word-detail-extras"><div class="text-muted">正在整理词根与例句…</div></div>
        <div class="modal-actions">
          <button class="btn" onclick="document.getElementById('wordDetailOverlay').style.display='none'">关闭笔记</button>
        </div>
      </div>`;

    overlay.style.display = 'flex';
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.style.display = 'none';
    };

    const speakBtn = overlay.querySelector('.btn-speak');
    if (speakBtn) {
      speakBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.AudioCache) window.AudioCache.getAudio(word.word);
      });
    }

    this._loadWordExtras(word.word);
  },

  async _loadWordExtras(word) {
    const el = document.getElementById('wordDetailExtras');
    if (!el) return;

    try {
      const [examples, rootAnalysis] = await Promise.all([
        Examples.getExamples(word).catch(() => []),
        Affixes.getAnalysis(word).catch(() => null)
      ]);

      let html = '';

      if (rootAnalysis) {
        if (rootAnalysis.breakdown) {
          html += `<div style="margin-bottom:8px"><span style="font-size:13px;color:var(--text-muted)">🔤 词根拆解</span><div style="margin-top:4px">${esc(rootAnalysis.breakdown)}</div></div>`;
        }
        if (rootAnalysis.memoryTip) {
          html += `<div style="margin-bottom:8px"><span style="font-size:13px;color:var(--text-muted)">💡 记忆法</span><div style="margin-top:4px">${esc(rootAnalysis.memoryTip)}</div></div>`;
        }
      }

      if (examples.length > 0) {
        html += `<div><span style="font-size:13px;color:var(--text-muted)">📝 例句</span>`;
        examples.forEach(ex => {
          html += `<div style="margin-top:4px;font-size:14px;color:var(--text-secondary)">• ${esc(ex)}</div>`;
        });
        html += '</div>';
      }

      el.innerHTML = html || '<div style="color:var(--text-muted);font-size:13px">暂无详情</div>';
    } catch {
      el.innerHTML = '';
    }
  },

  // Clear all words
  async clearAll() {
    if (!confirm('确定要清空所有收藏单词吗？此操作不可撤销。')) return;
    const words = await DB.getAllWords();
    for (const w of words) {
      await DB.deleteWord(w.id);
    }
    this.manageMode = false;
    this.render(document.getElementById('app'));
  }
};

window.VocabularyView = VocabularyView;
