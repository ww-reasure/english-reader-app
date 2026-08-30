export const CHAT_IMAGE_LIMITS = Object.freeze({
  maxImagesPerMessage: 12,
  targetBytesPerImage: 4 * 1024 * 1024,
  inlineSingleImageBytes: 32 * 1024 * 1024,
  inlineRawTotalBytes: 32 * 1024 * 1024,
  inlineEstimatedJsonBytes: 44 * 1024 * 1024,
  localFullBlobBytes: 200 * 1024 * 1024,
  maxDimension: 8192,
  remoteExpirySeconds: 2592000
});

export const SUPPORTED_CHAT_IMAGE_MIME_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp'
]);

const protectedStatuses = new Set(['draft', 'processing', 'uploading']);
const numberOrMax = value => Number.isFinite(Number(value)) ? Number(value) : Number.MAX_SAFE_INTEGER;

export function validateImageBatch(images) {
  if (!Array.isArray(images)) return { ok: false, code: 'invalid_image_batch' };
  if (images.length > CHAT_IMAGE_LIMITS.maxImagesPerMessage) {
    return { ok: false, code: 'too_many_images', limit: CHAT_IMAGE_LIMITS.maxImagesPerMessage };
  }
  for (const image of images) {
    const mimeType = String(image?.mimeType || '').toLowerCase();
    if (!SUPPORTED_CHAT_IMAGE_MIME_TYPES.includes(mimeType)) {
      return { ok: false, code: 'unsupported_image_type', mimeType };
    }
    const sizeBytes = Number(image?.sizeBytes);
    if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
      return { ok: false, code: 'invalid_image_size' };
    }
    if (Number(image?.width) > CHAT_IMAGE_LIMITS.maxDimension || Number(image?.height) > CHAT_IMAGE_LIMITS.maxDimension) {
      return { ok: false, code: 'image_dimension_exceeded', limit: CHAT_IMAGE_LIMITS.maxDimension };
    }
  }
  return { ok: true };
}

export function canInlineImageBatch(images) {
  if (!Array.isArray(images)) return { ok: false, code: 'invalid_image_batch' };
  const sizes = images.map(image => Number(image?.sizeBytes));
  if (sizes.some(size => !Number.isFinite(size) || size < 0)) {
    return { ok: false, code: 'invalid_image_size' };
  }
  if (sizes.some(size => size > CHAT_IMAGE_LIMITS.inlineSingleImageBytes)) {
    return { ok: false, code: 'inline_single_image_too_large' };
  }
  const totalBytes = sizes.reduce((sum, size) => sum + size, 0);
  if (totalBytes > CHAT_IMAGE_LIMITS.inlineRawTotalBytes) {
    return { ok: false, code: 'inline_total_too_large', totalBytes };
  }
  const estimatedJsonBytes = sizes.reduce((sum, size) => sum + Math.ceil(size / 3) * 4, 64 * 1024);
  if (estimatedJsonBytes > CHAT_IMAGE_LIMITS.inlineEstimatedJsonBytes) {
    return { ok: false, code: 'inline_json_too_large', estimatedJsonBytes };
  }
  return { ok: true, totalBytes, estimatedJsonBytes };
}

export function selectCapacityEvictions(records, {
  currentBytes = 0,
  incomingBytes = 0,
  limitBytes = CHAT_IMAGE_LIMITS.localFullBlobBytes,
  protectedIds = []
} = {}) {
  const requiredBytes = Math.max(0, Number(currentBytes) + Number(incomingBytes) - Number(limitBytes));
  if (requiredBytes <= 0) return [];
  const protectedSet = new Set(protectedIds);
  const candidates = (Array.isArray(records) ? records : [])
    .filter(record => record && Number(record.sizeBytes) > 0)
    .filter(record => !record.protected && !protectedSet.has(record.id))
    .filter(record => !protectedStatuses.has(record.status));
  const tier = record => record.contextArchived ? 0 : record.detached ? 1 : 2;
  candidates.sort((a, b) => (
    tier(a) - tier(b)
    || numberOrMax(a.lastAccessedAt) - numberOrMax(b.lastAccessedAt)
    || numberOrMax(a.createdAt) - numberOrMax(b.createdAt)
    || String(a.id || '').localeCompare(String(b.id || ''))
  ));
  const selected = [];
  let releasedBytes = 0;
  for (const record of candidates) {
    selected.push(record);
    releasedBytes += Number(record.sizeBytes) || 0;
    if (releasedBytes >= requiredBytes) break;
  }
  return releasedBytes >= requiredBytes ? selected : [];
}

export function inferImageReference(text = '') {
  const value = String(text || '').trim();
  if (!value) return { kind: 'none', confidence: 0 };
  const explicitImageReference = /(?:刚才|这张|这组|图片|图里|照片|截图|拍下|第\s*[一二三四五六七八九十\d]+\s*张|image|photo|screenshot)/iu;
  if (explicitImageReference.test(value)) {
    return { kind: 'current', confidence: 1, reason: 'explicit_image_reference' };
  }
  return { kind: 'none', confidence: 0 };
}
