const MAX_SELECTION_LENGTH = 600;

export function normalizeSelectedText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_SELECTION_LENGTH);
}

export function isSingleEnglishWord(value) {
  return /^[A-Za-z][A-Za-z'-]*$/.test(String(value || '').trim());
}

export function createSelectionQuote(selectedText, selectedSource) {
  const text = normalizeSelectedText(selectedText);
  if (!text) return null;
  return {
    selectedText: text,
    selectedSource: String(selectedSource || 'question')
  };
}

export function getSelectionSource(node, root, fallback = 'question') {
  const element = node?.nodeType === 3 ? node.parentElement : node;
  const source = element?.closest?.('[data-selection-source]')?.dataset?.selectionSource;
  if (source) return source;
  if (root && element && root.contains?.(element)) return fallback;
  return null;
}

/**
 * Minimal submitted-result selection action menu. It intentionally knows
 * nothing about Exam Tutor or ChatService; callers provide callbacks.
 */
export class SelectableTextActions {
  constructor({ root, onAskAI, onLookup, enabled = true, allowAskAI = true, shouldIgnoreSelection = () => false } = {}) {
    this.root = root;
    this.onAskAI = onAskAI;
    this.onLookup = onLookup;
    this.enabled = enabled;
    this.allowAskAI = allowAskAI;
    this.shouldIgnoreSelection = shouldIgnoreSelection;
    this.menu = null;
    this._handlers = [];
  }

  bind() {
    if (!this.root || !this.enabled) return () => this.destroy();
    const schedule = () => setTimeout(() => this.update(), 0);
    this.root.addEventListener('mouseup', schedule);
    this.root.addEventListener('touchend', schedule, { passive: true });
    document.addEventListener('selectionchange', schedule);
    this._scrollHandler = () => this.hide();
    this.root.addEventListener('scroll', this._scrollHandler, { passive: true });
    window.addEventListener('scroll', this._scrollHandler, { passive: true });
    this._handlers.push(() => this.root.removeEventListener('mouseup', schedule));
    this._handlers.push(() => this.root.removeEventListener('touchend', schedule));
    this._handlers.push(() => document.removeEventListener('selectionchange', schedule));
    this._handlers.push(() => this.root.removeEventListener('scroll', this._scrollHandler));
    this._handlers.push(() => window.removeEventListener('scroll', this._scrollHandler));
    return () => this.destroy();
  }

  getSelection() {
    const selection = window.getSelection?.();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const element = range.commonAncestorContainer?.nodeType === 3
      ? range.commonAncestorContainer.parentElement
      : range.commonAncestorContainer;
    if (!element || !this.root.contains(element)) return null;
    const selectedText = normalizeSelectedText(selection.toString());
    if (!selectedText) return null;
    return { selection, range, selectedText, selectedSource: getSelectionSource(range.startContainer, this.root), anchorElement: element };
  }

  update() {
    if (!this.enabled) return;
    if (this.shouldIgnoreSelection()) return this.hide();
    const selected = this.getSelection();
    if (!selected) return this.hide();
    const rect = selected.range.getBoundingClientRect?.();
    if (!rect) return this.hide();
    this.show(selected, rect);
  }

  show(selected, rect) {
    this.hide();
    const menu = document.createElement('div');
    menu.className = 'exam-selection-actions';
    menu.innerHTML = `<button type="button" data-action="copy">复制</button>${isSingleEnglishWord(selected.selectedText) ? '<button type="button" data-action="lookup">查词</button>' : ''}${this.allowAskAI ? '<button type="button" data-action="ask">✨ 问 AI</button>' : ''}`;
    const menuTop = rect.bottom + 8 > window.innerHeight - 52 ? rect.top - 52 : rect.bottom + 8;
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 180))}px`;
    menu.style.top = `${Math.max(8, menuTop)}px`;
    menu.addEventListener('pointerdown', event => event.preventDefault());
    menu.addEventListener('click', async event => {
      const action = event.target.closest('button')?.dataset.action;
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      if (action === 'copy') await this.copy(selected.selectedText);
      if (action === 'lookup') this.onLookup?.(selected.selectedText, rect);
      if (action === 'ask') this.onAskAI?.(createSelectionQuote(selected.selectedText, selected.selectedSource), rect, selected);
      this.hide();
      window.getSelection?.().removeAllRanges?.();
    });
    document.body.appendChild(menu);
    this.menu = menu;
  }

  async copy(text) {
    if (globalThis.navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand?.('copy');
    area.remove();
  }

  hide = () => {
    this.menu?.remove();
    this.menu = null;
  };

  destroy() {
    this._handlers.splice(0).forEach(remove => remove());
    this.hide();
  }
}
