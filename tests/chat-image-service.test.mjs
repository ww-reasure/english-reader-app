import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as policy from '../src/components/chat-image-policy.mjs';

const serviceSource = await readFile(new URL('../src/components/chat-image-service.js', import.meta.url), 'utf8');
const { ChatImageService } = await import(
  `data:text/javascript;base64,${Buffer.from(serviceSource).toString('base64')}`
);

const file = name => {
  const value = new Blob([name], { type: 'image/jpeg' });
  Object.defineProperty(value, 'name', { value: `${name}.jpg` });
  return value;
};

const attachment = (overrides = {}) => ({
  id: 'img-1', groupId: 'group-1', conversationKey: 'home', order: 0,
  status: 'sent', source: 'gallery', blob: file('stored'), thumbnailBlob: file('thumb'),
  mimeType: 'image/jpeg', filename: 'stored.jpg', width: 800, height: 600,
  sizeBytes: 6, sha256: 'hash-1', remoteFileId: null, remoteExpiresAt: null,
  visualSummary: '一张英语阅读题', createdAt: 10, updatedAt: 10, lastAccessedAt: 10,
  ...overrides
});

const createFixture = ({ now = 200, records = [], deleteFailure = false, policyOverride = null, uploadImpl = null } = {}) => {
  const rows = records.map(row => ({ ...row }));
  const db = {
    records: rows,
    async putChatImageAttachment(row) {
      const index = rows.findIndex(item => item.id === row.id);
      if (index >= 0) rows[index] = { ...row }; else rows.push({ ...row });
      return row;
    },
    async getChatImageAttachment(id) { return rows.find(row => row.id === id) || null; },
    async getChatImageGroup(groupId) {
      return rows.filter(row => row.groupId === groupId).sort((a, b) => a.order - b.order);
    },
    async listChatImageAttachments({ conversationKey } = {}) {
      return rows.filter(row => !conversationKey || row.conversationKey === conversationKey);
    },
    async updateChatImageAttachment(id, fields) {
      const row = rows.find(item => item.id === id);
      if (!row) return null;
      Object.assign(row, fields);
      return row;
    },
    async releaseChatImageAttachment(id, { remoteDeletePending = false } = {}) {
      const row = rows.find(item => item.id === id);
      if (!row) return null;
      Object.assign(row, {
        blob: null,
        sizeBytes: 0,
        status: remoteDeletePending ? 'delete_pending' : 'released'
      });
      return row;
    },
    async deleteChatImageAttachment(id) {
      const index = rows.findIndex(row => row.id === id);
      if (index >= 0) rows.splice(index, 1);
    },
    async getChatImageStorageBytes() {
      return rows.reduce((sum, row) => sum + Number(row.sizeBytes || 0), 0);
    }
  };
  let uploadIndex = 0;
  const api = {
    uploadCalls: [],
    deleteCalls: [],
    async uploadVisionFile(blob, filename, options) {
      this.uploadCalls.push({ blob, filename });
      if (uploadImpl) return uploadImpl(blob, filename, options);
      uploadIndex += 1;
      return { id: uploadIndex === 1 && records.length ? 'file-api-new' : `file-api-${uploadIndex}` };
    },
    async deleteVisionFile(fileId) {
      this.deleteCalls.push(fileId);
      if (deleteFailure) throw new Error('offline');
      return { deleted: true };
    }
  };
  let idIndex = 0;
  const processor = {
    async process(blob, { filename, source }) {
      idIndex += 1;
      return {
        blob, thumbnailBlob: blob, filename, source, mimeType: 'image/jpeg',
        width: 800, height: 600, sizeBytes: blob.size, sha256: `hash-${idIndex}`
      };
    }
  };
  const service = new ChatImageService({
    db, api, processor, policy: policyOverride || policy, now: () => now,
    createId: prefix => `${prefix}-${++idIndex}`
  });
  return { service, db, api };
};

test('creates a recoverable ordered draft and uploads each image once', async () => {
  const { service, db, api } = createFixture();
  const group = await service.createDraft([file('a'), file('b')], { conversationKey: 'home', source: 'gallery' });
  assert.equal(group.attachments.length, 2);
  const ready = await service.prepareForSend(group.groupId);
  assert.deepEqual(ready.attachments.map(row => row.remoteFileId), ['file-api-1', 'file-api-2']);
  assert.equal(api.uploadCalls.length, 2);
  assert.equal((await service.restoreDraft('home')).groupId, group.groupId);
  assert.equal(db.records.every(row => row.blob instanceof Blob), true);
});

