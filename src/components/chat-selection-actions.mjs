const MAX_SELECTED_EXCERPT_LENGTH = 600;

export function normalizeSelectedExcerpt(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_SELECTED_EXCERPT_LENGTH);
}

export class ChatSelectionActions {
  constructor({
    root,
    onFollowUp,
    documentObject = globalThis.document,
    windowObject = globalThis.window
  } = {}) {
    this.root = root;
    this.onFollowUp = onFollowUp;
    this.documentObject = documentObject;
    this.windowObject = windowObject;
    this.button = null;
    this._handlers = [];
  }

  bind() {
    if (!this.root || !this.documentObject) return () => this.destroy();
    const schedule = () => this.windowObject?.setTimeout
      ? this.windowObject.setTimeout(() => this.update(), 0)
      : setTimeout(() => this.update(), 0);
    const selectionChange = () => schedule();
    this.root.addEventListener('mouseup', schedule);
    this.root.addEventListener('touchend', schedule, { passive: true });
    this.documentObject.addEventListener('selectionchange', selectionChange);
    this._scrollHandler = () => {
      this.hide();
      this.windowObject?.getSelection?.()?.removeAllRanges?.();
    };
    this.root.addEventListener('scroll', this._scrollHandler, { passive: true });
    this.windowObject?.addEventListener?.('scroll', this._scrollHandler, { passive: true });
    this._handlers.push(() => this.root.removeEventListener('mouseup', schedule));
    this._handlers.push(() => this.root.removeEventListener('touchend', schedule));
    this._handlers.push(() => this.documentObject.removeEventListener('selectionchange', selectionChange));
    this._handlers.push(() => this.root.removeEventListener('scroll', this._scrollHandler));
    this._handlers.push(() => this.windowObject?.removeEventListener?.('scroll', this._scrollHandler));
    return () => this.destroy();
  }

  getSelection() {
    const selection = this.windowObject?.getSelection?.();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const element = range.commonAncestorContainer?.nodeType === 3
      ? range.commonAncestorContainer.parentElement
      : range.commonAncestorContainer;
    const content = element?.closest?.('[data-chat-selectable="true"]');
    if (!content || !this.root.contains?.(content)) return null;
    const selectedText = normalizeSelectedExcerpt(selection.toString());
    if (!selectedText) return null;
    return { selection, range, selectedText };
  }

  update() {
    const selected = this.getSelection();
    if (!selected) return this.hide();
    const rect = selected.range.getBoundingClientRect?.();
    if (!rect) return this.hide();
    this.show(selected.selectedText, rect);
  }

  show(text, rect) {
    this.hide();
    const button = this.documentObject.createElement('button');
    button.type = 'button';
    button.className = 'chat-selection-action';
    button.dataset.chatSelectionAction = 'follow-up';
    button.textContent = '追问';
    button.addEventListener('pointerdown', event => event.preventDefault());
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      this.onFollowUp?.(text);
      this.hide();
      this.windowObject?.getSelection?.()?.removeAllRanges?.();
    });
    const top = rect.bottom + 8 > (this.windowObject?.innerHeight || 0) - 48
      ? Math.max(8, rect.top - 46)
      : Math.max(8, rect.bottom + 8);
    button.style.left = `${Math.max(8, Math.min(rect.left, (this.windowObject?.innerWidth || 320) - 76))}px`;
    button.style.top = `${top}px`;
    this.documentObject.body.appendChild(button);
    this.button = button;
  }

  hide() {
    this.button?.remove?.();
    this.button = null;
  }

  destroy() {
    this._handlers.splice(0).forEach(remove => remove());
    this.hide();
  }
}
