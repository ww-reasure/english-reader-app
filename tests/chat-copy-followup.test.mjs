import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

async function loadOptional(relativePath) {
  try {
    return await import(new URL(relativePath, import.meta.url));
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return null;
    throw error;
  }
}

class EventTargetFake {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || new Set();
    handlers.add(handler);
    this.listeners.set(type, handlers);
  }

  removeEventListener(type, handler) {
    this.listeners.get(type)?.delete(handler);
  }

  emit(type, event = {}) {
    for (const handler of this.listeners.get(type) || []) handler(event);
  }

  listenerCount(type) {
    return this.listeners.get(type)?.size || 0;
  }
}

class ElementFake extends EventTargetFake {
  constructor({ parentElement = null, textContent = '' } = {}) {
    super();
    this.parentElement = parentElement;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.attributes = new Map();
    this.textContent = textContent;
    this.innerText = textContent;
    this.removed = false;
    this.disabled = false;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    this.children = this.children.filter(item => item !== child);
    child.parentElement = null;
  }

  remove() {
    this.removed = true;
    this.parentElement?.removeChild(this);
  }

  contains(node) {
    return node === this || this.children.some(child => child.contains?.(node));
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }

  select() {}

  querySelector() {
    return null;
  }
}

class DocumentFake extends EventTargetFake {
  constructor() {
    super();
    this.body = new ElementFake();
    this.createdTextareas = [];
    this.execCommandCalls = [];
  }

  createElement(tagName) {
    const element = new ElementFake();
    element.tagName = String(tagName).toUpperCase();
    if (element.tagName === 'TEXTAREA') this.createdTextareas.push(element);
    return element;
  }

  execCommand(command) {
    this.execCommandCalls.push(command);
    return true;
  }
}

function selectableFixture() {
  const root = new ElementFake();
  const message = new ElementFake({ parentElement: root });
  const selectable = new ElementFake({ parentElement: message });
  const textNode = { nodeType: 3, parentElement: selectable };
  root.appendChild(message);
  message.appendChild(selectable);
  selectable.dataset.chatSelectable = 'true';
  selectable.closest = selector => selector === '[data-chat-selectable="true"]' ? selectable : null;
  return { root, message, selectable, textNode };
}

