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
  'target_track_selection_required',
  'calibration_status',
  'lexicon_version',
  'exam_word_lookup_enabled',
  'assessment_done',
  'assessment_profile',
  'assessment_date',
  'assessment_vocab',
  'tavily_api_key',
  'web_research_mode'
];

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
  let values = {};
  let nativeAvailable = false;
  let pendingWrite = Promise.resolve();

  return {
    async initialize() {
      const webValues = readWebSettings(webStorage);
      values = { ...webValues };

      if (!isNative || !nativeStorage) return;

      try {
        const nativeValues = await nativeStorage.get(CONFIG_STORAGE_KEY);
        values = { ...webValues, ...(isRecord(nativeValues) ? nativeValues : {}) };
        await nativeStorage.set(CONFIG_STORAGE_KEY, values);
        nativeAvailable = true;
        CONFIG_STORAGE_KEYS.forEach((key) => webStorage?.removeItem(key));
      } catch (error) {
        console.warn('Native configuration storage is unavailable; using WebView storage.', error);
      }
    },

    get(key) {
      return values[key] ?? '';
    },

    async set(key, value) {
      values[key] = String(value);

      if (!nativeAvailable) {
        webStorage?.setItem(key, values[key]);
        return;
      }

      const snapshot = { ...values };
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
