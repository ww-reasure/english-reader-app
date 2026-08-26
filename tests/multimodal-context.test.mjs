import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleChatMessages, messagesToVisionResponseItems } from '../src/components/multimodal-context.mjs';

test('replaces only the current user turn with text plus ordered file blocks', () => {
  const result = assembleChatMessages({
    messages: [
      { role: 'system', content: 'system' },
      { role: 'user', content: '讲解图片' }
    ],
    attachmentGroup: {
      prompt: '讲解图片',
      attachments: [
        { order: 1, remoteFileId: 'file-api-b' },
        { order: 0, remoteFileId: 'file-api-a' }
      ]
    }
  });
  assert.deepEqual(result.at(-1).content, [
    { type: 'text', text: '讲解图片' },
    { type: 'file', file_id: 'file-api-a' },
    { type: 'file', file_id: 'file-api-b' }
  ]);
});

test('Responses conversion preserves file IDs as input images', () => {
  assert.deepEqual(messagesToVisionResponseItems([{
    role: 'user',
    content: [{ type: 'text', text: 'read' }, { type: 'file', file_id: 'file-api-a' }]
  }])[0].content, [
    { type: 'input_text', text: 'read' },
    { type: 'input_image', file_id: 'file-api-a', detail: 'original' }
  ]);
});
