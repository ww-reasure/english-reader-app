/**
 * Tooltip Component
 * Shows word translation popup on click
 */

import { DB } from '../db.js';
import { Config } from '../config.js';
import { getStemForm, esc } from '../helpers.js';
import { AudioCache } from '../audio-cache.js';
import { TooltipSession } from './tooltip-session.js';
import { formatPartOfSpeech, formatPhonetic, getDefinitionPreview, getDefinitionSenses, getSavableTranslation } from './definition-trust.mjs';
import { DEFINITION_SCHEMA_VERSION } from './saved-word-definition.mjs';
import { renderTooltipWordBadges } from './tooltip-metadata.mjs';
import { WordStudyDetail } from './word-study-detail.js';
import { WordStudyDetailCache } from './word-study-detail-cache.mjs';

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

  showError(lookupId, x, y, message = '暂时无法查询，请稍后重试') {
    if (!this.isCurrent(lookupId)) return false;
    const tooltip = document.getElementById('wordTooltip');
    tooltip.innerHTML = `
      <div class="tooltip-error">
        <span>${esc(message)}</span>
        <button class="tooltip-close" type="button" aria-label="关闭单词翻译" title="关闭">×</button>
      </div>`;
    this.position(tooltip, x, y);
    tooltip.style.display = 'block';
    this.bindCloseButton(tooltip);
    return true;
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
  async show(lookupId, x, y, data, reviewMode, options = {}) {
    if (!this.isCurrent(lookupId)) return false;
    const tooltip = document.getElementById('wordTooltip');

    const targetTrack = String(options.targetTrack || Config.get('exam_level') || '').trim();
    const wordBadges = renderTooltipWordBadges(data, esc, targetTrack);
    let html = `<div class="tooltip-word">
      <div class="tooltip-word-title">
        <button class="tooltip-word-trigger" type="button" data-audio-word="${esc(data.word)}" title="播放发音" aria-label="播放 ${esc(data.word)} 的发音">${esc(data.word)}</button>
        ${wordBadges ? `<span class="tooltip-word-meta" aria-label="词汇标签">${wordBadges}</span>` : ''}
      </div>
      <div class="tooltip-word-controls">
        <button class="tooltip-close" type="button" aria-label="关闭单词翻译" title="关闭">×</button>
      </div>
    </div>`;

    const definitionPreview = getDefinitionPreview(data);
    const contextualSenseIndex = Number.isInteger(options.contextualSenseIndex) ? options.contextualSenseIndex : -1;
    const contextualSense = getDefinitionSenses(data)[contextualSenseIndex] || null;
    const phonetic = formatPhonetic(data.phonetic);
    const lexicalMeta = [
      data.baseForm ? `<div class="tooltip-pos">原形: ${esc(data.baseForm)}</div>` : '',
      phonetic ? `<button class="tooltip-phonetic tooltip-phonetic-trigger" type="button" data-audio-word="${esc(data.word)}" title="播放发音" aria-label="播放 ${esc(data.word)} 的发音">${esc(phonetic)}</button>` : ''
    ].join('');
    html += `<div class="tooltip-lexical-meta">
      <div class="tooltip-lexical-copy">${lexicalMeta}</div>
    </div>`;

    if (contextualSense && options.contextSentence) {
      html += `<div class="tooltip-contextual-sense"><span>本句义</span><div class="definition-line"><b class="definition-pos">${esc(formatPartOfSpeech(contextualSense.pos) || '词性待确认')}</b><em>${esc(contextualSense.glossZh)}</em></div>${options.contextualSenseReason ? `<small>${esc(options.contextualSenseReason)}</small>` : ''}</div>`;
    }

    if (definitionPreview.visibleLines.length) {
      html += `<div class="tooltip-definition-preview">${definitionPreview.visibleLines.map((line) => `<div class="tooltip-translation definition-line"><span class="definition-pos">${esc(line.label)}</span><span>${esc(line.glossZh)}</span></div>`).join('')}</div>`;
      if (definitionPreview.additionalLines.length) {
        html += `<button class="tooltip-definition-toggle" type="button" aria-expanded="false" data-definition-total="${definitionPreview.total}">展开更多释义（${definitionPreview.total}）</button>`;
        html += `<div class="tooltip-all-definitions" hidden>${definitionPreview.additionalLines.map((line) => `<div class="definition-line"><span class="definition-pos">${esc(line.label)}</span><span>${esc(line.glossZh)}</span></div>`).join('')}</div>`;
      }
    } else {
      html += `<div class="tooltip-translation">${esc(data.translation)}</div>`;
      if (data.found && !data.pos) html += '<div class="tooltip-pos">词性待确认</div>';
    }
    // Review mode rating buttons
    if (reviewMode) {
      const stem = data.word ? data.word.toLowerCase().replace(/[^a-z]/g, '') : '';
      html += `<div class="tooltip-rating-btns">
        <button class="review-rating-btn" data-quality="3" data-stem="${esc(stem)}" style="color:var(--warning)">不熟</button>
        <button class="review-rating-btn" data-quality="1" data-stem="${esc(stem)}" style="color:var(--danger)">不认识</button>
      </div>`;
    }

    let savePayload = null;
    if (data.found && !reviewMode) {
      const savedTranslation = getSavableTranslation(data);
      // Check if already saved
      const isSaved = await this.isWordSaved(data.word);
      if (!this.isCurrent(lookupId)) return false;
      if (isSaved) {
        html += `<div class="tooltip-actions">
          <span class="btn-saved-word">✅ 已收藏</span>
        </div>`;
      } else {
        savePayload = {
          word: data.word,
          translation: savedTranslation,
          phonetic: data.phonetic || '',
          pos: data.pos || '',
          definitionSenses: getDefinitionSenses(data),
          definitionSchemaVersion: DEFINITION_SCHEMA_VERSION,
          lexiconVersion: data.lexiconVersion || ''
        };
        html += `<div class="tooltip-actions">
          <button class="btn-save-word" type="button">+ 收藏</button>
        </div>`;
      }
    }
    if (data.found) {
      html += '<button class="tooltip-study-detail" type="button">查看学习详情</button>';
    }

    if (!this.isCurrent(lookupId)) return false;
    tooltip.innerHTML = html;
    this.position(tooltip, x, y);
    tooltip.style.display = 'block';
    this.bindCloseButton(tooltip);
    this.bindDefinitionToggle(tooltip, x, y);

    const detailBtn = tooltip.querySelector('.tooltip-study-detail');
    if (detailBtn) {
      detailBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.hide();
        WordStudyDetail.open({
          word: data.word,
          definition: { ...data, contextualSenseIndex, contextualSenseReason: options.contextualSenseReason || '' },
          sourceMeta: {
            eyebrow: 'WORD NOTE',
            originLabel: '阅读点词',
            contextSentence: options.contextSentence || '',
            targetTrack
          }
        });
      });
    }

    const saveBtn = tooltip.querySelector('.btn-save-word');
    if (saveBtn && savePayload) {
      saveBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this.saveWord(savePayload);
      });
    }

    // The word itself and its phonetic transcription are quiet audio triggers.
    tooltip.querySelectorAll('[data-audio-word]').forEach((audioTrigger) => {
      audioTrigger.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const word = audioTrigger.getAttribute('data-audio-word');
        if (word && window.AudioCache) {
          window.AudioCache.getAudio(word).catch(err => console.warn('Audio failed:', err));
        }
      });
    });

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

  bindDefinitionToggle(tooltip, x, y) {
    const toggle = tooltip.querySelector('.tooltip-definition-toggle');
    const details = tooltip.querySelector('.tooltip-all-definitions');
    if (!toggle || !details) return;
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const expanded = details.hidden;
      details.hidden = !expanded;
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.textContent = expanded ? '收起释义' : `展开更多释义（${toggle.dataset.definitionTotal || details.querySelectorAll('.definition-line').length}）`;
      this.position(tooltip, x, y);
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
  async saveWord(wordData) {
    try {
      const word = String(wordData?.word || '').trim();
      if (!word) return;
      const savedTranslation = getSavableTranslation(wordData);
      const definitionSenses = getDefinitionSenses(wordData);
      const phonetic = String(wordData?.phonetic || '').trim();
      const pos = String(wordData?.pos || definitionSenses[0]?.pos || '').trim();
      const hash = location.hash;
      const match = hash.match(/#\/reading\/(\d+)/);
      const articleId = match ? parseInt(match[1]) : null;
      await DB.saveWord({
        articleId,
        word,
        translation: savedTranslation,
        phonetic,
        pos,
        definitionSenses,
        definitionSchemaVersion: DEFINITION_SCHEMA_VERSION,
        ...(wordData?.lexiconVersion ? { definitionLexiconVersion: wordData.lexiconVersion } : {}),
        contextSentence: ''
      });

      // Auto-sync to learn words library with translation
      try {
        await DB.saveLearnWord({
          word: word.toLowerCase(),
          translation: savedTranslation,
          phonetic: phonetic || '',
          pos,
          definitionSenses,
          definitionSchemaVersion: DEFINITION_SCHEMA_VERSION,
          ...(wordData?.lexiconVersion ? { definitionLexiconVersion: wordData.lexiconVersion } : {}),
          createdAt: Date.now()
        });
      } catch {
        // Duplicate word in learn library, ignore
      }

      // Background: warm the shared detail cache after the save has settled.
      // This keeps the first full detail view local and avoids duplicate AI
      // requests from the old per-service prefetchers.
      const targetTrack = Config.get('exam_level') || '';
      void WordStudyDetailCache.prefetch(word, { targetTrack }).catch(() => {});

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
    if (word.length < 2 && word.toLowerCase() !== 'a') return null;

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
