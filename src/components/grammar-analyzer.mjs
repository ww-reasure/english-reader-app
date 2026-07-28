import { createUnavailableGrammarAnalysis } from './grammar-analyzer-contract.mjs';

const DEFAULT_MANIFEST_URL = '/models/grammar-analyzer-manifest.json';
const DEFAULT_INITIALIZATION_TIMEOUT_MS = 20_000;
const DEFAULT_ANALYSIS_TIMEOUT_MS = 12_000;
const MAX_TIMEOUT_MS = 120_000;

export class GrammarAnalyzer {
  #workerFactory;
  #manifestUrl;
  #initializationTimeoutMs;
  #analysisTimeoutMs;
  #worker = null;
  #availability = null;
  #initializePromise = null;
  #pending = new Map();
  #nextRequestId = 1;
  #nextGeneration = 1;
  #disposed = false;

  constructor({
    workerFactory = defaultWorkerFactory,
    manifestUrl = DEFAULT_MANIFEST_URL,
    initializationTimeoutMs = DEFAULT_INITIALIZATION_TIMEOUT_MS,
    analysisTimeoutMs = DEFAULT_ANALYSIS_TIMEOUT_MS,
  } = {}) {
    this.#workerFactory = workerFactory;
    this.#manifestUrl = manifestUrl;
    this.#initializationTimeoutMs = normalizeTimeout(initializationTimeoutMs, DEFAULT_INITIALIZATION_TIMEOUT_MS);
    this.#analysisTimeoutMs = normalizeTimeout(analysisTimeoutMs, DEFAULT_ANALYSIS_TIMEOUT_MS);
  }

  async getAvailability() {
    return this.#initialize();
  }

  async analyze(text, { signal = null, timeoutMs = null } = {}) {
    throwIfAborted(signal);
    const availability = await awaitWithSignal(this.#initialize(), signal);
    throwIfAborted(signal);
    if (availability.status !== 'available') return availability;
    if (typeof text !== 'string' || !text.trim()) return createUnavailableGrammarAnalysis('EMPTY_TEXT');
    return this.#post('analyze', { text }, {
      signal,
      timeoutMs: normalizeTimeout(timeoutMs, this.#analysisTimeoutMs),
    });
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const requestId of [...this.#pending.keys()]) {
      this.#settlePending(requestId, pending => pending.reject(new Error('Grammar analyzer disposed')));
    }
    this.#terminateCurrentWorker();
  }

