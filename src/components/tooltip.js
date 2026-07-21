/**
 * Tooltip Component
 * Shows word translation popup on click
 */

import { DB } from '../db.js';
import { getStemForm, esc, escJs } from '../helpers.js';
import { Affixes } from '../affixes.js';
import { Examples } from '../examples.js';
import { AudioCache } from '../audio-cache.js';
import { TooltipSession } from './tooltip-session.js';

export const Tooltip = {
  session: new TooltipSession(),

  beginLookup(x, y) {
    const lookupId = this.session.begin();
    this.showLoading(x, y);
    return lookupId;
  },

  isCurrent(lookupId) {
    return this.session.isCurrent(lookupId);
  },

  isVisible() {
    const tooltip = document.getElementById('wordTooltip');
    return !!tooltip && tooltip.style.display !== 'none';
  },

  attachAutoDismiss() {
    const dismiss = () => this.hide();
    document.addEventListener('scroll', dismiss, { passive: true, capture: true });
    document.addEventListener('touchmove', dismiss, { passive: true });
    document.addEventListener('wheel', dismiss, { passive: true });

    return () => {
      document.removeEventListener('scroll', dismiss, true);
      document.removeEventListener('touchmove', dismiss);
      document.removeEventListener('wheel', dismiss);
    };
  },

  // Show loading state
  showLoading(x, y) {
    const tooltip = document.getElementById('wordTooltip');
    tooltip.innerHTML = `
      <div class="tooltip-loading">
        <span style="color:var(--muted)">...</span>
        <button class="tooltip-close" type="button" aria-label="关闭单词翻译" title="关闭">×</button>
      </div>`;
    this.position(tooltip, x, y);
    tooltip.style.display = 'block';
    this.bindCloseButton(tooltip);
  },

  // Check if word is already in vocabulary
  async isWordSaved(word) {
    try {
      const words = await DB.getAllWords();
      const stem = getStemForm(word.toLowerCase());
      return words.some(w => {
        const wStem = getStemForm(w.word.toLowerCase());
        return wStem === stem || w.word.toLowerCase() === word.toLowerCase();
      });
    } catch {
      return false;
    }
  },

  // Show word data
  async show(lookupId, x, y, data, reviewMode) {
    if (!this.isCurrent(lookupId)) return false;
    const tooltip = document.getElementById('wordTooltip');

    let html = `<div class="tooltip-word">
      <span>${esc(data.word)}</span>
      <button class="btn-speak" data-word="${esc(data.word)}" title="播放发音">🔊</button>
      <button class="tooltip-close" type="button" aria-label="关闭单词翻译" title="关闭">×</button>
    </div>`;

    if (data.baseForm) {
      html += `<div class="tooltip-pos">原形: ${esc(data.baseForm)}</div>`;
    }
    if (data.phonetic) {
      html += `<div class="tooltip-phonetic">[${esc(data.phonetic)}]</div>`;
    }
    if (data.pos) {
      html += `<div class="tooltip-pos">${esc(data.pos)}</div>`;
    }

    html += `<div class="tooltip-translation">${esc(data.translation)}</div>`;

    // Exam level tags
    if (data.examLevels && data.examLevels.length > 0) {
      const levelLabels = { cet4: '四级', cet6: '六级', graduate: '考研' };
      const tags = data.examLevels.map(l => `<span class="exam-tag exam-${l}">${levelLabels[l] || l}</span>`).join('');
      html += `<div class="tooltip-exam-tags">${tags}</div>`;
    }

    // Word frequency level
    if (data.freqLevel) {
      const freqLabels = { high: '高频', medium: '中频', low: '低频' };
      html += `<div class="tooltip-freq"><span class="freq-badge freq-${data.freqLevel}">${freqLabels[data.freqLevel]}</span></div>`;
    }

    // Review mode rating buttons
    if (reviewMode) {
      const stem = data.word ? data.word.toLowerCase().replace(/[^a-z]/g, '') : '';
      html += `<div class="tooltip-rating-btns">
        <button class="review-rating-btn" data-quality="3" data-stem="${esc(stem)}" style="color:var(--warning)">不熟</button>
        <button class="review-rating-btn" data-quality="1" data-stem="${esc(stem)}" style="color:var(--danger)">不认识</button>
      </div>`;
    }

    if (data.found && !reviewMode) {
      // Check if already saved
      const isSaved = await this.isWordSaved(data.word);
      if (!this.isCurrent(lookupId)) return false;
      if (isSaved) {
        html += `<div class="tooltip-actions">
          <span class="btn-saved-word">✅ 已收藏</span>
        </div>`;
      } else {
        html += `<div class="tooltip-actions">
          <button class="btn-save-word" onclick="Tooltip.saveWord('${escJs(data.word)}', '${escJs(data.translation)}', '${escJs(data.phonetic || '')}')">+ 收藏</button>
        </div>`;
      }
    }

    if (!this.isCurrent(lookupId)) return false;
    tooltip.innerHTML = html;
    this.position(tooltip, x, y);
    tooltip.style.display = 'block';
    this.bindCloseButton(tooltip);

    // Bind audio button click directly (more reliable than event delegation)
    const speakBtn = tooltip.querySelector('.btn-speak');
    if (speakBtn) {
      speakBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const word = speakBtn.getAttribute('data-word');
        if (word && window.AudioCache) {
          window.AudioCache.getAudio(word).catch(err => console.warn('Audio failed:', err));
        }
      });
    }

    // Bind review rating buttons
    const ratingBtns = tooltip.querySelectorAll('.review-rating-btn');
    ratingBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const quality = parseInt(btn.dataset.quality);
        const stem = btn.dataset.stem;

        // Dispatch custom event for reading view to handle
        document.dispatchEvent(new CustomEvent('review-rated', {
          detail: { quality, stem }
        }));

        // Visual feedback: briefly highlight selected button
        btn.style.background = quality === 1 ? 'var(--danger)' : 'var(--warning)';
        btn.style.color = 'var(--on-accent)';

        // Close tooltip after short delay for feedback
        setTimeout(() => {
          this.hide();
        }, 200);
      });
    });

    return true;
  },

  bindCloseButton(tooltip) {
    const closeBtn = tooltip.querySelector('.tooltip-close');
    if (!closeBtn) return;
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.hide();
    });
  },

  // Position tooltip relative to click, avoiding viewport edges
  position(tooltip, x, y) {
    tooltip.style.left = '0';
    tooltip.style.top = '0';
    tooltip.style.display = 'block';

    const rect = tooltip.getBoundingClientRect();
    let left = x + 10;
    let top = y + 10;

    if (left + rect.width > window.innerWidth - 10) left = x - rect.width - 10;
    if (top + rect.height > window.innerHeight - 10) top = y - rect.height - 10;
    if (left < 10) left = 10;
    if (top < 10) top = 10;

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  },

  // Hide tooltip
  hide() {
    this.session.dismiss();
    const tooltip = document.getElementById('wordTooltip');
    if (tooltip) tooltip.style.display = 'none';
  },

  // Save word to vocabulary and auto-sync to learn words (with SRS)
  async saveWord(word, translation, phonetic) {
    try {
      const hash = location.hash;
      const match = hash.match(/#\/reading\/(\d+)/);
      const articleId = match ? parseInt(match[1]) : null;
      await DB.saveWord({
        articleId,
        word,
        translation,
        phonetic,
        contextSentence: ''
      });

      // Auto-sync to learn words library with translation
      try {
        await DB.saveLearnWord({
          word: word.toLowerCase(),
          translation: translation || '',
          phonetic: phonetic || '',
          createdAt: Date.now()
        });
      } catch {
        // Duplicate word in learn library, ignore
      }

      // Background: pre-analyze word root and examples for flashcard review
      Affixes.preAnalyze(word);
      Examples.preGenerate(word);

      const btn = document.querySelector('.btn-save-word');
      if (btn) {
        btn.textContent = '已收藏';
        btn.disabled = true;
      }
    } catch {
      alert('收藏失败');
    }
  },

  // Get word at click point using Selection API
  getWordAtPoint(e) {
    let range;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(e.clientX, e.clientY);
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.setEnd(pos.offsetNode, pos.offset);
      }
    }
    if (!range) return null;

    const node = range.startContainer;
    if (!node || node.nodeType !== Node.TEXT_NODE) return null;

    const text = node.textContent;
    const offset = range.startOffset;
    if (!text) return null;

    // Expand selection to full word
    let start = offset, end = offset;
    while (start > 0 && /[a-zA-Z\-']/.test(text[start - 1])) start--;
    while (end < text.length && /[a-zA-Z\-']/.test(text[end])) end++;

    const word = text.substring(start, end).replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '');
    if (word.length < 2) return null;

    // caretRangeFromPoint 会把段间/词间空白吸附到最近文字；确认点击确实落在该词字形内
    const wordRange = document.createRange();
    wordRange.setStart(node, start);
    wordRange.setEnd(node, end);
    const hitWord = Array.from(wordRange.getClientRects()).some(rect =>
      e.clientX >= rect.left && e.clientX <= rect.right &&
      e.clientY >= rect.top && e.clientY <= rect.bottom
    );
    return hitWord ? word : null;
  }
};

window.Tooltip = Tooltip;
