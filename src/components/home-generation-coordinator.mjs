const DEFAULT_KEY = 'home_generation_job_v1';
const RETRYABLE_STATUSES = new Set(['running', 'interrupted']);

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const nowMs = () => Date.now();
const jobId = () => globalThis.crypto?.randomUUID?.() || `generation-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const safeError = error => String(error?.message || error || '生成中断').replace(/\s+/g, ' ').trim().slice(0, 180);

export function createHomeGenerationStore({ storage = globalThis.localStorage, key = DEFAULT_KEY } = {}) {
  return {
    load() {
      try {
        const raw = storage?.getItem?.(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    save(job) {
      try { storage?.setItem?.(key, JSON.stringify(job)); } catch {}
    },
    clear() {
      try { storage?.removeItem?.(key); } catch {}
    }
  };
}

export class HomeGenerationCoordinator {
  constructor({ store = createHomeGenerationStore(), execute, now = nowMs, onStateChange = () => {}, onPreview = () => {} } = {}) {
    if (typeof execute !== 'function') throw new TypeError('HomeGenerationCoordinator requires an execute function');
    this.store = store;
    this.execute = execute;
    this.now = now;
    this.onStateChange = onStateChange;
    this.onPreview = onPreview;
    this.visibility = 'visible';
    this.active = null;
    this.previews = new Map();
  }

  getJob() {
    return clone(this.store.load());
  }

  getPreview(jobId, batchIndex = 0) {
    return clone(this.previews.get(`${String(jobId)}:${Number(batchIndex) || 0}`) || null);
  }

  clearPreview(jobId, batchIndex = null) {
    const prefix = `${String(jobId)}:`;
    const keys = batchIndex == null
      ? [...this.previews.keys()].filter(key => key.startsWith(prefix))
      : [`${prefix}${Number(batchIndex) || 0}`];
    for (const key of keys) {
      if (!this.previews.has(key)) continue;
      this.previews.delete(key);
      const [, index] = key.split(':');
      this.onPreview({ jobId: String(jobId), batchIndex: Number(index) || 0, preview: null });
    }
  }

  detach() {
    // View unmounts are deliberately not a cancellation boundary.
  }

  start(spec = {}) {
    const previous = this.getJob();
    if (this.active && previous?.id === spec.id) return this.active.promise;
    const job = {
      id: String(spec.id || jobId()),
      kind: String(spec.kind || 'direct'),
      payload: clone(spec.payload || {}),
      status: 'running',
      retryCount: 0,
      articleIds: Array.isArray(spec.articleIds) ? [...new Set(spec.articleIds)] : [],
      createdAt: Number(spec.createdAt) || this.now(),
      updatedAt: this.now(),
      phase: String(spec.phase || 'drafting'),
      hidden: this.visibility === 'hidden'
    };
    this._save(job);
    return this._run(job);
  }

  setVisibility(visibility) {
    this.visibility = visibility === 'hidden' ? 'hidden' : 'visible';
    const job = this.getJob();
    if (!job || ['completed', 'failed', 'cancelled'].includes(job.status)) return Promise.resolve(job);
    if (this.visibility === 'hidden') {
      this._save({ ...job, hidden: true });
      return Promise.resolve(this.getJob());
    }
    if (this.active) return this.active.promise;
    return this.resumePending();
  }

  resumePending() {
    const job = this.getJob();
    if (!job || !RETRYABLE_STATUSES.has(job.status)) return Promise.resolve(job);
    if (this.active) return this.active.promise;
    if (Number(job.retryCount) >= 1) {
      return Promise.resolve(this._save({ ...job, status: 'failed', hidden: false, error: job.error || '生成中断，可继续生成' }));
    }
    const resumed = {
      ...job,
      status: 'running',
      hidden: false,
      retryCount: Number(job.retryCount || 0) + 1,
      updatedAt: this.now(),
      phase: 'drafting'
    };
    this._save(resumed);
    return this._run(resumed);
  }

  cancel(reason = 'cancelled') {
    const job = this.getJob();
    if (!job || ['completed', 'failed', 'cancelled'].includes(job.status)) return job;
    const cancelled = this._save({
      ...job,
      status: 'cancelled',
      cancelReason: String(reason),
      hidden: false
    });
    this.active?.controller.abort();
    this.clearPreview(job.id);
    return cancelled;
  }

  _save(job) {
    const next = {
      ...clone(job),
      updatedAt: this.now()
    };
    this.store.save(next);
    this.onStateChange(clone(next));
    return next;
  }

  _isCurrent(jobIdValue, controller) {
    return this.active?.jobId === jobIdValue && this.active?.controller === controller && !controller.signal.aborted;
  }

  _run(initialJob) {
    const controller = new AbortController();
    const jobIdValue = initialJob.id;
    const active = { jobId: jobIdValue, controller, promise: null };
    this.active = active;
    const run = (async () => {
      try {
        const result = await this.execute(clone(initialJob), {
          signal: controller.signal,
          isCurrent: () => this._isCurrent(jobIdValue, controller),
          updateProgress: phase => {
            if (!this._isCurrent(jobIdValue, controller)) return;
            const latest = this.getJob();
            if (latest?.id === jobIdValue) this._save({ ...latest, phase: String(phase || latest.phase || 'drafting') });
          },
          updateJob: fields => {
            if (!this._isCurrent(jobIdValue, controller) || !fields || typeof fields !== 'object') return this.getJob();
            const latest = this.getJob();
            if (latest?.id !== jobIdValue) return latest;
            const next = { ...latest };
            if (fields.phase) next.phase = String(fields.phase);
            if (Array.isArray(fields.articleIds)) next.articleIds = [...new Set(fields.articleIds)];
            if (Array.isArray(fields.completedBatches)) next.completedBatches = [...new Set(fields.completedBatches.map(Number).filter(Number.isInteger))];
            if (Array.isArray(fields.failedBatches)) next.failedBatches = [...new Set(fields.failedBatches.map(Number).filter(Number.isInteger))];
            if (Array.isArray(fields.publishedArticleIds)) next.publishedArticleIds = [...new Set(fields.publishedArticleIds)];
            if (typeof fields.activityRecorded === 'boolean') next.activityRecorded = fields.activityRecorded;
            if (fields.failureId) next.failureId = String(fields.failureId);
            return this._save(next);
          },
          updatePreview: (preview = {}) => {
            if (!this._isCurrent(jobIdValue, controller) || !preview || typeof preview !== 'object') return;
            const batchIndex = Number.isInteger(Number(preview.batchIndex)) ? Number(preview.batchIndex) : 0;
            const key = `${jobIdValue}:${batchIndex}`;
            const nextPreview = {
              jobId: jobIdValue,
              batchIndex,
              title: String(preview.title || '').slice(0, 240),
              titleZh: String(preview.titleZh || '').slice(0, 240),
              content: String(preview.content || '').slice(0, 12000),
              translation: String(preview.translation || '').slice(0, 12000),
              wordCount: Number(preview.wordCount) || 0,
              attempt: Number(preview.attempt) || 1,
              updatedAt: this.now()
            };
            this.previews.set(key, nextPreview);
            this.onPreview(clone(nextPreview));
          },
          clearPreview: batchIndex => {
            if (!this._isCurrent(jobIdValue, controller)) return;
            this.clearPreview(jobIdValue, batchIndex);
          }
        });
        const latest = this.getJob();
        if (!this._isCurrent(jobIdValue, controller) || latest?.status === 'cancelled') return latest;
        const completed = this._save({
          ...latest,
          status: 'completed',
          hidden: false,
          error: '',
          articleIds: [...new Set([...(latest?.articleIds || []), ...(Array.isArray(result?.articleIds) ? result.articleIds : [])])]
        });
        this.clearPreview(jobIdValue);
        return completed;
      } catch (error) {
        const latest = this.getJob();
        if (latest?.status === 'cancelled' || controller.signal.aborted) {
          this.clearPreview(jobIdValue);
          return latest;
        }
        if (!this._isCurrent(jobIdValue, controller)) return latest;
        if (this.visibility === 'hidden' || latest?.hidden) {
          const interrupted = this._save({ ...latest, status: 'interrupted', hidden: true, error: safeError(error) });
          this.clearPreview(jobIdValue);
          return interrupted;
        }
        const failed = this._save({ ...latest, status: 'failed', hidden: false, error: safeError(error) });
        this.clearPreview(jobIdValue);
        return failed;
      } finally {
        if (this.active?.jobId === jobIdValue && this.active?.controller === controller) this.active = null;
      }
    })();
    active.promise = run;
    return run;
  }
}
