/**
 * Configuration Module
 * Manages application settings with Android secure storage and a WebView fallback.
 */

import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { createConfigStorage } from './config-storage.mjs';

export const ARTICLE_SERVER_URL = 'https://ww-d3g9m97i69d544809.service.tcloudbase.com';

export const Config = {
  storage: createConfigStorage({
    webStorage: globalThis.localStorage,
    nativeStorage: SecureStorage,
    isNative: Capacitor.isNativePlatform()
  }),

  // Default values
  defaults: {
    api_key: '',
    base_url: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
    theme: 'light',
    exam_level: 'cet4',
    level: 'easy',
    coverage: '95',
    new_word_percent: '5',
    assessment_done: 'false'
  },

  async initialize() {
    await this.storage.initialize();
  },

  // Get a setting value from the initialized in-memory cache.
  get(key) {
    return this.storage.get(key) || this.defaults[key] || '';
  },

  // Persist asynchronously while preserving the synchronous caller API.
  set(key, value) {
    void this.storage.set(key, value);
  },

  // Check if API key exists
  hasApiKey() {
    return !!this.get('api_key');
  },

  // Get all settings as object
  getAll() {
    return {
      apiKey: this.get('api_key'),
      baseUrl: this.get('base_url'),
      model: this.get('model'),
      theme: this.get('theme')
    };
  },

  // Save settings from modal
  saveFromModal() {
    const key = document.getElementById('apiKeyInput').value.trim();
    if (!key) {
      alert('请输入 API Key');
      return false;
    }

    const preset = document.getElementById('modelPreset').value;
    const model = preset === 'custom'
      ? document.getElementById('modelInput').value.trim()
      : preset;

    this.set('api_key', key);
    this.set('base_url', document.getElementById('baseUrlInput').value.trim() || this.defaults.base_url);
    this.set('model', model || this.defaults.model);

    return true;
  }
};
