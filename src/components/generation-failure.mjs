const DIFFICULTIES = new Set(['cet4', 'cet6', 'graduate']);
const CHALLENGES = new Set(['support', 'standard', 'stretch']);
const MAX_MESSAGE_LENGTH = 900;

const clip = (value, limit) => String(value || '').trim().slice(0, limit);
const isTimeout = error => /超时|timeout|timed out/i.test(String(error?.message || ''));

export const isValidationFailure = error => error?.code === 'ARTICLE_VALIDATION_FAILED';
export const isCancelledGenerationRequest = error => error?.name === 'AbortError' || /请求已取消/.test(String(error?.message || ''));

const failureReason = error => {
  if (isValidationFailure(error)) return 'validation_failed';
  if (isTimeout(error)) return 'timeout';
  return 'generation_failed';
};

const normalizeGeneration = generation => {
  if (!generation || typeof generation !== 'object') return null;
  const request = clip(generation.request, 1200);
  const difficulty = clip(generation.difficulty, 32).toLowerCase();
  const challenge = clip(generation.challenge, 32).toLowerCase();
  const wordCount = Number(generation.wordCount);
  if (!request || !DIFFICULTIES.has(difficulty) || !CHALLENGES.has(challenge) || !Number.isInteger(wordCount) || wordCount <= 0) return null;
  return { request, difficulty, challenge, wordCount };
};

const normalizedReason = failure => {
  const reason = clip(failure?.reason, 48);
  if (reason === 'validation_failed' || reason === 'timeout' || reason === 'tool_error' || reason === 'generation_failed') return reason;
  return isValidationFailure(failure) ? 'validation_failed' : 'generation_failed';
};

export const safeGenerationFailureMessage = error => {
  if (isValidationFailure(error)) {
    return clip(error.summary || '文章未通过难度校验，请重新生成。', MAX_MESSAGE_LENGTH) || '文章未通过难度校验，请重新生成。';
  }
  if (isTimeout(error)) return '文章生成超时，请检查网络后重新生成。';
  return '文章定制暂时失败，请重新生成。';
};

export function createGenerationFailure(error, generation, topic) {
  return {
    message: safeGenerationFailureMessage(error),
    reason: failureReason(error),
    generation: normalizeGeneration(generation),
    topic: clip(topic || 'general', 80) || 'general'
  };
}

export function normalizeGenerationFailure(failure, fallbackGeneration, fallbackTopic = 'general') {
  const source = failure && typeof failure === 'object' ? failure : {};
  const reason = normalizedReason(source);
  const generation = normalizeGeneration(source.generation) || normalizeGeneration(fallbackGeneration);
  const topic = clip(source.topic || fallbackTopic || 'general', 80) || 'general';
  const validationMessage = clip(source.message, MAX_MESSAGE_LENGTH);
  const message = reason === 'validation_failed' && validationMessage
    ? validationMessage
    : reason === 'timeout'
      ? '文章生成超时，请检查网络后重新生成。'
      : '文章定制暂时失败，请重新生成。';

  return { message, reason, generation, topic };
}
