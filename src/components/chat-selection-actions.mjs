export const MAX_SELECTED_EXCERPT_LENGTH = 600;

export function normalizeSelectedExcerpt(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_SELECTED_EXCERPT_LENGTH);
}

const elementFor = node => node?.nodeType === 3 ? node.parentElement : node;

const selectableFor = (node, root) => {
  const element = elementFor(node);
  const selectable = element?.closest?.('[data-chat-selectable="true"]');
  return selectable && root?.contains?.(selectable) ? selectable : null;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

export class ChatSelectionActions {
  constructor({
    root,
    documentObject = globalThis.document,
    windowObject = globalThis.window,
    onAsk = null,
    enabled = true,
    label = '追问所选内容'
  } = {}) {
    this.root = root;
    this.documentObject = documentObject;
    this.windowObject = windowObject;
    this.onAsk = onAsk;
    this.enabled = enabled;
    this.label = label;
    this.button = null;
    this._listeners = [];
    this._scheduleTimer = null;
  }

  bind() {
    this.destroy();
    if (!this.root || !this.documentObject?.addEventListener) return () => this.destroy();

    const schedule = () => {
      if (this._scheduleTimer) clearTimeout(this._scheduleTimer);
      this._scheduleTimer = setTimeout(() => {
        this._scheduleTimer = null;
        this.update();
      }, 0);
    };
    const onEscape = event => {
      if (event.key === 'Escape') this.hide();
    };
    const onScroll = () => this.hide();

    this.root.addEventListener('mouseup', schedule);
    this.root.addEventListener('touchend', schedule, { passive: true });
    this.root.addEventListener('scroll', onScroll, { passive: true });
    this.documentObject.addEventListener('selectionchange', schedule);
    this.documentObject.addEventListener('keydown', onEscape);
    this.windowObject?.addEventListener?.('scroll', onScroll, { passive: true });
    this._listeners = [
      () => this.root.removeEventListener('mouseup', schedule),
      () => this.root.removeEventListener('touchend', schedule),
      () => this.root.removeEventListener('scroll', onScroll),
      () => this.documentObject.removeEventListener('selectionchange', schedule),
      () => this.documentObject.removeEventListener('keydown', onEscape),
      () => this.windowObject?.removeEventListener?.('scroll', onScroll)
    ];
    return () => this.destroy();
  }

  getSelection() {
    if (!this.enabled) return null;
    const selection = this.windowObject?.getSelection?.();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    try {
      const range = selection.getRangeAt(0);
      const startRoot = selectableFor(range.startContainer, this.root);
      const endRoot = selectableFor(range.endContainer, this.root);
      if (!startRoot || startRoot !== endRoot) return null;
      const commonAncestor = elementFor(range.commonAncestorContainer);
      if (commonAncestor !== startRoot && !startRoot.contains?.(commonAncestor)) return null;
      const selectedText = normalizeSelectedExcerpt(selection.toString());
      if (!selectedText) return null;
      return { selection, range, selectedText, selectableRoot: startRoot };
    } catch {
      return null;
    }
  }

  update() {
    const selected = this.getSelection();
    if (!selected) {
      this.hide();
      return;
    }
    const rect = selected.range.getBoundingClientRect?.();
    if (!rect) {
      this.hide();
      return;
    }
    this.show(selected, rect);
  }

  show(selected, rect) {
    this.hide();
    const button = this.documentObject?.createElement?.('button');
    if (!button) return;
    button.type = 'button';
    button.className = 'chat-selection-action';
    button.dataset.chatSelectionAction = 'ask';
    button.setAttribute?.('aria-label', this.label);
    button.textContent = this.label;
    button.addEventListener?.('pointerdown', event => event.preventDefault());
    button.addEventListener?.('click', event => {
      event.preventDefault?.();
      event.stopPropagation?.();
      this.onAsk?.(selected.selectedText, selected);
      this.hide();
      selected.selection.removeAllRanges?.();
    });

    const viewportWidth = Math.max(0, Number(this.windowObject?.innerWidth) || 0);
    const viewportHeight = Math.max(0, Number(this.windowObject?.innerHeight) || 0);
    const buttonWidth = 180;
    const buttonHeight = 48;
    const rawLeft = Number(rect.left) || 0;
    const left = clamp(rawLeft, 8, viewportWidth - buttonWidth - 8);
    const below = (Number(rect.bottom) || 0) + 8;
    const above = (Number(rect.top) || 0) - buttonHeight;
    const preferredTop = below + buttonHeight <= viewportHeight - 8 ? below : above;
    const top = clamp(preferredTop, 8, viewportHeight - buttonHeight - 8);
    button.style.left = `${left}px`;
    button.style.top = `${top}px`;
    this.documentObject.body?.appendChild?.(button);
    this.button = button;
  }

  hide() {
    this.button?.remove?.();
    this.button = null;
  }

  destroy() {
    if (this._scheduleTimer) clearTimeout(this._scheduleTimer);
    this._scheduleTimer = null;
    this._listeners.splice(0).forEach(remove => remove());
    this.hide();
  }
}
