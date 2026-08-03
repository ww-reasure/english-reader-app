/**
 * Configuration Module
 * Manages application settings with Android secure storage and a WebView fallback.
 */

import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { createConfigStorage } from './config-storage.mjs';
import { requiresTargetTrackSelection } from './learning-track.mjs';

const API_ONBOARDING_SEEN_KEY = 'api_onboarding_seen';
const shouldShowApiOnboarding = ({ apiKey = '', seen = false } = {}) => (
  !String(apiKey || '').trim() && !Boolean(seen)
);

export const ARTICLE_SERVER_URL = 'https://ww-d3g9m97i69d544809.service.tcloudbase.com';

export const Config = {
  storage: createConfigStorage({
    webStorage: globalThis.localStorage,
    nativeStorage: SecureStorage,
    isNative: Capacitor.isNativePlatform()
  }),

  // Default values
  defaults: {
    // api_onboarding_seen is persisted with the rest of the secure settings.
    api_key: '',
    [API_ONBOARDING_SEEN_KEY]: 'false',
    base_url: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
    theme: 'light',
    // A display control may visually default to CET-4, but a new learner must
    // make a deliberate target choice before the app creates reading material.
    exam_level: '',
    level: 'easy',
    // `exam_level` is the fixed target; recommendation is stored separately.
    reading_mode: 'support',
    reading_word_marking: 'false',
    coverage: '97',
    new_word_percent: '3',
    target_track_selection_required: 'true',
    calibration_status: 'new',
    lexicon_version: '',
    assessment_done: 'false'
  },

  async initialize() {
    await this.storage.initialize();
    // Migrate presentation-era settings without relabelling old articles or
    // silently deciding whether an old "考研" target meant English I or II.
    if (!this.storage.get('reading_mode')) {
      const legacyLevel = this.storage.get('level');
      this.set('reading_mode', legacyLevel === 'hard' ? 'stretch' : legacyLevel === 'easy' ? 'support' : 'standard');
    }
    const storedTargetTrack = this.storage.get('exam_level');
    const storedTargetSelectionRequirement = this.storage.get('target_track_selection_required');
    if (requiresTargetTrackSelection(storedTargetTrack, storedTargetSelectionRequirement)) {
      this.set('target_track_selection_required', 'true');
    } else if (!storedTargetSelectionRequirement) {
      // A persisted CET-4/CET-6/English I/English II choice from an earlier
      // version is a real user choice, so keep it without a needless prompt.
      this.set('target_track_selection_required', 'false');
    }
    if (!this.storage.get('calibration_status')) {
      this.set('calibration_status', this.storage.get('assessment_done') === 'true' ? 'legacy' : 'new');
    }
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

  shouldShowApiOnboarding() {
    return shouldShowApiOnboarding({
      apiKey: this.get('api_key'),
      seen: this.get(API_ONBOARDING_SEEN_KEY) === 'true'
    });
  },

  markApiOnboardingSeen() {
    this.set(API_ONBOARDING_SEEN_KEY, 'true');
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
    this.markApiOnboardingSeen();

    return true;
  }
};
