import {
  DEFAULT_DEEPSEEK_MODEL,
  listDeepSeekModelPresets
} from './deepseek-model-catalog.mjs';

export const MODEL_DISCOVERY_TTL_MS = 10 * 60 * 1000;

// A models endpoint may include embedding, ranking, moderation, speech and
// image-generation models that cannot answer the app's text chat requests.
// This is deliberately conservative: vision/chat models remain candidates.
const NON_CHAT_MODEL_PATTERN = /(?:embedding|\bembed\b|rerank|re[-_ ]?rank|moderation|whisper|transcri(?:be|ption)?|text[-_ ]?to[-_ ]?speech|\btts\b|image[-_ ]?(?:generation|gen)|stable[-_ ]?diffusion|dall[-_ ]?e|\bflux\b)/i;

const normalizeBaseUrl = value => String(value || '').trim().replace(/\/+$/, '');
const cancelledError = () => Object.assign(new Error('MODEL_LIST_CANCELLED'), {
  code: 'MODEL_LIST_CANCELLED'
});

function modelId(value) {
  const id = typeof value === 'string' ? value.trim() : String(value?.id || '').trim();
  return id || '';
}

export function normalizeModelRecords(payload) {
  const records = Array.isArray(payload) ? payload : payload?.data;
  if (!Array.isArray(records)) return [];
  const seen = new Set();
  return records.flatMap(record => {
    const id = modelId(record);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      ...(record && typeof record === 'object' && !Array.isArray(record)
        ? {
          ...(record.object ? { object: String(record.object) } : {}),
          ...(record.owned_by ? { owned_by: String(record.owned_by) } : {}),
          ...(Number.isFinite(Number(record.created)) ? { created: Number(record.created) } : {})
        }
        : {})
    }];
  });
}

export function isLikelyChatModel(model) {
  return !NON_CHAT_MODEL_PATTERN.test(modelId(model));
}

export function describeModelDiscoveryError(error) {
  const messages = {
    MODEL_LIST_MISSING_KEY: '请先输入 API Key，再刷新模型列表。',
    MODEL_LIST_INVALID_BASE_URL: '请先填写有效的 Base URL。',
    MODEL_LIST_AUTH: 'API Key 无效或没有读取模型列表的权限。',
    MODEL_LIST_UNSUPPORTED: '该服务未提供标准 /models 接口，可继续手动输入模型名称。',
    MODEL_LIST_RATE_LIMITED: '模型列表请求过于频繁，请稍后再试。',
    MODEL_LIST_TIMEOUT: '获取模型列表超时，请检查网络后重试。',
    MODEL_LIST_NETWORK: '无法连接模型服务，请检查 Base URL 和网络。',
    MODEL_LIST_INVALID_RESPONSE: '服务返回的模型列表格式无法识别，可继续手动输入。',
    MODEL_LIST_HTTP_ERROR: '获取模型列表失败，可继续手动输入。'
  };
  return messages[error?.code] || '获取模型列表失败，可继续手动输入。';
}

export function chooseRecommendedModel({
  models = [],
  currentModel = '',
  preferredModel = DEFAULT_DEEPSEEK_MODEL
} = {}) {
  const records = normalizeModelRecords(models);
  const ids = records.map(record => record.id);
  const current = modelId(currentModel);
  if (current && ids.includes(current)) return { model: current, changed: false, reason: 'available' };
  const preferred = modelId(preferredModel);
  if (preferred && ids.includes(preferred)) return { model: preferred, changed: true, reason: 'preferred' };
  const likelyChat = records.find(record => isLikelyChatModel(record.id));
  const fallback = likelyChat || records[0];
  return fallback
    ? { model: fallback.id, changed: true, reason: likelyChat ? 'likely_chat' : 'first_available' }
    : { model: '', changed: Boolean(current), reason: 'no_models' };
}

export function buildModelOptionRecords({ models = [], remote = false } = {}) {
  const presets = new Map(listDeepSeekModelPresets().map(preset => [preset.id, preset]));
  const records = remote
    ? normalizeModelRecords(models)
    : listDeepSeekModelPresets().map(preset => ({ id: preset.id }));
  return records.map(record => {
    const preset = presets.get(record.id);
    return {
      id: record.id,
      label: preset?.label || record.id,
      known: Boolean(preset)
    };
  });
}

export function createModelDiscovery({
  listModels,
  now = () => Date.now(),
  ttlMs = MODEL_DISCOVERY_TTL_MS
} = {}) {
  if (typeof listModels !== 'function') throw new TypeError('listModels must be a function');
  const cache = new Map();
  const inFlight = new Map();

  const cloneResult = result => ({
    models: result.models.map(model => ({ ...model })),
    fromCache: Boolean(result.fromCache)
  });

  const waitForOperation = (operation, signal) => {
    if (signal?.aborted) return Promise.reject(cancelledError());
    operation.consumerCount += 1;
    if (!signal) {
      return operation.promise
        .then(cloneResult)
        .finally(() => {
          operation.consumerCount -= 1;
          if (operation.pending && operation.consumerCount === 0) operation.controller.abort();
        });
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        operation.consumerCount -= 1;
        if (operation.pending && operation.consumerCount === 0) operation.controller.abort();
        callback(value);
      };
      const onAbort = () => finish(reject, cancelledError());
      signal.addEventListener('abort', onAbort, { once: true });
      operation.promise.then(
        result => finish(resolve, cloneResult(result)),
        error => finish(reject, error)
      );
    });
  };

  const load = async ({ baseUrl = '', apiKey = '', force = false, signal = null } = {}) => {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const normalizedApiKey = String(apiKey || '').trim();
    if (!normalizedApiKey) return { models: [], fromCache: false, skipped: 'missing_key' };
    if (signal?.aborted) throw cancelledError();
    const cacheKey = `${normalizedBaseUrl}\u0000${normalizedApiKey}`;
    const cached = cache.get(cacheKey);
    if (!force && cached && now() - cached.fetchedAt <= ttlMs) {
      return { models: cached.models.map(model => ({ ...model })), fromCache: true };
    }
    if (inFlight.has(cacheKey)) return waitForOperation(inFlight.get(cacheKey), signal);

    const controller = new AbortController();
    const operation = {
      controller,
      consumerCount: 0,
      pending: true,
      promise: null
    };
    const request = Promise.resolve()
      .then(() => listModels({ baseUrl: normalizedBaseUrl, apiKey: normalizedApiKey, signal: controller.signal }))
      .then(payload => {
        const models = normalizeModelRecords(payload);
        cache.set(cacheKey, { fetchedAt: now(), models });
        return { models: models.map(model => ({ ...model })), fromCache: false };
      });
    operation.promise = request.finally(() => {
      operation.pending = false;
      if (inFlight.get(cacheKey) === operation) inFlight.delete(cacheKey);
    });
    // A caller may leave a page while every consumer is waiting. Keep the
    // rejection observable to later callers without creating an unhandled
    // rejection from the shared operation itself.
    void operation.promise.catch(() => {});
    inFlight.set(cacheKey, operation);
    return waitForOperation(operation, signal);
  };

  return {
    load,
    clear() {
      cache.clear();
      inFlight.clear();
    }
  };
}
