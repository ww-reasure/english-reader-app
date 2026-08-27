import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

class MemoryCache {
  constructor() {
    this.rows = new Map();
  }

  async put(request, response) {
    const key = typeof request === 'string' ? request : request.url;
    this.rows.set(key, response.clone());
  }

  async match(request) {
    const key = typeof request === 'string' ? request : request.url;
    return this.rows.get(key)?.clone() || null;
  }
}

test('AudioCache 持久保存并可读取真人录音来源与许可', async () => {
  const server = await createServer({
    root: process.cwd(),
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false },
    appType: 'custom'
  });
  try {
    const { AudioCache } = await server.ssrLoadModule('/src/audio-cache.js');
    const cache = new MemoryCache();
    const candidates = [{
      word: 'pugnacious',
      url: 'https://upload.wikimedia.org/pugnacious.wav',
      source: 'wikimedia-commons',
      accent: 'other',
      phonetic: '',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:pugnacious.wav',
      licenseName: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      author: 'Speaker',
      attributionRequired: true,
      mimeType: 'audio/wav'
    }];

    await AudioCache.writeResolution(cache, 'pugnacious', candidates);
    const metadata = await AudioCache.getPronunciationMetadata('pugnacious', { cache });

    assert.deepEqual(metadata, candidates);
  } finally {
    await server.close();
  }
});

test('缓存中已有双源元数据时，词典录音失败仍继续播放 Wikimedia', async () => {
  const server = await createServer({
    root: process.cwd(),
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false },
    appType: 'custom'
  });
  try {
    const { AudioCache } = await server.ssrLoadModule('/src/audio-cache.js');
    const originals = {
      resolveCandidates: AudioCache.resolveCandidates,
      playCandidates: AudioCache.playCandidates
    };
    const calls = [];
    AudioCache.resolveCandidates = async () => [
      { word: 'year', source: 'free-dictionary', url: 'https://dictionary.example/year.mp3' },
      { word: 'year', source: 'wikimedia-commons', url: 'https://upload.wikimedia.org/year.wav' }
    ];
    AudioCache.playCandidates = async candidates => {
      calls.push(candidates.map(candidate => candidate.source));
      return candidates.length > 0 && candidates.every(candidate => candidate.source === 'wikimedia-commons');
    };

    try {
      assert.equal(await AudioCache.getAudio('year', { silent: true }), true);
      assert.deepEqual(calls, [['free-dictionary'], ['wikimedia-commons']]);
    } finally {
      AudioCache.resolveCandidates = originals.resolveCandidates;
      AudioCache.playCandidates = originals.playCandidates;
    }
  } finally {
    await server.close();
  }
});