  #initialize() {
    if (this.#availability) return Promise.resolve(this.#availability);
    if (this.#initializePromise) return this.#initializePromise;
    if (this.#disposed) return Promise.resolve(createUnavailableGrammarAnalysis('ANALYZER_DISPOSED'));

    const worker = this.#startWorker();
    if (!worker) {
      this.#availability = createUnavailableGrammarAnalysis('WORKER_UNSUPPORTED');
      return Promise.resolve(this.#availability);
    }

    const generation = worker.generation;
    this.#initializePromise = this.#post('initialize', { manifestUrl: this.#manifestUrl }, {
      timeoutMs: this.#initializationTimeoutMs,
    })
      .then(availability => {
        if (this.#isCurrentGeneration(generation)) this.#availability = availability;
        return availability;
      })
      .catch(() => {
        const unavailable = createUnavailableGrammarAnalysis('WORKER_INITIALIZATION_FAILED');
        if (this.#isCurrentGeneration(generation)) this.#availability = unavailable;
        return unavailable;
      });
    return this.#initializePromise;
  }

  #startWorker() {
    let rawWorker;
    try {
      rawWorker = this.#workerFactory();
    } catch {
      return null;
    }
    if (!rawWorker) return null;

    const generation = this.#nextGeneration++;
    const worker = {
      rawWorker,
      generation,
      onMessage: event => this.#onMessage(generation, event),
      onError: () => this.#onError(generation),
    };
    rawWorker.addEventListener?.('message', worker.onMessage);
    rawWorker.addEventListener?.('error', worker.onError);
    this.#worker = worker;
    return worker;
  }

  #post(type, payload, { signal = null, timeoutMs = null } = {}) {
    const worker = this.#worker;
    if (!worker) return Promise.resolve(createUnavailableGrammarAnalysis('WORKER_UNSUPPORTED'));
    if (this.#disposed) return Promise.reject(new Error('Grammar analyzer disposed'));
    if (signal?.aborted) return Promise.reject(cancellationError(signal));

    const requestId = this.#nextRequestId++;
    return new Promise((resolve, reject) => {
      const pending = {
        type,
        generation: worker.generation,
        resolve,
        reject,
        signal,
        onAbort: null,
        timeoutId: null,
      };
      this.#pending.set(requestId, pending);
      if (signal?.addEventListener) {
        pending.onAbort = () => this.#abortPendingRequest(requestId, cancellationError(signal));
        signal.addEventListener('abort', pending.onAbort, { once: true });
      }
      if (signal?.aborted) {
        this.#abortPendingRequest(requestId, cancellationError(signal));
        return;
      }
      if (!this.#pending.has(requestId)) return;
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        pending.timeoutId = setTimeout(() => this.#timeoutPendingRequest(requestId), timeoutMs);
      }
      if (!this.#pending.has(requestId)) return;
      try {
        worker.rawWorker.postMessage({ type, requestId, ...payload });
      } catch (error) {
        this.#settlePending(requestId, item => item.reject(error));
      }
    });
  }

  #onMessage(generation, event) {
    const message = event?.data;
    const requestId = Number(message?.requestId);
    const pending = this.#pending.get(requestId);
    if (!pending || pending.generation !== generation) return;

    if (message.type === 'ready' && pending.type === 'initialize') {
      this.#settlePending(requestId, item => item.resolve(message.availability || createUnavailableGrammarAnalysis('INVALID_WORKER_RESPONSE')));
      return;
    }
    if (message.type === 'result' && pending.type === 'analyze') {
      this.#settlePending(requestId, item => item.resolve(message.result || createUnavailableGrammarAnalysis('INVALID_WORKER_RESPONSE')));
      return;
    }
    this.#settlePending(requestId, item => item.resolve(createUnavailableGrammarAnalysis('INVALID_WORKER_RESPONSE')));
  }

  #onError(generation) {
    if (!this.#isCurrentGeneration(generation)) return;
    const unavailable = createUnavailableGrammarAnalysis('WORKER_RUNTIME_FAILED');
    this.#availability = unavailable;
    for (const [requestId, pending] of [...this.#pending.entries()]) {
      if (pending.generation === generation) this.#settlePending(requestId, item => item.resolve(unavailable));
    }
    this.#terminateCurrentWorker();
  }

  #abortPendingRequest(requestId, error) {
    const pending = this.#pending.get(requestId);
    if (!pending) return;
    const generation = pending.generation;
    this.#settlePending(requestId, item => item.reject(error));
    if (pending.type === 'analyze') this.#restartWorker(generation, 'WORKER_RESTARTED');
  }

  #timeoutPendingRequest(requestId) {
    const pending = this.#pending.get(requestId);
    if (!pending) return;
    const generation = pending.generation;
    const reason = pending.type === 'initialize' ? 'WORKER_INITIALIZATION_TIMEOUT' : 'ANALYSIS_TIMEOUT';
    this.#settlePending(requestId, item => item.resolve(createUnavailableGrammarAnalysis(reason)));
    this.#restartWorker(generation, 'WORKER_RESTARTED');
  }

  #restartWorker(generation, reason) {
    if (!this.#isCurrentGeneration(generation)) return;
    const current = this.#worker;
    this.#worker = null;
    this.#availability = null;
    this.#initializePromise = null;
    this.#detachAndTerminate(current);
    for (const [requestId, pending] of [...this.#pending.entries()]) {
      if (pending.generation === generation) {
        this.#settlePending(requestId, item => item.resolve(createUnavailableGrammarAnalysis(reason)));
      }
    }
  }

  #terminateCurrentWorker() {
    const current = this.#worker;
    this.#worker = null;
    this.#detachAndTerminate(current);
  }

  #detachAndTerminate(worker) {
    if (!worker) return;
    worker.rawWorker.removeEventListener?.('message', worker.onMessage);
    worker.rawWorker.removeEventListener?.('error', worker.onError);
    worker.rawWorker.terminate?.();
  }

  #isCurrentGeneration(generation) {
    return this.#worker?.generation === generation;
  }

  #settlePending(requestId, settle) {
    const pending = this.#pending.get(requestId);
    if (!pending) return false;
    this.#pending.delete(requestId);
    if (pending.timeoutId) clearTimeout(pending.timeoutId);
    if (pending.signal?.removeEventListener && pending.onAbort) {
      pending.signal.removeEventListener('abort', pending.onAbort);
    }
    settle(pending);
    return true;
  }
}

function defaultWorkerFactory() {
  if (typeof Worker !== 'function') return null;
  return new Worker(new URL('../workers/grammar-analyzer.worker.mjs', import.meta.url), {
    type: 'module',
    name: 'grammar-analyzer'
  });
}

function normalizeTimeout(value, fallback) {
  const numeric = Number(value);
  const resolved = Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
  return Math.min(MAX_TIMEOUT_MS, Math.max(1, Math.round(resolved)));
}

function cancellationError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('请求已取消');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw cancellationError(signal);
}

function awaitWithSignal(promise, signal) {
  if (!signal?.addEventListener) return promise;
  if (signal.aborted) return Promise.reject(cancellationError(signal));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = callback => value => {
      if (settled) return;
      settled = true;
      signal.removeEventListener?.('abort', onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject)(cancellationError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(finish(resolve), finish(reject));
  });
}
