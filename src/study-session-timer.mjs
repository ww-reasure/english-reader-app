import { splitIntervalByLocalDay } from './learning-day.mjs';

const DEFAULT_CONTEXT = 'default';

export class StudySessionTimer {
  constructor({ sessionId, mode, now = () => Date.now(), idleMs = 30_000 } = {}) {
    if (!sessionId || !mode) throw new TypeError('学习计时器需要 sessionId 和 mode');
    this.sessionId = String(sessionId);
    this.mode = String(mode);
    this.now = typeof now === 'function' ? now : () => Date.now();
    this.idleMs = Math.max(1, Number(idleMs) || 30_000);
    this.contextKey = DEFAULT_CONTEXT;
    this.activeStartedAt = null;
    this.lastActivityAt = null;
    this.closedSlices = [];
    this.returnedSliceIds = new Set();
    this.sliceSequence = 0;
    this.paused = false;
    this.finished = false;
  }

  currentTime() {
    const value = Number(this.now());
    return Number.isFinite(value) ? value : Date.now();
  }

  start(context = {}) {
    if (this.finished || this.activeStartedAt !== null) return this;
    this.contextKey = String(context.contextKey || DEFAULT_CONTEXT);
    const startedAt = this.currentTime();
    this.activeStartedAt = startedAt;
    this.lastActivityAt = startedAt;
    this.paused = false;
    return this;
  }

  noteActivity() {
    if (this.finished || this.activeStartedAt === null || this.paused) return this;
    const current = this.currentTime();
    const idleCutoff = this.lastActivityAt + this.idleMs;
    if (current > idleCutoff) {
      this.closeActive('idle', idleCutoff);
      this.activeStartedAt = current;
    }
    this.lastActivityAt = current;
    return this;
  }

  closeActive(reason, endedAt = this.currentTime()) {
    if (this.activeStartedAt === null) return [];
    const cap = this.lastActivityAt + this.idleMs;
    const end = Math.max(this.activeStartedAt, Math.min(Number(endedAt), cap));
    const intervals = splitIntervalByLocalDay({ startedAt: this.activeStartedAt, endedAt: end });
    const slices = intervals.map(interval => ({
      id: `${this.sessionId}:${this.mode}:${++this.sliceSequence}`,
      sessionId: this.sessionId,
      mode: this.mode,
      contextKey: this.contextKey,
      startedAt: interval.startedAt,
      endedAt: interval.endedAt,
      durationMs: interval.durationMs,
      dayKey: interval.dayKey,
      reason
    }));
    this.closedSlices.push(...slices);
    return slices;
  }

  consumeNewSlices() {
    const slices = this.closedSlices.filter(slice => !this.returnedSliceIds.has(slice.id));
    slices.forEach(slice => this.returnedSliceIds.add(slice.id));
    return slices;
  }

  acknowledge(slices = []) {
    for (const slice of slices) {
      if (slice?.id) this.returnedSliceIds.add(slice.id);
    }
    return this;
  }

  pause(reason = 'paused') {
    if (this.finished || this.activeStartedAt === null) return [];
    const current = this.currentTime();
    this.closeActive(reason, current);
    this.activeStartedAt = null;
    this.lastActivityAt = null;
    this.paused = true;
    return this.consumeNewSlices();
  }

  switchContext(context = {}) {
    if (this.finished) return [];
    const previous = this.activeStartedAt === null ? [] : this.closeActive('context-switch', this.currentTime());
    const nextContextKey = String(context.contextKey || DEFAULT_CONTEXT);
    const startedAt = this.currentTime();
    this.contextKey = nextContextKey;
    this.activeStartedAt = startedAt;
    this.lastActivityAt = startedAt;
    this.paused = false;
    // Keep the closed slice pending so finish() can return the complete session
    // when callers only use the public switch operation as a state change.
    return previous;
  }

  getActiveDuration() {
    const closedDuration = this.closedSlices.reduce((total, slice) => total + slice.durationMs, 0);
    if (this.finished || this.activeStartedAt === null) return closedDuration;
    const current = this.currentTime();
    const end = Math.max(this.activeStartedAt, Math.min(current, this.lastActivityAt + this.idleMs));
    return closedDuration + Math.max(0, end - this.activeStartedAt);
  }

  finish(reason = 'completed') {
    if (this.finished) return [];
    if (this.activeStartedAt !== null) {
      const current = this.currentTime();
      const effectiveReason = current > this.lastActivityAt + this.idleMs ? 'idle' : reason;
      this.closeActive(effectiveReason, current);
    }
    this.activeStartedAt = null;
    this.lastActivityAt = null;
    this.paused = true;
    this.finished = true;
    return this.consumeNewSlices();
  }
}
