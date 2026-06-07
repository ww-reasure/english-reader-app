/**
 * Tooltip Component
 * Shows word translation popup on click
 */

const Tooltip = {
  // Show loading state
  showLoading(x, y) {
    const tooltip = document.getElementById('wordTooltip');
    tooltip.innerHTML = '<span style="color:#aaa">...</span>';
    this.position(tooltip, x, y);
    tooltip.style.display = 'block';
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
  async show(x, y, data) {
    const tooltip = document.getElementById('wordTooltip');

    // Save audio URL for TTS
    if (data.audioUrl) {
      TTS.setAudioUrl(data.word, data.audioUrl);
    }

    let html = `<div class="tooltip-word">
      <span>${esc(data.word)}</span>
      <button class="btn-speak" data-word="${esc(data.word)}" title="播放发音">🔊</button>
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

    if (data.found) {
      // Check if already saved
      const isSaved = await this.isWordSaved(data.word);
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

    tooltip.innerHTML = html;
    this.position(tooltip, x, y);
    tooltip.style.display = 'block';
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
    const tooltip = document.getElementById('wordTooltip');
    if (tooltip) tooltip.style.display = 'none';
  },

  // Save word to vocabulary and auto-sync to learn words (with SRS)
  async saveWord(word, translation, phonetic) {
    try {
      const articleId = Router.getArticleId();
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
    return word.length >= 2 ? word : null;
  }
};
