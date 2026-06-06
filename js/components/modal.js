/**
 * Modal Component
 * Handles API settings modal and import article modal
 */

const Modal = {
  // Show API settings modal
  showApiSettings(required = false) {
    const modal = document.getElementById('apiKeyModal');
    modal.style.display = 'flex';
    modal.dataset.required = required ? '1' : '0';

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
  hideApiSettings() {
    const modal = document.getElementById('apiKeyModal');
    if (modal.dataset.required === '1' && !Config.hasApiKey()) return;
    modal.style.display = 'none';
  },

  // Save API settings
  saveApiSettings() {
    if (Config.saveFromModal()) {
      this.hideApiSettings();
    }
  },

  // Handle model preset change
  onModelPresetChange() {
    const preset = document.getElementById('modelPreset').value;
    document.getElementById('modelInput').style.display = preset === 'custom' ? 'block' : 'none';
  },

  // Show import article modal
  showImport() {
    document.getElementById('importModal').style.display = 'flex';
    document.getElementById('importTitle').value = '';
    document.getElementById('importContent').value = '';
    document.getElementById('importTranslation').value = '';
  },

  // Hide import article modal
  hideImport() {
    document.getElementById('importModal').style.display = 'none';
  },

  // Normalize pasted text (fix formatting issues)
  normalizeText(text) {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .split('\n').map(line => line.trim()).join('\n')
      .replace(/<[^>]+>/g, '')
      .replace(/[""]/g, '"')
      .replace(/['']/g, "'")
      .replace(/ {2,}/g, ' ')
      .replace(/[​-‍﻿]/g, '')
      .trim();
  },

  // Handle article import
  async handleImport() {
    const title = document.getElementById('importTitle').value.trim();
    const content = this.normalizeText(document.getElementById('importContent').value);
    const translation = this.normalizeText(document.getElementById('importTranslation').value);
    const difficulty = document.getElementById('importDifficulty').value;

    if (!title) { alert('请输入标题'); return; }
    if (!content) { alert('请输入英文内容'); return; }

    const article = {
      title,
      content,
      translation,
      difficulty,
      topic: 'imported',
      wordCount: content.split(/\s+/).length
    };

    const id = await DB.saveArticle(article);
    this.hideImport();
    Views.addArticleCard({ ...article, id });
    Views.addChatMessage('system', `文章"${title}"已导入`);
  }
};
