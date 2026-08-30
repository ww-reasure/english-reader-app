/**
 * Small, pure presentation model for the formal-review save indicator.
 *
 * The persistence coordinator keeps failed rows in the journal, so `pending`
 * is the number of rating records which are not yet fully settled.  Keeping
 * this interpretation in one place prevents the result pages from inventing
 * their own saved/queued semantics.
 */
export function summarizeReviewPersistenceStatus(status = {}) {
  const rating = status?.rating || status || {};
  const number = value => Math.max(0, Math.trunc(Number(value) || 0));
  const pending = number(rating.pending ?? rating.queued);
  const failed = number(rating.failed);
  const running = Boolean(rating.running);
  const nextRetryAt = number(rating.nextRetryAt);
  const errorCodes = Array.isArray(rating.errorCodes)
    ? [...new Set(rating.errorCodes.map(value => String(value || '').trim()).filter(Boolean))]
    : [];
  const diagnostics = errorCodes.length ? { errorCodes } : {};

  if (failed > 0) {
    return {
      state: 'failed',
      pending,
      failed,
      running,
      message: `还有 ${pending} 条复习记录待同步`,
      retryable: true,
      ...diagnostics
    };
  }

  // A completion notification is emitted just after the last durable write.
  // During that tiny hand-off an older subscriber can still observe
  // `running: true`, but zero pending records are already fully saved.
  if (pending > 0) {
    return {
      state: 'saving',
      pending,
      failed,
      running,
      message: !running && nextRetryAt > 0
        ? `已安全保存到本机，后台处理中（${pending}）`
        : `正在保存 ${pending} 条复习记录…`,
      retryable: false,
      ...diagnostics
    };
  }

  return {
    state: 'saved',
    pending: 0,
    failed: 0,
    running: false,
    message: '复习记录已全部保存',
    retryable: false
  };
}
