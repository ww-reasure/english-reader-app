const MAX_COPY_LENGTH = 12000;
const bindings = new WeakMap();

export function normalizeCopyText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_COPY_LENGTH);
}

export async function copyPlainText(value, {
  navigatorObject = globalThis.navigator,
  documentObject = globalThis.document
} = {}) {
  const text = normalizeCopyText(value);
  if (!text) return false;

  if (typeof navigatorObject?.clipboard?.writeText === 'function') {
    try {
      await navigatorObject.clipboard.writeText(text);
      return true;
    } catch {
      // Some Android WebViews expose clipboard.writeText but reject it at runtime.
    }
  }

  const body = documentObject?.body;
  if (!documentObject?.createElement || !body?.appendChild) return false;
  const textarea = documentObject.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute?.('readonly', '');
  textarea.setAttribute?.('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  textarea.style.opacity = '0';

  body.appendChild(textarea);
  try {
    textarea.select?.();
    textarea.setSelectionRange?.(0, text.length);
    return typeof documentObject.execCommand === 'function'
      ? documentObject.execCommand('copy') !== false
      : false;
  } catch {
    return false;
  } finally {
    textarea.remove?.();
    if (textarea.parentElement) documentObject.body?.removeChild?.(textarea);
  }
}

export function createCopyButton({ label = '复制回复' } = {}) {
  const button = (globalThis.document?.createElement?.('button')) || {
    dataset: {},
    _attributes: new Map(),
    setAttribute(name, value) { this._attributes.set(name, String(value)); },
    getAttribute(name) { return this._attributes.get(name); },
    addEventListener() {},
    contains(node) { return node === this; }
  };
  button.type = 'button';
  button.className = 'message-copy-btn';
  button.dataset.messageAction = 'copy';
  button.dataset.copyLabel = label;
  button.setAttribute?.('aria-label', label);
  button.setAttribute?.('title', label);
  button.textContent = '复制';
  return button;
}

const setFeedback = (button, success, label) => {
  button.dataset.copyState = success ? 'success' : 'error';
  button.setAttribute?.('aria-label', success ? '已复制' : '复制失败');
  button.textContent = success ? '已复制' : '复制失败';
  button.disabled = false;
  return () => {
    button.dataset.copyState = '';
    button.setAttribute?.('aria-label', label);
    button.textContent = '复制';
  };
};

export function bindMessageCopy(container, {
  navigatorObject = globalThis.navigator,
  documentObject = globalThis.document,
  feedbackMs = 1500
} = {}) {
  if (!container?.addEventListener) return () => {};
  bindings.get(container)?.();

  const timers = new Set();
  const onClick = async event => {
    const button = event.target?.closest?.('[data-message-action="copy"]');
    if (!button || !container.contains?.(button) || button.disabled) return;
    const message = button.closest?.('[data-copyable="true"], [data-copyable]');
    const content = message?.querySelector?.('[data-copy-content]');
    if (!message || !content) return;

    event.preventDefault?.();
    event.stopPropagation?.();
    const copyText = normalizeCopyText(typeof content.innerText === 'string' ? content.innerText : content.textContent);
    if (!copyText) return;
    const label = button.dataset.copyLabel || '复制回复';
    button.disabled = true;
    let success = false;
    try {
      success = await copyPlainText(copyText, { navigatorObject, documentObject });
    } catch {
      success = false;
    }
    const reset = setFeedback(button, success, label);
    const timer = setTimeout(() => {
      timers.delete(timer);
      reset();
    }, Math.max(0, Number(feedbackMs) || 0));
    timers.add(timer);
  };

  container.addEventListener('click', onClick);
  const cleanup = () => {
    container.removeEventListener('click', onClick);
    timers.forEach(timer => clearTimeout(timer));
    timers.clear();
    if (bindings.get(container) === cleanup) bindings.delete(container);
  };
  bindings.set(container, cleanup);
  return cleanup;
}

export const MAX_COPY_TEXT_LENGTH = MAX_COPY_LENGTH;
