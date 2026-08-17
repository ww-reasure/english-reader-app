/**
 * Modal Component
 * Handles API settings modal and import article modal
 */

import { Config } from '../config.js';
import { DB } from '../db.js';
import {
  contentFingerprint,
  normalizeImportedContent,
  parseImportedDocument,
  prepareImportedArticle,
  titleFromFileName,
  validateImportedContent
} from './article-import.mjs';

export const Modal = {
  _importFileData: null,
  _importFilePromise: null,
  _importRequestId: 0,
  _importSaving: false,
  // Show API settings modal
  showApiSettings({ onboarding = false } = {}) {
    const modal = document.getElementById('apiKeyModal');
    if (!modal) return;
    modal.dataset.onboarding = onboarding ? 'true' : 'false';
    modal.querySelector('#apiKeyModalTitle')?.replaceChildren(document.createTextNode(onboarding ? '连接 AI 学习助手' : '连接阅读引擎'));
    modal.style.display = 'flex';

    // Populate fields
    document.getElementById('apiKeyInput').value = Config.get('api_key');
    document.getElementById('baseUrlInput').value = Config.get('base_url');

    // Set model preset
    const savedModel = Config.get('model');
    const preset = document.getElementById('modelPreset');
    const customInput = document.getElementById('modelInput');

    if (['deepseek-v4-flash', 'deepseek-v4-pro'].includes(savedModel)) {
      preset.value = savedModel;
      customInput.style.display = 'none';
    } else {
      preset.value = 'custom';
      customInput.style.display = 'block';
      customInput.value = savedModel;
    }
  },

  // Hide API settings modal
  hideApiSettings({ markSeen = true } = {}) {
    const modal = document.getElementById('apiKeyModal');
    if (modal) modal.style.display = 'none';
    if (markSeen) Config.markApiOnboardingSeen();
  },

  // Save API settings
  saveApiSettings() {
    if (Config.saveFromModal()) {
      this.hideApiSettings({ markSeen: true });
    }
  },

  // Handle model preset change
  onModelPresetChange() {
    const preset = document.getElementById('modelPreset').value;
    document.getElementById('modelInput').style.display = preset === 'custom' ? 'block' : 'none';
  },

  // Show import article modal
  showImport() {
    const modal = document.getElementById('importModal');
    if (!modal) return;
    modal.style.display = 'flex';
    document.getElementById('importTitle').value = '';
    document.getElementById('importContent').value = '';
    document.getElementById('importTranslation').value = '';
    const file = document.getElementById('importFile');
    if (file) file.value = '';
    this._importFileData = null;
    this._importFilePromise = null;
    this._importRequestId += 1;
    this._importSaving = false;
    this._setImportStatus('');
    this._setImportBusy(false);
  },

  // Hide import article modal
  hideImport() {
    const modal = document.getElementById('importModal');
    if (modal) modal.style.display = 'none';
    this._importRequestId += 1;
    this._setImportBusy(false);
  },

  _setImportStatus(message, tone = '') {
    const status = document.getElementById('importStatus');
    if (!status) return;
    status.textContent = String(message || '');
    status.dataset.tone = tone;
  },

  _setImportBusy(busy) {
    const submit = document.getElementById('importSubmit');
    const file = document.getElementById('importFile');
    if (submit) submit.disabled = Boolean(busy);
    if (file) file.disabled = Boolean(busy);
  },

  _showImportError(message) {
    this._setImportStatus(message, 'error');
    if (typeof alert === 'function') alert(message);
  },

  // Normalize pasted text and keep the legacy method available to callers.
  normalizeText(text) {
    return normalizeImportedContent(text);
  },

  async handleImportFile(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    const requestId = ++this._importRequestId;
    this._setImportStatus('正在读取文件…');
    let pending;
    try {
      pending = parseImportedDocument(file);
    } catch (error) {
      this._showImportError(error?.message || '文件读取失败');
      return;
    }
    this._importFilePromise = pending;
    this._setImportBusy(true);
    try {
      const parsed = await pending;
      if (this._importFilePromise !== pending || requestId !== this._importRequestId) return;
      this._importFileData = parsed;
      const title = document.getElementById('importTitle');
      const content = document.getElementById('importContent');
      if (title && !title.value.trim()) title.value = parsed.title || titleFromFileName(file.name);
      if (content) content.value = parsed.content;
      this._setImportStatus(`已读取 ${parsed.fileName || file.name}，${parsed.wordCount} 词`, 'success');
    } catch (error) {
      if (this._importFilePromise === pending && requestId === this._importRequestId) {
        this._importFileData = null;
        this._setImportStatus(error?.message || '文件读取失败', 'error');
        if (typeof alert === 'function') alert(error?.message || '文件读取失败');
      }
    } finally {
      if (this._importFilePromise === pending) {
        this._importFilePromise = null;
        this._setImportBusy(false);
      }
    }
  },

  // Handle article import
  async handleImport() {
    if (this._importSaving) return;
    const requestId = this._importRequestId;
    if (this._importFilePromise) {
      try { await this._importFilePromise; } catch { return; }
    }
    if (requestId !== this._importRequestId) return;
    const titleInput = document.getElementById('importTitle');
    const contentInput = document.getElementById('importContent');
    const translationInput = document.getElementById('importTranslation');
    const difficultyInput = document.getElementById('importDifficulty');
    const title = titleInput?.value?.trim() || this._importFileData?.title || '';
    const content = normalizeImportedContent(contentInput?.value || '', { format: this._importFileData?.format || 'text' });
    const translation = normalizeImportedContent(translationInput?.value || '');
    const difficulty = ['cet4', 'cet6', 'kaoyan1', 'kaoyan2', 'graduate'].includes(difficultyInput?.value)
      ? difficultyInput.value
      : 'cet4';

    if (!title) { this._showImportError('请输入标题'); return; }
    const validation = validateImportedContent(content);
    if (!validation.valid) { this._showImportError(validation.message || '请输入有效英文正文'); return; }

    this._importSaving = true;
    this._setImportBusy(true);
    this._setImportStatus('正在检查重复文章…');
    try {
      const fingerprint = contentFingerprint(content);
      const existing = typeof DB.getAllArticles === 'function' ? await DB.getAllArticles() : [];
      if (existing.some(article => contentFingerprint(article?.content || '') === fingerprint)) {
        this._showImportError('这篇文章已经在书架中，未重复导入。');
        return;
      }

      const article = {
        ...prepareImportedArticle({
        title,
        content,
        translation,
        difficulty,
        fileName: this._importFileData?.fileName || ''
        }),
        sourceType: 'imported',
        source: 'local'
      };
      this._setImportStatus('保存中…');
      const id = await DB.saveArticle(article);
      this.hideImport();
      document.dispatchEvent(new CustomEvent('article-imported', {
        detail: { article: { ...article, id }, title: article.title }
      }));
    } catch (error) {
      this._showImportError(error?.message || '保存文章失败，请稍后重试');
    } finally {
      this._importSaving = false;
      if (document.getElementById('importModal')?.style.display !== 'none') this._setImportBusy(false);
    }
  }
};

window.Modal = Modal;
