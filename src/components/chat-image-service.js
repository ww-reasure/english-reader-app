const REMOTE_REUSE_SAFETY_MS = 5 * 60 * 1000;
const RETRY_DELAYS_MS = [60 * 1000, 5 * 60 * 1000, 30 * 60 * 1000, 6 * 60 * 60 * 1000, 24 * 60 * 60 * 1000];
const SAFE_ERROR_CODES = new Set([
  'image_decode_failed',
  'image_encode_failed',
  'image_dimension_exceeded',
  'processed_image_too_large',
  'unsupported_image_type',
  'image_payload_unavailable',
  'image_upload_failed'
]);

const clip = (value, limit = 1600) => String(value || '').trim().slice(0, limit);

const defaultId = prefix => {
  const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
};

const serviceError = (code, message = code) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const safeErrorCode = error => SAFE_ERROR_CODES.has(error?.code) ? error.code : 'image_upload_failed';

const sortAttachments = rows => (Array.isArray(rows) ? rows.slice() : []).sort((a, b) => (
  (Number(a?.order) || 0) - (Number(b?.order) || 0)
  || String(a?.id || '').localeCompare(String(b?.id || ''))
));

const groupFor = (groupId, conversationKey, attachments) => ({
  groupId,
  conversationKey: conversationKey || attachments[0]?.conversationKey || 'home',
  attachments: sortAttachments(attachments)
});

async function blobToDataUrl(blob) {
  if (!blob || typeof blob.arrayBuffer !== 'function') return null;
  try {
    if (typeof globalThis.FileReader === 'function') {
      return await new Promise((resolve, reject) => {
        const reader = new globalThis.FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('file read failed'));
        reader.readAsDataURL(blob);
      });
    }
    if (typeof globalThis.btoa !== 'function') return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return `data:${blob.type || 'application/octet-stream'};base64,${globalThis.btoa(binary)}`;
  } catch {
    return null;
  }
}

export class ChatImageService {
  constructor({ db, api, processor, policy, now = () => Date.now(), createId = defaultId } = {}) {
    this.db = db;
    this.api = api;
    this.processor = processor;
    this.policy = policy || {};
    this.now = now;
    this.createId = createId;
  }

  async createDraft(files, { conversationKey = 'home', source = 'gallery' } = {}) {
    const inputFiles = Array.from(files || []);
    const maxImages = Number(this.policy.CHAT_IMAGE_LIMITS?.maxImagesPerMessage) || 12;
    if (!inputFiles.length) throw serviceError('invalid_image_batch');
    if (inputFiles.length > maxImages) throw serviceError('too_many_images');

    const groupId = this.createId('imggrp');
    const processed = [];
    const seenHashes = new Set();
    for (const file of inputFiles) {
      const result = await this.processor.process(file, {
        source,
        filename: file?.name || 'image.jpg'
      });
      if (result?.sha256 && seenHashes.has(result.sha256)) continue;
      if (result?.sha256) seenHashes.add(result.sha256);
      processed.push(result);
    }
    const validation = this.policy.validateImageBatch?.(processed.map(item => ({
      mimeType: item?.mimeType,
      sizeBytes: item?.sizeBytes,
      width: item?.width,
      height: item?.height
    })));
    if (validation && !validation.ok) throw serviceError(validation.code || 'invalid_image_batch');
    if (!processed.length) throw serviceError('invalid_image_batch');

    const now = this.now();
    const rows = processed.map((item, order) => ({
      id: this.createId('img'),
      groupId,
      conversationKey,
      messageId: null,
      order,
      status: 'draft',
      source,
      blob: item.blob || null,
      thumbnailBlob: item.thumbnailBlob || null,
      mimeType: item.mimeType || 'image/jpeg',
      filename: item.filename || `image-${String(order + 1).padStart(2, '0')}.jpg`,
      width: Number(item.width) || 0,
      height: Number(item.height) || 0,
      sizeBytes: Math.max(0, Number(item.sizeBytes) || Number(item.blob?.size) || 0),
      sha256: item.sha256 || null,
      remoteFileId: null,
      remoteExpiresAt: null,
      visualSummary: '',
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now
    }));
    await this.enforceCapacity({
      incomingBytes: rows.reduce((sum, row) => sum + row.sizeBytes, 0),
      protectedIds: rows.map(row => row.id)
    });
    for (const row of rows) await this.db.putChatImageAttachment(row);
    return groupFor(groupId, conversationKey, rows);
  }

