import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const processorSource = await readFile(new URL('../src/components/chat-image-processor.js', import.meta.url), 'utf8');
const { createChatImageProcessor } = await import(
  `data:text/javascript;base64,${Buffer.from(processorSource).toString('base64')}`
);

test('re-encodes, hashes, thumbnails, and reports actual output metadata', async () => {
  const calls = [];
  const processor = createChatImageProcessor({
    decode: async file => ({ bitmap: { close() {} }, width: 4032, height: 3024, orientation: 6, file }),
    encode: async input => (calls.push(input), new Blob(['clean'], { type: 'image/jpeg' })),
    makeThumbnail: async () => new Blob(['thumb'], { type: 'image/jpeg' }),
    digestHex: async () => 'abc123'
  });

  const result = await processor.process(
    new Blob(['exif-and-pixels'], { type: 'image/jpeg' }),
    { source: 'camera', filename: 'photo.jpg' }
  );

  assert.equal(result.mimeType, 'image/jpeg');
  assert.equal(result.sha256, 'abc123');
  assert.equal(result.sizeBytes, 5);
  assert.equal(result.thumbnailBlob.size, 5);
  assert.equal(calls[0].stripMetadata, true);
  assert.equal(calls[0].orientation, 6);
});

test('GIF is handled as a static first frame with a visible warning', async () => {
  const processor = createChatImageProcessor({
    decode: async file => ({ bitmap: { close() {} }, width: 640, height: 480, orientation: 1, file }),
    encode: async () => new Blob(['still'], { type: 'image/jpeg' }),
    makeThumbnail: async () => new Blob(['thumb'], { type: 'image/jpeg' }),
    digestHex: async () => 'gif-hash'
  });

  const result = await processor.process(
    new Blob(['gif'], { type: 'image/gif' }),
    { filename: 'scan.gif' }
  );

  assert.equal(result.warning, 'animated_image_flattened');
  assert.equal(result.mimeType, 'image/jpeg');
});

test('unsupported files return a stable error code without leaking file details', async () => {
  const processor = createChatImageProcessor();

  await assert.rejects(
    processor.process(new Blob(['text'], { type: 'text/plain' }), { filename: 'private-secret.txt' }),
    error => {
      assert.equal(error.code, 'unsupported_image_type');
      assert.doesNotMatch(error.message, /private-secret|base64|exif/i);
      return true;
    }
  );
});

test('decoded dimensions over the hard cap fail before encoding', async () => {
  let encoded = false;
  const processor = createChatImageProcessor({
    decode: async () => ({ bitmap: { close() {} }, width: 8193, height: 100, orientation: 1 }),
    encode: async () => {
      encoded = true;
      return new Blob(['encoded'], { type: 'image/jpeg' });
    }
  });

  await assert.rejects(
    processor.process(new Blob(['pixels'], { type: 'image/jpeg' })),
    error => error.code === 'image_dimension_exceeded'
  );
  assert.equal(encoded, false);
});

test('image decode and encode failures use deterministic codes', async () => {
  const decodeFailure = createChatImageProcessor({
    decode: async () => { throw new Error('browser detail'); }
  });
  await assert.rejects(
    decodeFailure.process(new Blob(['pixels'], { type: 'image/jpeg' })),
    error => error.code === 'image_decode_failed'
  );

  const encodeFailure = createChatImageProcessor({
    decode: async () => ({ bitmap: { close() {} }, width: 640, height: 480, orientation: 1 }),
    encode: async () => { throw new Error('encoder detail'); }
  });
  await assert.rejects(
    encodeFailure.process(new Blob(['pixels'], { type: 'image/jpeg' })),
    error => error.code === 'image_encode_failed'
  );
});
