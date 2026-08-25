import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHAT_IMAGE_LIMITS,
  validateImageBatch,
  canInlineImageBatch,
  selectCapacityEvictions,
  inferImageReference
} from '../src/components/chat-image-policy.mjs';

test('accepts twelve supported images and rejects the thirteenth', () => {
  const twelve = Array.from({ length: 12 }, (_, index) => ({ id: String(index), mimeType: 'image/jpeg', sizeBytes: 1000 }));
  assert.equal(validateImageBatch(twelve).ok, true);
  assert.equal(validateImageBatch([...twelve, { id: '13', mimeType: 'image/png', sizeBytes: 1000 }]).code, 'too_many_images');
});

test('inline fallback is bounded below DeepSeek request limits', () => {
  assert.equal(canInlineImageBatch([{ sizeBytes: 30 * 1024 * 1024 }]).ok, true);
  assert.equal(canInlineImageBatch([
    { sizeBytes: 17 * 1024 * 1024 },
    { sizeBytes: 16 * 1024 * 1024 }
  ]).code, 'inline_total_too_large');
  assert.equal(CHAT_IMAGE_LIMITS.inlineRawTotalBytes, 32 * 1024 * 1024);
});

test('capacity pruning never evicts protected attachments', () => {
  const records = [
    { id: 'active', sizeBytes: 80, protected: true, contextArchived: false, lastAccessedAt: 1 },
    { id: 'archived-old', sizeBytes: 70, protected: false, contextArchived: true, lastAccessedAt: 2 },
    { id: 'detached', sizeBytes: 60, protected: false, contextArchived: false, detached: true, lastAccessedAt: 3 }
  ];
  assert.deepEqual(selectCapacityEvictions(records, { currentBytes: 210, incomingBytes: 30, limitBytes: 200 }).map(row => row.id), ['archived-old']);
});

test('ordinary new topics do not reactivate raw images', () => {
  assert.equal(inferImageReference('帮我生成一篇四级阅读').kind, 'none');
  assert.equal(inferImageReference('继续讲刚才第二张图里的第三题').kind, 'current');
});
