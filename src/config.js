/**
 * Configuration Module
 * Manages application settings using localStorage
 */

export const Config = {
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

  // Get a setting value
  get(key) {
    return localStorage.getItem(key) || this.defaults[key] || '';
  },

  // Set a setting value
  set(key, value) {
    localStorage.setItem(key, value);
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
