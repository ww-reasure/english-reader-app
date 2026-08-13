const copyTextLimit = 12000;

export function normalizeCopyText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
    .slice(0, copyTextLimit);
}

export async function copyPlainText(value, {
  navigatorObject = globalThis.navigator,
  documentObject = globalThis.document
} = {}) {
  const text = normalizeCopyText(value);
  if (!text) return false;

  if (navigatorObject?.clipboard?.writeText) {
    try {
      await navigatorObject.clipboard.writeText(text);
      return true;
    } catch {
      // Older WebViews can expose clipboard but reject the promise. Continue
      // to the textarea path instead of reporting a false hard failure.
    }
  }

  if (!documentObject?.createElement || !documentObject.body?.appendChild) return false;
  const area = documentObject.createElement('textarea');
  area.value = text;
  area.setAttribute?.('readonly', '');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  area.style.opacity = '0';
  documentObject.body.appendChild(area);
  try {
    area.select?.();
    return documentObject.execCommand?.('copy') === true;
  } catch {
    return false;
  } finally {
    area.remove?.();
    if (area.parentNode && !area.remove) area.parentNode.removeChild?.(area);
  }
}

export function createCopyButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'message-copy-action';
  button.dataset.messageCopy = 'true';
  button.setAttribute('aria-label', '复制回复');
  button.title = '复制回复';
  button.innerHTML = '<i class="fa-regular fa-copy" aria-hidden="true"></i>';
  return button;
}

export function bindMessageCopy(container, {
  documentObject = globalThis.document,
  navigatorObject = globalThis.navigator,
  feedbackMs = 1500
} = {}) {
  if (!container) return () => {};

  const onClick = async event => {
    const button = event.target?.closest?.('[data-message-copy]');
    if (!button || !container.contains?.(button)) return;
    event.preventDefault();
    event.stopPropagation();
    const owner = button.closest?.('[data-copyable]');
    const content = owner?.matches?.('[data-copy-content]')
      ? owner
      : owner?.querySelector?.('[data-copy-content]');
    const text = content?.textContent || '';
    try {
      const copied = await copyPlainText(text, { navigatorObject, documentObject });
      if (!copied) throw new Error('clipboard_unavailable');
      button.classList.add('is-copied');
      button.setAttribute('aria-label', '已复制');
      button.title = '已复制';
      button.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i>';
      setTimeout(() => {
        if (!button.isConnected) return;
        button.classList.remove('is-copied');
        button.setAttribute('aria-label', '复制回复');
        button.title = '复制回复';
        button.innerHTML = '<i class="fa-regular fa-copy" aria-hidden="true"></i>';
      }, feedbackMs);
    } catch {
      button.classList.add('is-error');
      button.setAttribute('aria-label', '复制失败');
      setTimeout(() => {
        if (!button.isConnected) return;
        button.classList.remove('is-error');
        button.setAttribute('aria-label', '复制回复');
      }, feedbackMs);
    }
  };

  container.addEventListener('click', onClick);
  return () => container.removeEventListener('click', onClick);
}
