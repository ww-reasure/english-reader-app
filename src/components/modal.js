/**
 * Modal Component
 * Handles API settings modal and import article modal
 */

import { Config } from '../config.js';
import { DB } from '../db.js';
import { DEEPSEEK_MODEL_IDS } from './deepseek-model-catalog.mjs';
import { modelDiscovery } from './model-discovery-client.mjs';
import {
  chooseRecommendedModel,
  describeModelDiscoveryError,
  populateModelSelect,
  readSelectedModel,
  syncCustomModelInput
} from './model-selector.mjs';
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
  _modelRefreshToken: 0,
  _modelAbortController: null,

  _renderModelPresets(select) {
    if (!select) return;
    populateModelSelect(select, { remote: false, includeCustom: true });
  },

  _setModelStatus(message, tone = '') {
    const status = document.getElementById('modelStatus');
    if (!status) return;
    status.textContent = String(message || '');
    status.className = `settings-form-status${tone ? ` is-${tone}` : ''}`;
  },

  _cancelModelRefresh() {
    this._modelRefreshToken += 1;
    this._modelAbortController?.abort?.();
    this._modelAbortController = null;
  },

  _bindModelDiscoveryControls() {
    const refresh = document.getElementById('modelRefresh');
    const baseUrl = document.getElementById('baseUrlInput');
    const apiKey = document.getElementById('apiKeyInput');
    if (refresh) refresh.onclick = () => { void this.refreshModelList({ force: true }); };
    [baseUrl, apiKey].forEach(input => {
      if (!input) return;
      input.oninput = () => {
        this._cancelModelRefresh();
        if (refresh) refresh.disabled = false;
        this._setModelStatus('API 配置已变化，请刷新模型列表。');
      };
    });
  },

  async refreshModelList({ force = false } = {}) {
    const select = document.getElementById('modelPreset');
    const input = document.getElementById('modelInput');
    const refresh = document.getElementById('modelRefresh');
    const baseUrlInput = document.getElementById('baseUrlInput');
    const baseUrl = baseUrlInput ? baseUrlInput.value.trim() : Config.get('base_url');
    const apiKey = document.getElementById('apiKeyInput')?.value.trim() || '';
    const currentModel = readSelectedModel(select, input) || Config.get('model');
    this._cancelModelRefresh();
    const token = this._modelRefreshToken;
    if (!apiKey) {
      this._setModelStatus('输入 API Key 后可自动获取模型。');
      if (refresh) refresh.disabled = false;
      return;
    }
    const controller = new AbortController();
    this._modelAbortController = controller;
    if (refresh) refresh.disabled = true;
    this._setModelStatus('正在获取模型列表…');
    try {
      const result = await modelDiscovery.load({ baseUrl, apiKey, force, signal: controller.signal });
      if (token !== this._modelRefreshToken) return;
      if (!result.models.length) {
        this._setModelStatus('服务未返回可用模型，可手动输入模型名称。', 'error');
        return;
      }
      const recommendation = chooseRecommendedModel({ models: result.models, currentModel });
      const selectedModel = recommendation.model || currentModel;
      populateModelSelect(select, { models: result.models, remote: true, selectedModel });
      syncCustomModelInput(select, input, { value: currentModel });
      if (recommendation.changed && currentModel && selectedModel !== currentModel) {
        this._setModelStatus(`当前模型已不可用，已临时选择 ${selectedModel}；保存后生效。`, 'error');
      } else {
        this._setModelStatus(`已获取 ${result.models.length} 个模型${result.fromCache ? '（缓存）' : ''}。`, 'success');
      }
    } catch (error) {
      if (token !== this._modelRefreshToken || error?.code === 'MODEL_LIST_CANCELLED') return;
      this._setModelStatus(describeModelDiscoveryError(error), 'error');
    } finally {
      if (token === this._modelRefreshToken) {
        this._modelAbortController = null;
        if (refresh) refresh.disabled = false;
      }
    }
  },

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
    this._renderModelPresets(preset);

    if (DEEPSEEK_MODEL_IDS.includes(savedModel) && [...preset.options].some(option => option.value === savedModel)) {
      preset.value = savedModel;
      customInput.style.display = 'none';
      customInput.value = '';
    } else {
      preset.value = 'custom';
      customInput.style.display = 'block';
      customInput.value = savedModel;
    }
    syncCustomModelInput(preset, customInput, { value: savedModel });
    this._bindModelDiscoveryControls();
    void this.refreshModelList();
  },

  // Hide API settings modal
  hideApiSettings({ markSeen = true } = {}) {
    this._cancelModelRefresh();
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
    const preset = document.getElementById('modelPreset');
    const input = document.getElementById('modelInput');
    syncCustomModelInput(preset, input);
    Config.markModelSelectionExplicit();
  },

  // Show import article modal
  showImport() {
    const modal = document.getElementById('importModal');
    if (!modal) return;
    this._resetImportState({ clearFields: true });
    modal.style.display = 'flex';
    document.getElementById('importTitle')?.focus();
  },

  // Hide import article modal
  hideImport() {
    const modal = document.getElementById('importModal');
    if (modal) modal.style.display = 'none';
    this._resetImportState({ clearFields: true });
  },

  _resetImportState({ clearFields = false } = {}) {
    this._importRequestId += 1;
    this._importFileData = null;
    this._importFilePromise = null;
    this._importSaving = false;
    const file = document.getElementById('importFile');
    if (file) file.value = '';
    if (clearFields) {
      const title = document.getElementById('importTitle');
      const content = document.getElementById('importContent');
      const translation = document.getElementById('importTranslation');
      if (title) title.value = '';
      if (content) content.value = '';
      if (translation) translation.value = '';
    }
    this._setImportStatus('');
    this._setImportBusy(false);
  },

  _setImportStatus(message, tone = '') {
    const status = document.getElementById('importStatus');
    if (!status) return;
    status.textContent = String(message || '');
    status.dataset.tone = tone;
  },

  _setImportBusy(busy, { lockFile = false } = {}) {
    const submit = document.getElementById('importSubmit');
    const file = document.getElementById('importFile');
    const cancel = document.getElementById('importCancel');
    if (submit) submit.disabled = Boolean(busy);
    if (file) file.disabled = Boolean(busy && lockFile);
    if (cancel) cancel.disabled = Boolean(busy && lockFile);
  },

  _showImportError(message, { alertUser = false } = {}) {
    const safeMessage = String(message || '导入失败，请重试');
    this._setImportStatus(safeMessage, 'error');
    if (alertUser && typeof alert === 'function') alert(safeMessage);
  },

  // Keep the legacy paste normalizer available to existing callers.
  normalizeText(text) {
    return normalizeImportedContent(text, { format: 'text' });
  },

  async handleImportFile(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    const requestId = ++this._importRequestId;
    this._importFileData = null;
    this._setImportStatus('正在读取文件…');
    this._setImportBusy(true, { lockFile: false });
    const pending = parseImportedDocument(file);
    this._importFilePromise = pending;

    try {
      const parsed = await pending;
      if (requestId !== this._importRequestId || this._importFilePromise !== pending) return;
      this._importFileData = parsed;
      const title = document.getElementById('importTitle');
      const content = document.getElementById('importContent');
      if (title && !title.value.trim()) title.value = parsed.title || titleFromFileName(file.name);
      if (content) content.value = parsed.content;
      this._setImportStatus(`已读取 ${parsed.fileName || file.name}，共 ${parsed.wordCount} 个英文词`, 'success');
    } catch (error) {
      if (requestId !== this._importRequestId || this._importFilePromise !== pending) return;
      this._importFileData = null;
      if (event?.target) event.target.value = '';
      this._showImportError(error?.message || '文件读取失败');
    } finally {
      if (requestId === this._importRequestId && this._importFilePromise === pending) {
        this._importFilePromise = null;
        this._setImportBusy(false);
      }
    }
  },

  // Handle article import
  async handleImport() {
    if (this._importSaving) return;
    const requestId = this._importRequestId;
    const pending = this._importFilePromise;
    if (pending) {
      try { await pending; } catch { return; }
    }
    if (requestId !== this._importRequestId) return;

    const title = document.getElementById('importTitle')?.value?.trim() || this._importFileData?.title || '';
    const content = normalizeImportedContent(document.getElementById('importContent')?.value || '', { format: 'text' });
    const translation = normalizeImportedContent(document.getElementById('importTranslation')?.value || '', { format: 'text' });
    const difficulty = document.getElementById('importDifficulty')?.value || 'cet4';
    if (!title) { this._showImportError('请输入标题', { alertUser: true }); return; }
    const validation = validateImportedContent(content);
    if (!validation.valid) {
      this._showImportError(validation.message || '请输入有效英文正文', { alertUser: true });
      return;
    }

    this._importSaving = true;
    this._setImportBusy(true, { lockFile: true });
    this._setImportStatus('正在检查重复文章…');
    try {
      const article = prepareImportedArticle({
        title,
        content,
        translation,
        difficulty,
        fileName: this._importFileData?.fileName || ''
      });
      const existing = typeof DB.getAllArticles === 'function' ? await DB.getAllArticles() : [];
      if (requestId !== this._importRequestId) return;
      const duplicate = existing.some(item => item?.contentFingerprint === article.contentFingerprint
        || contentFingerprint(item?.content || '') === article.contentFingerprint);
      if (duplicate) {
        this._showImportError('这篇文章已经在书架中，未重复导入。');
        return;
      }

      this._setImportStatus('保存中…');
      const id = await DB.saveArticle(article);
      if (requestId !== this._importRequestId) return;
      const detail = { article: { ...article, id }, title: article.title };
      this.hideImport();
      document.dispatchEvent(new CustomEvent('article-imported', { detail }));
    } catch (error) {
      if (requestId === this._importRequestId) {
        this._showImportError(error?.message || '保存文章失败，请稍后重试');
      }
    } finally {
      this._importSaving = false;
      if (requestId === this._importRequestId) this._setImportBusy(false);
    }
  }
};

window.Modal = Modal;