  async restoreDraft(conversationKey = 'home') {
    const rows = await this.db.listChatImageAttachments({ conversationKey });
    const recoverable = rows.filter(row => ['draft', 'processing', 'uploading', 'ready'].includes(row?.status));
    if (!recoverable.length) return null;
    const groups = new Map();
    for (const row of recoverable) {
      if (!groups.has(row.groupId)) groups.set(row.groupId, []);
      groups.get(row.groupId).push(row);
    }
    const [groupId, attachments] = [...groups.entries()].sort((a, b) => (
      Math.max(...a[1].map(row => Number(row.updatedAt || row.createdAt || 0)))
      - Math.max(...b[1].map(row => Number(row.updatedAt || row.createdAt || 0)))
    )).at(-1);
    return groupFor(groupId, conversationKey, attachments);
  }

  async reorderDraft(groupId, orderedIds = []) {
    const rows = sortAttachments(await this.db.getChatImageGroup(groupId));
    const rank = new Map(orderedIds.map((id, index) => [id, index]));
    const ordered = rows.sort((a, b) => (
      (rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER)
      - (rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER)
      || (Number(a.order) || 0) - (Number(b.order) || 0)
    ));
    for (let index = 0; index < ordered.length; index += 1) {
      if (ordered[index].order !== index) await this.db.updateChatImageAttachment(ordered[index].id, { order: index, updatedAt: this.now() });
      ordered[index].order = index;
    }
    return groupFor(groupId, ordered[0]?.conversationKey, ordered);
  }

  async removeDraftImage(id) {
    const row = await this.db.getChatImageAttachment(id);
    if (!row) return null;
    if (row.remoteFileId) {
      try {
        await this.api.deleteVisionFile(row.remoteFileId);
        await this.db.deleteChatImageAttachment(id);
      } catch {
        await this.db.releaseChatImageAttachment(id, { remoteDeletePending: true });
        await this.db.updateChatImageAttachment(id, {
          retryCount: 1,
          nextRetryAt: this.now() + RETRY_DELAYS_MS[0],
          updatedAt: this.now()
        });
      }
    } else {
      await this.db.deleteChatImageAttachment(id);
    }
    return row;
  }

  remoteFileIsReusable(row, now = this.now()) {
    return Boolean(row?.remoteFileId)
      && Number(row.remoteExpiresAt) > now + REMOTE_REUSE_SAFETY_MS;
  }

  async prepareForSend(groupId, { signal = null } = {}) {
    const initial = sortAttachments(await this.db.getChatImageGroup(groupId));
    if (!initial.length) return groupFor(groupId, 'home', []);
    const canInline = this.policy.canInlineImageBatch?.(initial)?.ok === true;
    const prepared = [];
    for (const row of initial) {
      let current = row;
      let inlineDataUrl = null;
      if (this.remoteFileIsReusable(current)) {
        current = await this.db.updateChatImageAttachment(current.id, {
          status: 'ready',
          lastAccessedAt: this.now(),
          updatedAt: this.now(),
          lastError: null
        }) || current;
      } else if (current.blob) {
        await this.db.updateChatImageAttachment(current.id, {
          status: 'uploading',
          updatedAt: this.now(),
          lastError: null
        });
        try {
          const remote = await this.api.uploadVisionFile(current.blob, current.filename, { signal });
          if (!remote?.id) throw serviceError('image_upload_failed');
          current = await this.db.updateChatImageAttachment(current.id, {
            status: 'ready',
            remoteFileId: remote.id,
            remoteExpiresAt: this.now() + ((Number(this.policy.CHAT_IMAGE_LIMITS?.remoteExpirySeconds) || 2592000) * 1000),
            lastAccessedAt: this.now(),
            updatedAt: this.now(),
            lastError: null
          }) || { ...current, remoteFileId: remote.id, status: 'ready' };
        } catch (error) {
          if (canInline) inlineDataUrl = await blobToDataUrl(current.blob);
          const code = safeErrorCode(error);
          current = await this.db.updateChatImageAttachment(current.id, {
            status: 'ready',
            updatedAt: this.now(),
            lastError: code
          }) || { ...current, status: 'ready', lastError: code };
          if (!inlineDataUrl) throw serviceError(code);
        }
      } else {
        throw serviceError('image_payload_unavailable');
      }
      prepared.push(inlineDataUrl ? { ...current, inlineDataUrl } : current);
    }
    return groupFor(groupId, prepared[0]?.conversationKey, prepared);
  }

  async markSent(groupId, { messageId = null, visualSummary = '' } = {}) {
    const rows = sortAttachments(await this.db.getChatImageGroup(groupId));
    const now = this.now();
    for (const row of rows) {
      await this.db.updateChatImageAttachment(row.id, {
        status: 'sent',
        messageId,
        visualSummary: clip(visualSummary),
        updatedAt: now,
        lastAccessedAt: now,
        lastError: null
      });
    }
    return groupFor(groupId, rows[0]?.conversationKey, rows.map(row => ({
      ...row,
      status: 'sent',
      messageId,
      visualSummary: clip(visualSummary),
      updatedAt: now,
      lastAccessedAt: now
    })));
  }

