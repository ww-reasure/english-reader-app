import assert from 'node:assert/strict';
import test from 'node:test';
import { installPrivateExamPacks } from '../src/exam/private-pack-loader.mjs';

test('continues loading private packs when one pack installation fails', async () => {
  const responses = new Map([
    ['/exam-packs/private/index.json', { ok: true, json: async () => ({ packs: [
      { packageId: 'broken', path: '/packs/broken.json' },
      { packageId: 'ready', path: '/packs/ready.json' }
    ] }) }],
    ['/packs/broken.json', { ok: true, json: async () => ({ manifest: { packageId: 'broken' } }) }],
    ['/packs/ready.json', { ok: true, json: async () => ({ manifest: { packageId: 'ready' } }) }]
  ]);
  const result = await installPrivateExamPacks({
    fetchImpl: async path => responses.get(path),
    installPack: async (_openDb, pack) => {
      if (pack.manifest.packageId === 'broken') throw new Error('旧数据升级失败');
      return { status: 'installed', packageId: 'ready' };
    },
    openDb: async () => ({})
  });

  assert.deepEqual(result.installed, [{ status: 'installed', packageId: 'ready' }]);
  assert.deepEqual(result.failures, [{ packageId: 'broken', reason: '旧数据升级失败' }]);
});

test('returns a recoverable failure when the private pack index cannot be loaded', async () => {
  const result = await installPrivateExamPacks({
    fetchImpl: async () => {
      throw new Error('题包索引读取失败');
    },
    openDb: async () => ({})
  });

  assert.deepEqual(result, {
    installed: [],
    failures: [{ packageId: 'index', reason: '题包索引读取失败' }]
  });
});
