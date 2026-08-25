const OFFICIAL_DEEPSEEK_HOSTNAME = 'api.deepseek.com';

export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash-vision-exp';

export const DEEPSEEK_MODEL_IDS = Object.freeze([
  DEFAULT_DEEPSEEK_MODEL,
  'deepseek-v4-flash',
  'deepseek-v4-pro'
]);

const PRESETS = Object.freeze([
  Object.freeze({
    id: DEFAULT_DEEPSEEK_MODEL,
    label: 'DeepSeek V4 Flash Vision Exp（默认·视觉）',
    provider: 'deepseek',
    inputModalities: Object.freeze(['text', 'image']),
    images: true,
    files: true,
    tools: true,
    responses: true,
    supportsFiles: true,
    supportsTools: true,
    supportsResponses: true,
    experimental: true
  }),
  Object.freeze({
    id: 'deepseek-v4-flash',
    label: 'DeepSeek V4 Flash（快速）',
    provider: 'deepseek',
    inputModalities: Object.freeze(['text']),
    images: false,
    files: false,
    tools: true,
    responses: true,
    supportsFiles: false,
    supportsTools: true,
    supportsResponses: true,
    experimental: false
  }),
  Object.freeze({
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro（高质量）',
    provider: 'deepseek',
    inputModalities: Object.freeze(['text']),
    images: false,
    files: false,
    tools: true,
    responses: true,
    supportsFiles: false,
    supportsTools: true,
    supportsResponses: true,
    experimental: false
  })
]);

const clonePreset = preset => ({
  ...preset,
  inputModalities: [...preset.inputModalities]
});

export function listDeepSeekModelPresets() {
  return PRESETS.map(clonePreset);
}

export function modelCapabilities(model) {
  const preset = PRESETS.find(item => item.id === String(model || '').trim());
  if (!preset) {
    return {
      known: false,
      provider: 'custom',
      inputModalities: ['text'],
      images: false,
      files: false,
      tools: false,
      responses: false,
      supportsFiles: false,
      supportsTools: false,
      supportsResponses: false
    };
  }
  return { known: true, ...clonePreset(preset) };
}

export function resolveVisionDefaultMigration({ model = '', explicitSelection = false, migrated = false } = {}) {
  const currentModel = String(model || '').trim();
  if (!currentModel) return { model: DEFAULT_DEEPSEEK_MODEL, migrated: Boolean(migrated), changed: false };
  if (explicitSelection || migrated || currentModel !== 'deepseek-v4-flash') {
    return { model: currentModel, migrated: Boolean(migrated), changed: false };
  }
  return { model: DEFAULT_DEEPSEEK_MODEL, migrated: true, changed: true };
}

function isOfficialDeepSeekUrl(baseUrl) {
  try {
    return new URL(String(baseUrl || '')).hostname.toLowerCase() === OFFICIAL_DEEPSEEK_HOSTNAME;
  } catch {
    return false;
  }
}

export function resolveModelForRequest({ baseUrl, selectedModel = DEFAULT_DEEPSEEK_MODEL, hasImages = false } = {}) {
  const model = String(selectedModel || '').trim() || DEFAULT_DEEPSEEK_MODEL;
  const capabilities = modelCapabilities(model);
  if (!hasImages || capabilities.images) {
    return { model, temporaryOverride: false, capabilities };
  }

  if (model !== 'deepseek-v4-flash' && model !== 'deepseek-v4-pro') {
    return { error: 'custom_model_image_capability_unknown' };
  }

  if (!isOfficialDeepSeekUrl(baseUrl)) {
    return { error: 'custom_model_image_capability_unknown' };
  }

  const visionCapabilities = modelCapabilities(DEFAULT_DEEPSEEK_MODEL);
  return {
    model: DEFAULT_DEEPSEEK_MODEL,
    temporaryOverride: true,
    capabilities: visionCapabilities
  };
}