  async resolveContext({ groupId, mode = 'auto', userMessage = '', signal = null } = {}) {
    if (!groupId) return { groupId: null, attachments: [], visualSummary: '' };
    const rows = sortAttachments(await this.db.getChatImageGroup(groupId));
    const visualSummary = clip(rows.find(row => row.visualSummary)?.visualSummary || '');
    const inferred = this.policy.inferImageReference?.(userMessage);
    const wantsImages = ['image', 'raw', 'full'].includes(mode)
      || (mode === 'auto' && inferred?.kind === 'current');
    if (!wantsImages) return { groupId, attachments: [], visualSummary };
    const prepared = await this.prepareForSend(groupId, { signal });
    return { ...prepared, visualSummary };
  }

  async detachGroup(groupId) {
    const rows = await this.db.getChatImageGroup(groupId);
    for (const row of rows) {
      await this.db.updateChatImageAttachment(row.id, { detached: true, updatedAt: this.now() });
    }
    return groupFor(groupId, rows[0]?.conversationKey, rows.map(row => ({ ...row, detached: true })));
  }

  async enforceCapacity({ incomingBytes = 0, protectedIds = [] } = {}) {
    const records = await this.db.listChatImageAttachments({});
    const currentBytes = this.db.getChatImageStorageBytes
      ? await this.db.getChatImageStorageBytes()
      : records.reduce((sum, row) => sum + Number(row.sizeBytes || 0), 0);
    const candidates = this.policy.selectCapacityEvictions?.(records, {
      currentBytes,
      incomingBytes,
      protectedIds,
      limitBytes: this.policy.CHAT_IMAGE_LIMITS?.localFullBlobBytes
    }) || [];
    for (const row of candidates) {
      await this.db.releaseChatImageAttachment(row.id);
    }
    return candidates.map(row => row.id);
  }

  async clearConversation(conversationKey = 'home') {
    const rows = await this.db.listChatImageAttachments({ conversationKey });
    for (const row of rows) {
      if (!row.remoteFileId) {
        await this.db.deleteChatImageAttachment(row.id);
        continue;
      }
      await this.db.releaseChatImageAttachment(row.id, { remoteDeletePending: true });
      try {
        await this.api.deleteVisionFile(row.remoteFileId);
        await this.db.deleteChatImageAttachment(row.id);
      } catch {
        const retryCount = Number(row.retryCount) || 0;
        await this.db.updateChatImageAttachment(row.id, {
          status: 'delete_pending',
          retryCount: retryCount + 1,
          nextRetryAt: this.now() + RETRY_DELAYS_MS[Math.min(retryCount, RETRY_DELAYS_MS.length - 1)],
          updatedAt: this.now(),
          lastError: 'remote_delete_failed'
        });
      }
    }
  }

  async retryRemoteDeletes({ limit = 20 } = {}) {
    const rows = await this.db.listChatImageAttachments({ statuses: ['delete_pending'] });
    let processed = 0;
    for (const row of rows) {
      if (processed >= limit) break;
      if (Number(row.nextRetryAt) > this.now()) continue;
      processed += 1;
      try {
        if (row.remoteFileId) await this.api.deleteVisionFile(row.remoteFileId);
        await this.db.deleteChatImageAttachment(row.id);
      } catch {
        const retryCount = Number(row.retryCount) || 0;
        await this.db.updateChatImageAttachment(row.id, {
          retryCount: retryCount + 1,
          nextRetryAt: this.now() + RETRY_DELAYS_MS[Math.min(retryCount, RETRY_DELAYS_MS.length - 1)],
          updatedAt: this.now(),
          lastError: 'remote_delete_failed'
        });
      }
    }
    return processed;
  }

  async collectOrphans(referencedAttachmentIds = []) {
    const referenced = new Set(referencedAttachmentIds || []);
    const rows = await this.db.listChatImageAttachments({});
    const orphans = rows.filter(row => !referenced.has(row.id) && !['draft', 'processing', 'uploading'].includes(row.status));
    for (const row of orphans) {
      if (row.remoteFileId) {
        try {
          await this.api.deleteVisionFile(row.remoteFileId);
          await this.db.deleteChatImageAttachment(row.id);
        } catch {
          await this.db.releaseChatImageAttachment(row.id, { remoteDeletePending: true });
        }
      } else {
        await this.db.deleteChatImageAttachment(row.id);
      }
    }
    return orphans.map(row => row.id);
  }
}
