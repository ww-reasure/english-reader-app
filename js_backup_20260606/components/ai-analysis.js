/**
 * AI Analysis Component
 * Handles sentence analysis with AI, including long-press auto-select
 */

const AIAnalysis = {
  currentText: '',
  longPressTimer: null,
  isLongPress: false,

  // Show "Ask AI" button at position
  showButton(x, y, text) {
    this.hideButton();
    this.currentText = text;

    const btn = document.createElement('button');
    btn.id = 'aiAnalyzeBtn';
    btn.className = 'ai-analyze-btn';
    btn.textContent = '问 AI';
    btn.onclick = (e) => {
      e.stopPropagation();
      this.analyze(text);
    };

    let left = x - 30;
    let top = y + 8;
    if (left < 10) left = 10;
    if (top + 40 > window.innerHeight) top = y - 40;

    btn.style.left = left + 'px';
    btn.style.top = top + 'px';
    document.body.appendChild(btn);
  },

  // Hide "Ask AI" button
  hideButton() {
    const btn = document.getElementById('aiAnalyzeBtn');
    if (btn) btn.remove();
  },

  // Analyze sentence with AI
  async analyze(sentence) {
    this.hideButton();
    Tooltip.hide();
    this.showResult(sentence, '正在分析...', true);

    try {
      const result = await API.analyzeSentence(sentence);
      this.showResult(sentence, result, false);
    } catch (err) {
      this.showResult(sentence, `分析失败：${err.message}`, false);
    }
  },

  // Show analysis result in modal
  showResult(sentence, content, isLoading) {
    const existing = document.getElementById('aiResultModal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'aiResultModal';
    overlay.className = 'modal-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const modal = document.createElement('div');
    modal.className = 'modal modal-wide';
    modal.innerHTML = `
      <h2>AI 句子分析</h2>
      <div class="ai-original-sentence">${esc(sentence)}</div>
      <div class="${isLoading ? 'ai-loading' : 'ai-result-content'}">
        ${isLoading ? '正在分析，请稍候...' : this.formatResult(content)}
      </div>
      <div class="modal-actions">
        <button class="btn" onclick="document.getElementById('aiResultModal').remove()">关闭</button>
      </div>`;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  },

  // Format result with basic markdown support
  formatResult(text) {
    return esc(text)
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  },

  // Find sentence boundaries from a text node and offset
  findSentenceBoundaries(node, offset) {
    const text = node.textContent;
    if (!text) return null;

    // Sentence ending pattern: .!? followed by space, newline, or end of text
    // Exclude common abbreviations: Mr. Mrs. Dr. U.S. U.K. etc.
    const sentenceEnders = /[.!?]/;
    const abbreviations = /(?:Mr|Mrs|Dr|Ms|Prof|Sr|Jr|St|vs|etc|inc|Ltd|Corp|Jr|Sr|U\.S|U\.K|e\.g|i\.e|a\.m|p\.m)\.$/;

    // Find start of sentence (go backward)
    let start = offset;
    while (start > 0) {
      // Check if current position is a sentence ender
      if (sentenceEnders.test(text[start - 1])) {
        // Check if it's an abbreviation
        const before = text.substring(Math.max(0, start - 10), start);
        if (abbreviations.test(before)) {
          start -= 2; // Skip the abbreviation period
          continue;
        }
        // Check if followed by space or newline (true sentence end)
        if (start < text.length && /[\s\n]/.test(text[start])) {
          break;
        }
        // Period at end of text node
        if (start === text.length) {
          break;
        }
      }
      start--;
    }

    // Skip leading whitespace
    while (start < text.length && /[\s\n]/.test(text[start])) {
      start++;
    }

    // Find end of sentence (go forward)
    let end = offset;
    while (end < text.length) {
      if (sentenceEnders.test(text[end])) {
        // Check if it's an abbreviation
        const before = text.substring(Math.max(0, end - 10), end + 1);
        if (abbreviations.test(before + '.')) {
          end++;
          continue;
        }
        // Include the punctuation
        end++;
        break;
      }
      end++;
    }

    // If we reached end of text without finding sentence end, use end
    if (end >= text.length) {
      end = text.length;
    }

    // Trim trailing whitespace
    while (end > start && /[\s\n]/.test(text[end - 1])) {
      end--;
    }

    if (end <= start) return null;

    return { start, end };
  },

  // Auto-select sentence on long press
  handleLongPress(e) {
    const touch = e.touches[0];
    if (!touch) return;

    // Get the text node at touch position
    let range;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(touch.clientX, touch.clientY);
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(touch.clientX, touch.clientY);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.setEnd(pos.offsetNode, pos.offset);
      }
    }

    if (!range) return;

    const node = range.startContainer;
    if (!node || node.nodeType !== Node.TEXT_NODE) return;

    const offset = range.startOffset;
    const boundaries = this.findSentenceBoundaries(node, offset);

    if (!boundaries) return;

    // Select the sentence
    const selection = window.getSelection();
    selection.removeAllRanges();
    const newRange = document.createRange();
    newRange.setStart(node, boundaries.start);
    newRange.setEnd(node, boundaries.end);
    selection.addRange(newRange);

    // Show "Ask AI" button
    const selectedText = selection.toString().trim();
    if (selectedText.length > 3) {
      const rect = newRange.getBoundingClientRect();
      this.showButton(rect.left + rect.width / 2, rect.bottom, selectedText);
    }

    this.isLongPress = true;
  },

  // Initialize long-press and selection detection for reading view
  initSelectionDetection(articleBody) {
    const LONG_PRESS_DURATION = 500; // ms

    // Long press detection for touch devices
    articleBody.addEventListener('touchstart', (e) => {
      this.isLongPress = false;
      this.longPressTimer = setTimeout(() => {
        this.handleLongPress(e);
      }, LONG_PRESS_DURATION);
    }, { passive: true });

    articleBody.addEventListener('touchmove', () => {
      clearTimeout(this.longPressTimer);
    }, { passive: true });

    articleBody.addEventListener('touchend', (e) => {
      clearTimeout(this.longPressTimer);

      // If it was a long press, prevent the click event
      if (this.isLongPress) {
        e.preventDefault();
        this.isLongPress = false;
      }
    });

    // Manual selection detection for desktop (mouseup)
    const checkSelection = debounce(() => {
      if (this.isLongPress) return;

      const selection = window.getSelection();
      const text = selection.toString().trim();

      if (text.length > 3 && /[a-zA-Z]/.test(text)) {
        try {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          this.showButton(rect.left + rect.width / 2, rect.bottom, text);
        } catch {
          this.hideButton();
        }
      } else {
        this.hideButton();
      }
    }, 200);

    articleBody.addEventListener('mouseup', checkSelection);

    // Close button when clicking elsewhere
    document.addEventListener('click', (e) => {
      if (e.target.id !== 'aiAnalyzeBtn' && !e.target.closest('.modal-overlay')) {
        this.hideButton();
      }
    });
  }
};