test('expired file IDs are re-uploaded from the local blob', async () => {
  const { service, api } = createFixture({ now: 200, records: [attachment({ remoteFileId: 'file-api-old', remoteExpiresAt: 100 })] });
  const group = await service.prepareForSend('group-1');
  assert.equal(group.attachments[0].remoteFileId, 'file-api-new');
  assert.equal(api.uploadCalls.length, 1);
});

test('ordinary follow-up can use summary without uploading or attaching raw images', async () => {
  const { service, api } = createFixture({ records: [attachment({ status: 'sent' })] });
  const result = await service.resolveContext({ groupId: 'group-1', mode: 'summary' });
  assert.equal(result.attachments.length, 0);
  assert.match(result.visualSummary, /英语阅读题/);
  assert.equal(api.uploadCalls.length, 0);
});

test('clear context deletes local content immediately and queues failed remote deletion', async () => {
  const { service, db } = createFixture({ deleteFailure: true, records: [attachment({ remoteFileId: 'file-api-1' })] });
  await service.clearConversation('home');
  const row = db.records[0];
  assert.equal(row.blob, null);
  assert.equal(row.status, 'delete_pending');
});

test('draft creation refuses to exceed the hard local image budget when protected data cannot be evicted', async () => {
  const limitedPolicy = {
    ...policy,
    CHAT_IMAGE_LIMITS: { ...policy.CHAT_IMAGE_LIMITS, localFullBlobBytes: 10 }
  };
  const protectedRow = attachment({
    id: 'active',
    groupId: 'active-group',
    status: 'uploading',
    sizeBytes: 9
  });
  const { service, db } = createFixture({ records: [protectedRow], policyOverride: limitedPolicy });

  await assert.rejects(
    () => service.createDraft([file('ab')]),
    error => error?.code === 'image_storage_capacity_exceeded'
  );
  assert.deepEqual(db.records.map(row => row.id), ['active']);
});

test('orphan collection preserves a restored ready draft until the view reconciles it', async () => {
  const ready = attachment({ status: 'ready', remoteFileId: 'file-api-ready' });
  const { service, db, api } = createFixture({ records: [ready] });

  const removed = await service.collectOrphans([], { protectedAttachmentIds: [ready.id] });

  assert.deepEqual(removed, []);
  assert.equal(db.records[0]?.id, ready.id);
  assert.deepEqual(api.deleteCalls, []);
});

test('an archived history group can be reactivated and protected without re-uploading it', async () => {
  const archived = attachment({ detached: true, remoteFileId: 'file-api-1', remoteExpiresAt: 10_000 });
  const { service, db, api } = createFixture({ records: [archived] });

  const group = await service.attachGroup(archived.groupId);

  assert.equal(group.attachments[0].detached, false);
  assert.equal(group.attachments[0].protected, true);
  assert.equal(db.records[0].detached, false);
  assert.equal(db.records[0].protected, true);
  assert.equal(api.uploadCalls.length, 0);

  await service.detachGroup(archived.groupId);
  assert.equal(db.records[0].detached, true);
  assert.equal(db.records[0].protected, false);
});

test('aborting an upload cancels the image request instead of falling back inline', async () => {
  const { service } = createFixture({
    uploadImpl: (_blob, _filename, { signal }) => new Promise((_resolve, reject) => {
      const rejectAbort = () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      };
      if (signal.aborted) rejectAbort();
      else signal.addEventListener('abort', rejectAbort, { once: true });
    })
  });
  const draft = await service.createDraft([file('cancel-me')]);
  const controller = new AbortController();
  const pending = service.prepareForSend(draft.groupId, { signal: controller.signal });

  controller.abort();

  await assert.rejects(pending, error => error?.name === 'AbortError');
});

test('replacing a draft deletes its uploaded remote files before removing local rows', async () => {
  const uploaded = attachment({ status: 'ready', remoteFileId: 'file-api-old' });
  const { service, db, api } = createFixture({ records: [uploaded] });

  await service.deleteGroup(uploaded.groupId);

  assert.deepEqual(api.deleteCalls, ['file-api-old']);
  assert.deepEqual(db.records, []);
});
