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

const createFixture = ({ now = 200, records = [], deleteFailure = false } = {}) => {
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
    async uploadVisionFile(blob, filename) {
      this.uploadCalls.push({ blob, filename });
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
    db, api, processor, policy, now: () => now,
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
