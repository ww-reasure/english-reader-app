import assert from 'node:assert/strict';
import test from 'node:test';

async function loadResolver() {
  try {
    return await import('../src/pronunciation-resolver.mjs');
  } catch (error) {
    assert.fail(`真人发音解析器应可加载：${error.message}`);
  }
}

function jsonResponse(payload, { ok = true } = {}) {
  return {
    ok,
    async json() { return payload; }
  };
}

test('Free Dictionary 使用接口返回的真实录音地址并保留授权信息', async () => {
  const { resolveFreeDictionaryPronunciations } = await loadResolver();
  const calls = [];
  const candidates = await resolveFreeDictionaryPronunciations({
    word: 'inevitable',
    preferredAccent: 'uk',
    fetchFn: async url => {
      calls.push(url);
      return jsonResponse([{
        word: 'inevitable',
        phonetics: [
          {
            text: '/ɪnˈevɪtəbəl/',
            audio: 'https://cdn.example.test/inevitable-us.mp3',
            sourceUrl: 'https://commons.wikimedia.org/wiki/File:inevitable-us.ogg',
            license: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' }
          },
          {
            text: '/ɪnˈevɪtəbəl/',
            audio: '//cdn.example.test/inevitable-uk.mp3'
          }
        ]
      }]);
    }
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/api\/v2\/entries\/en\/inevitable$/u);
  assert.deepEqual(candidates.map(item => item.url), [
    'https://cdn.example.test/inevitable-uk.mp3',
    'https://cdn.example.test/inevitable-us.mp3'
  ]);
  assert.equal(candidates[1].source, 'free-dictionary');
  assert.equal(candidates[1].sourceUrl, 'https://commons.wikimedia.org/wiki/File:inevitable-us.ogg');
  assert.equal(candidates[1].licenseName, 'CC BY 4.0');
});

test('Free Dictionary 不接受其他词条建议或非 HTTPS 音频', async () => {
  const { resolveFreeDictionaryPronunciations } = await loadResolver();
  const candidates = await resolveFreeDictionaryPronunciations({
    word: 'engineers',
    fetchFn: async () => jsonResponse([
      { word: 'engineer', phonetics: [{ audio: 'https://cdn.example.test/engineer.mp3' }] },
      { word: 'engineers', phonetics: [{ audio: 'http://insecure.example.test/engineers.mp3' }] }
    ])
  });

  assert.deepEqual(candidates, []);
});

test('有词典真人录音时不请求 Wikimedia', async () => {
  const { createPronunciationResolver } = await loadResolver();
  const calls = [];
  const resolver = createPronunciationResolver({
    fetchFn: async url => {
      calls.push(url);
      if (url.includes('dictionaryapi.dev/api/')) {
        return jsonResponse([{ word: 'year', phonetics: [{ audio: 'https://cdn.example.test/year-uk.mp3' }] }]);
      }
      throw new Error('不应请求 Wikimedia');
    }
  });

  const candidates = await resolver.resolve('year');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].source, 'free-dictionary');
  assert.equal(calls.length, 1);
});

test('词典无录音时回退到 Wikimedia 且只接受精确词形', async () => {
  const { createPronunciationResolver } = await loadResolver();
  const calls = [];
  const resolver = createPronunciationResolver({
    fetchFn: async url => {
      calls.push(url);
      if (url.includes('dictionaryapi.dev/api/')) return jsonResponse([{ word: 'pugnacious', phonetics: [] }]);
      return jsonResponse({
        query: {
          pages: [
            {
              title: 'File:LL-Q1860 (eng)-Speaker-pugnacious.wav',
              imageinfo: [{
                url: 'https://upload.wikimedia.org/pugnacious.wav',
                mime: 'audio/wav',
                extmetadata: {
                  LicenseShortName: { value: 'CC0' },
                  LicenseUrl: { value: 'https://creativecommons.org/publicdomain/zero/1.0/' },
                  Artist: { value: '<a href="/wiki/User:Speaker">Speaker</a>' },
                  AttributionRequired: { value: 'false' }
                }
              }]
            },
            {
              title: 'File:LL-Q1860 (eng)-Speaker-pugnacity.wav',
              imageinfo: [{ url: 'https://upload.wikimedia.org/pugnacity.wav', mime: 'audio/wav' }]
            }
          ]
        }
      });
    }
  });

  const candidates = await resolver.resolve('pugnacious');
  assert.equal(calls.length, 2);
  assert.match(calls[1], /^https:\/\/commons\.wikimedia\.org\/w\/api\.php\?/u);
  assert.equal(
    new URL(calls[1]).searchParams.get('gsrsearch'),
    'intitle:pugnacious incategory:"Lingua Libre pronunciation-eng"'
  );
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0], {
    word: 'pugnacious',
    url: 'https://upload.wikimedia.org/pugnacious.wav',
    source: 'wikimedia-commons',
    accent: 'other',
    phonetic: '',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File%3ALL-Q1860%20(eng)-Speaker-pugnacious.wav',
    licenseName: 'CC0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    author: 'Speaker',
    attributionRequired: false,
    mimeType: 'audio/wav'
  });
});

