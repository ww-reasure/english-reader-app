export const CONFIG_STORAGE_KEY = 'english_reader_settings_v1';

export const CONFIG_STORAGE_KEYS = [
  'api_key',
  'api_onboarding_seen',
  'base_url',
  'model',
  'model_selection_explicit',
  'vision_default_migration',
  'theme',
  'exam_level',
  'level',
  'coverage',
  'new_word_percent',
  'reading_mode',
  'reading_word_marking',
  'reading_phrase_highlighting',
  'home_learning_response_mode',
  'target_track_selection_required',
  'calibration_status',
  'lexicon_version',
  'assessment_done',
  'assessment_profile',
  'assessment_date',
  'assessment_vocab',
  'tavily_api_key',
  'web_research_mode'
];

const SENSITIVE_CONFIG_KEYS = new Set(['api_key', 'tavily_api_key']);

function pickSettings(source, predicate) {
  return Object.fromEntries(Object.entries(isRecord(source) ? source : {})
    .filter(([key]) => CONFIG_STORAGE_KEYS.includes(key) && predicate(key)));
}

function sameRecord(left, right) {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

function readWebSettings(webStorage) {
  return Object.fromEntries(CONFIG_STORAGE_KEYS.flatMap((key) => {
    const value = webStorage?.getItem(key);
    return value == null ? [] : [[key, value]];
  }));
}

function isRecord(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function createConfigStorage({ webStorage, nativeStorage = null, isNative = false } = {}) {
  // Display and behavior settings are available synchronously for the first
  // frame. Secrets are merged from the native bridge during initialize().
  let values = readWebSettings(webStorage);
  let nativeAvailable = false;
  let pendingWrite = Promise.resolve();

  return {
    async initialize() {
      const webValues = readWebSettings(webStorage);
      values = { ...webValues };

      if (!isNative || !nativeStorage) return;

      try {
        const storedNativeValues = await nativeStorage.get(CONFIG_STORAGE_KEY);
        const nativeValues = isRecord(storedNativeValues) ? storedNativeValues : {};
        const nativeSecrets = pickSettings(nativeValues, key => SENSITIVE_CONFIG_KEYS.has(key));
        const webSecrets = pickSettings(webValues, key => SENSITIVE_CONFIG_KEYS.has(key));
        const legacyNativeSettings = pickSettings(nativeValues, key => !SENSITIVE_CONFIG_KEYS.has(key));
        for (const [key, value] of Object.entries(legacyNativeSettings)) {
          if (webStorage?.getItem(key) == null) webStorage?.setItem(key, value);
        }
        const localValues = { ...legacyNativeSettings, ...pickSettings(webValues, key => !SENSITIVE_CONFIG_KEYS.has(key)) };
        const secureValues = { ...nativeSecrets, ...Object.fromEntries(
          Object.entries(webSecrets).filter(([key]) => nativeSecrets[key] == null)
        ) };
        values = { ...localValues, ...secureValues };
        if (!sameRecord(nativeValues, secureValues)) {
          await nativeStorage.set(CONFIG_STORAGE_KEY, secureValues);
        }
        nativeAvailable = true;
        SENSITIVE_CONFIG_KEYS.forEach(key => webStorage?.removeItem(key));
      } catch (error) {
        console.warn('Native configuration storage is unavailable; using WebView storage.', error);
      }
    },

    get(key) {
      return values[key] ?? '';
    },

    async set(key, value) {
      values[key] = String(value);

      if (!SENSITIVE_CONFIG_KEYS.has(key)) {
        webStorage?.setItem(key, values[key]);
        return;
      }

      if (!nativeAvailable) {
        webStorage?.setItem(key, values[key]);
        return;
      }

      const snapshot = pickSettings(values, candidate => SENSITIVE_CONFIG_KEYS.has(candidate));
      const persist = async () => {
        if (!nativeAvailable) {
          webStorage?.setItem(key, values[key]);
          return;
        }

        try {
          await nativeStorage.set(CONFIG_STORAGE_KEY, snapshot);
        } catch (error) {
          nativeAvailable = false;
          webStorage?.setItem(key, values[key]);
          console.warn('Native configuration storage failed; falling back to WebView storage.', error);
        }
      };

      pendingWrite = pendingWrite.then(persist, persist);
      await pendingWrite;
    }
  };
}
