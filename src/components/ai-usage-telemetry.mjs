const STORAGE_KEY = 'home_agent_usage_v1';
const MAX_ROWS = 50;
const finite = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

export function normalizeAIUsage(usage = {}) {
  return {
    inputTokens: finite(usage.prompt_tokens ?? usage.input_tokens),
    outputTokens: finite(usage.completion_tokens ?? usage.output_tokens),
    cacheHitTokens: finite(usage.prompt_cache_hit_tokens ?? usage.cached_tokens),
    cacheMissTokens: finite(usage.prompt_cache_miss_tokens)
  };
}

export function createAIUsageTelemetry({ storage = globalThis.localStorage, now = () => Date.now() } = {}) {
  const read = () => {
    try {
      const rows = JSON.parse(storage?.getItem(STORAGE_KEY));
      return Array.isArray(rows) ? rows.slice(-MAX_ROWS) : [];
    } catch { return []; }
  };
  return {
    record({ requestId = '', phase = 'initial', usage = {} } = {}) {
      const normalized = normalizeAIUsage(usage);
      const row = {
        requestId: String(requestId || '').slice(0, 80),
        phase: String(phase || 'initial').slice(0, 24),
        recordedAt: now(),
        ...normalized
      };
      const rows = [...read(), row].slice(-MAX_ROWS);
      try { storage?.setItem(STORAGE_KEY, JSON.stringify(rows)); } catch {}
      return row;
    },
    getRecent() { return read(); },
    aggregate() {
      return read().reduce((total, row) => ({
        requests: total.requests + 1,
        inputTokens: total.inputTokens + finite(row.inputTokens),
        outputTokens: total.outputTokens + finite(row.outputTokens),
        cacheHitTokens: total.cacheHitTokens + finite(row.cacheHitTokens),
        cacheMissTokens: total.cacheMissTokens + finite(row.cacheMissTokens)
      }), { requests: 0, inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 });
    }
  };
}

export const HomeAgentUsageTelemetry = createAIUsageTelemetry();