test('词典请求失败仍可使用 Wikimedia 真人录音', async () => {
  const { createPronunciationResolver } = await loadResolver();
  const resolver = createPronunciationResolver({
    fetchFn: async url => {
      if (url.includes('dictionaryapi.dev/api/')) throw new Error('offline');
      return jsonResponse({
        query: {
          pages: [{
            title: 'File:En-us-eczema.ogg',
            imageinfo: [{ url: 'https://upload.wikimedia.org/eczema.ogg', mime: 'audio/ogg' }]
          }]
        }
      });
    }
  });

  const candidates = await resolver.resolve('eczema');
  assert.equal(candidates[0].url, 'https://upload.wikimedia.org/eczema.ogg');
  assert.equal(candidates[0].accent, 'us');
});

test('词典接口挂起时按源超时并继续查询 Wikimedia', async () => {
  const { createPronunciationResolver } = await loadResolver();
  const startedAt = Date.now();
  const resolver = createPronunciationResolver({
    sourceTimeoutMs: 20,
    fetchFn: async (url, options = {}) => {
      if (url.includes('dictionaryapi.dev/api/')) {
        return new Promise((resolve, reject) => {
          options.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          }, { once: true });
        });
      }
      return jsonResponse({
        query: {
          pages: [{
            title: 'File:En-uk-latency.ogg',
            imageinfo: [{ url: 'https://upload.wikimedia.org/latency.ogg', mime: 'audio/ogg' }]
          }]
        }
      });
    }
  });

  const candidates = await resolver.resolve('latency');
  assert.equal(candidates[0].url, 'https://upload.wikimedia.org/latency.ogg');
  assert.ok(Date.now() - startedAt < 200, '单个发音源挂起不能阻塞整个发音链路');
});

test('Wikimedia 查询关闭时只检查 Free Dictionary，供批量预加载使用', async () => {
  const { createPronunciationResolver } = await loadResolver();
  const calls = [];
  const resolver = createPronunciationResolver({
    fetchFn: async url => {
      calls.push(url);
      return jsonResponse([{ word: 'rareword', phonetics: [] }]);
    }
  });

  assert.deepEqual(await resolver.resolve('rareword', { includeWikimedia: false }), []);
  assert.equal(calls.length, 1);
});

test('可显式查询 Wikimedia，供词典录音文件失效时二次回退', async () => {
  const { createPronunciationResolver } = await loadResolver();
  const resolver = createPronunciationResolver({
    fetchFn: async url => {
      assert.match(url, /^https:\/\/commons\.wikimedia\.org/u);
      return jsonResponse({
        query: {
          pages: [{
            title: 'File:LL-Q1860 (eng)-Speaker-year.wav',
            imageinfo: [{ url: 'https://upload.wikimedia.org/year.wav', mime: 'audio/wav' }]
          }]
        }
      });
    }
  });

  const candidates = await resolver.resolveWikimedia('year');
  assert.equal(candidates[0].source, 'wikimedia-commons');
});

test('真人录音文件下载有独立超时，不会无限等待 CDN', async () => {
  const { fetchPronunciationResponse } = await loadResolver();
  const startedAt = Date.now();
  const response = await fetchPronunciationResponse('https://audio.example.test/slow.mp3', {
    timeoutMs: 20,
    fetchFn: async (url, options = {}) => new Promise((resolve, reject) => {
      options.signal?.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    })
  });

  assert.equal(response, null);
  assert.ok(Date.now() - startedAt < 200);
});
