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

  if (failed > 0) {
    return {
      state: 'failed',
      pending,
      failed,
      running,
      message: `还有 ${pending} 条复习记录待同步`,
      retryable: true
    };
  }

  if (pending > 0 || running) {
    return {
      state: 'saving',
      pending,
      failed,
      running,
      message: `正在保存 ${pending} 条复习记录…`,
      retryable: false
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