test('copying uses visible copy content, caps at 12000 characters, and exposes a copy button', async () => {
  const actions = await loadOptional('../src/components/message-actions.mjs');
  assert.ok(actions, 'message-actions.mjs must exist before copy behavior can be used');
  assert.equal(actions.normalizeCopyText(`  ${'x'.repeat(12050)}  `).length, 12000);

  const container = new ElementFake();
  const message = new ElementFake({ parentElement: container });
  message.dataset.copyable = 'true';
  const content = new ElementFake({ parentElement: message, textContent: 'Visible reply only' });
  content.dataset.copyContent = 'true';
  const button = actions.createCopyButton({ label: '复制回复' });
  button.dataset.messageAction = 'copy';
  button.closest = selector => {
    if (selector === '[data-message-action="copy"]') return button;
    if (selector.includes('[data-copyable')) return message;
    return null;
  };
  message.querySelector = selector => selector === '[data-copy-content]' ? content : null;
  container.appendChild(message);
  message.appendChild(content);
  message.appendChild(button);

  const copied = [];
  const cleanup = actions.bindMessageCopy(container, {
    navigatorObject: { clipboard: { writeText: async value => copied.push(value) } },
    documentObject: new DocumentFake(),
    feedbackMs: 60_000
  });
  container.emit('click', {
    target: button,
    preventDefault() {},
    stopPropagation() {}
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(copied, ['Visible reply only']);
  assert.match(button.getAttribute('aria-label'), /已复制|复制回复/);
  cleanup();
});

test('clipboard rejection falls back to a temporary textarea and always removes it', async () => {
  const actions = await loadOptional('../src/components/message-actions.mjs');
  assert.ok(actions, 'message-actions.mjs must exist before clipboard fallback can be used');
  const documentObject = new DocumentFake();
  const result = await actions.copyPlainText('fallback text', {
    navigatorObject: { clipboard: { writeText: async () => { throw new Error('WebView denied'); } } },
    documentObject
  });

  assert.equal(result, true);
  assert.deepEqual(documentObject.execCommandCalls, ['copy']);
  assert.equal(documentObject.createdTextareas.length, 1);
  assert.equal(documentObject.createdTextareas[0].removed, true);
  assert.equal(documentObject.body.children.length, 0);
});

test('selection quotes are normalized, bounded, confined to one AI reply, and cleaned on Escape/scroll/dispose', async () => {
  const actionsModule = await loadOptional('../src/components/chat-selection-actions.mjs');
  assert.ok(actionsModule, 'chat-selection-actions.mjs must exist before quote behavior can be used');
  const { ChatSelectionActions, normalizeSelectedExcerpt } = actionsModule;
  assert.equal(normalizeSelectedExcerpt(`  first\n second ${'x'.repeat(700)}`).length, 600);

  const documentObject = new DocumentFake();
  const windowObject = new EventTargetFake();
  windowObject.innerWidth = 120;
  windowObject.innerHeight = 90;
  const fixture = selectableFixture();
  const selection = {
    isCollapsed: false,
    rangeCount: 1,
    toString: () => '  first\n second  ',
    getRangeAt: () => ({
      startContainer: fixture.textNode,
      endContainer: fixture.textNode,
      commonAncestorContainer: fixture.textNode,
      getBoundingClientRect: () => ({ left: -40, right: 180, top: 82, bottom: 88 })
    }),
    removeAllRanges() {}
  };
  windowObject.getSelection = () => selection;
  let quoted = '';
  const controller = new ChatSelectionActions({
    root: fixture.root,
    documentObject,
    windowObject,
    onAsk: excerpt => { quoted = excerpt; }
  });
  const cleanup = controller.bind();
  controller.update();
  assert.equal(documentObject.body.children.length, 1);
  const button = documentObject.body.children[0];
  assert.equal(button.style.left, '8px');
  assert.equal(button.style.top, '34px');
  button.emit('click', { preventDefault() {}, stopPropagation() {} });
  assert.equal(quoted, 'first second');

  controller.update();
  assert.equal(documentObject.body.children.length, 1);
  documentObject.emit('keydown', { key: 'Escape' });
  assert.equal(documentObject.body.children.length, 0);
  controller.update();
  windowObject.emit('scroll');
  assert.equal(documentObject.body.children.length, 0);
  cleanup();
  assert.equal(documentObject.listenerCount('selectionchange'), 0);
  assert.equal(documentObject.listenerCount('keydown'), 0);
});

test('selection spanning two AI messages is rejected instead of producing a quote action', async () => {
  const actionsModule = await loadOptional('../src/components/chat-selection-actions.mjs');
  assert.ok(actionsModule, 'chat-selection-actions.mjs must exist before cross-message protection can be used');
  const { ChatSelectionActions } = actionsModule;
  const documentObject = new DocumentFake();
  const windowObject = new EventTargetFake();
  const first = selectableFixture();
  const second = selectableFixture();
  const root = new ElementFake();
  root.appendChild(first.root);
  root.appendChild(second.root);
  windowObject.getSelection = () => ({
    isCollapsed: false,
    rangeCount: 1,
    toString: () => 'cross message text',
    getRangeAt: () => ({
      startContainer: first.textNode,
      endContainer: second.textNode,
      getBoundingClientRect: () => ({ left: 20, top: 20, right: 80, bottom: 30 })
    })
  });
  const controller = new ChatSelectionActions({ root, documentObject, windowObject });
  controller.update();
  assert.equal(documentObject.body.children.length, 0);
  controller.destroy();
});

test('chat view wires copyable AI content and one reusable prompt quote chip', async () => {
  const source = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');
  assert.match(source, /message-actions\.mjs/);
  assert.match(source, /chat-selection-actions\.mjs/);
  assert.match(source, /data-copyable/);
  assert.match(source, /data-copy-content/);
  assert.match(source, /setAttribute\(['"]data-chat-selectable['"],\s*['"]true['"]\)/);
  assert.match(source, /#promptInput/);
  assert.match(source, /_chatFollowUpExcerpt/);
  assert.match(source, /source:\s*['"]chat_reply['"]/);
  assert.match(source, /Escape/);
  assert.match(source, /clearChatFollowUp/);
});
