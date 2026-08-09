import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { getDifficultyProfile } from '../src/difficulty-profile.mjs';

async function loadApi() {
  const [source, profile, stream] = await Promise.all([
    readFile(new URL('../src/api.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/difficulty-profile.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/article-stream.mjs', import.meta.url), 'utf8')
  ]);
  const configUrl = `data:text/javascript;base64,${Buffer.from("export const Config = { get: () => '95' }; ").toString('base64')}`;
  const profileUrl = `data:text/javascript;base64,${Buffer.from(profile).toString('base64')}`;
  const streamUrl = `data:text/javascript;base64,${Buffer.from(stream).toString('base64')}`;
  const adapted = source
    .replace("from './config.js'", `from '${configUrl}'`)
    .replace("from './difficulty-profile.mjs'", `from '${profileUrl}'`)
    .replace("from './article-stream.mjs'", `from '${streamUrl}'`);
  return import(`data:text/javascript;base64,${Buffer.from(adapted).toString('base64')}`);
}

test('keeps user preference separate from the authoritative spec and measured validation correction', async () => {
  const { API } = await loadApi();
  const profile = getDifficultyProfile('cet4', 'standard');
  const preference = '请写一篇四级旅行阅读，180 词。';
  const correction = [
    '上次生成未通过难度校验。请保留主题，但完整重写文章并严格满足以下要求：',
    '- 实际总字数：287 词；要求：320-380 词。',
    '- 实际平均句长：9.5 词；要求：18-21 词。',
    '- 缺失目标词：journey。'
  ].join('\n');
  let request;
  const originalFetch = API.fetch;
  API.fetch = async (_endpoint, body) => {
    request = body;
    return {
      choices: [{
        message: {
          content: JSON.stringify({
            title: 'Travel and Learning',
            titleZh: '旅行与学习',
            content: 'Travel helps people learn.',
            translation: '旅行帮助人们学习。'
          })
        }
      }]
    };
  };

  try {
    await API.generateArticle(`${preference}\n\n${correction}`, 'cet4', '旅行', 'journey', 320, '', {
      profile,
      validationCorrection: correction
    });
  } finally {
    API.fetch = originalFetch;
  }

  const userContent = request.messages[1].content;
  assert.match(userContent, /用户偏好（只用于主题与风格，不得覆盖实际生成规格）/);
  assert.match(userContent, new RegExp(preference));
  assert.match(userContent, /实际生成规格（优先级高于用户偏好）/);
  assert.match(userContent, /难度档案：CET4/);
  assert.match(userContent, /挑战度：standard/);
  assert.match(userContent, /目标字数：320 词/);
  assert.match(userContent, /硬性总字数范围：320-380 词/);
  assert.match(userContent, /若用户偏好中的难度或字数与本规格冲突，以本规格为准/);
  assert.match(userContent, /上次生成的实测校验结果/);
  assert.match(userContent, /实际总字数：287 词；要求：320-380 词/);
  assert.equal(userContent.split('上次生成未通过难度校验').length - 1, 1);
});

test('uses an injected calibrated or conservative personalization contract instead of global coverage settings', async () => {
  const { API } = await loadApi();
  const calibrated = API.buildArticlePrompt('cet4', 320, '', getDifficultyProfile('cet4', 'standard'), {
    mode: 'evidence_calibrated', targetCoverage: 96
  });
  const conservative = API.buildArticlePrompt('cet4', 320, '', getDifficultyProfile('cet4', 'standard'), {
    mode: 'uncalibrated_conservative'
  });

  assert.match(calibrated, /预计掌握覆盖约 96%/);
  assert.match(calibrated, /不得把它写成学习者的词汇量/);
  assert.match(conservative, /未校准保守模式/);
  assert.match(conservative, /至少 90% 的可词形还原词次来自可追溯核心频率层/);
  assert.match(conservative, /至少 80% 来自 NGSL 1-3 层/);
  assert.match(conservative, /不得声称具体覆盖率、词汇量/);
  assert.doesNotMatch(conservative, /读者大概率认识的比例/);
});

test('treats a completed first calibration as evidence collection until a coverage gate has enough independent evidence', async () => {
  const { API } = await loadApi();
  const collecting = API.buildArticlePrompt('cet4', 320, '', getDifficultyProfile('cet4', 'standard'), {
    mode: 'evidence_collecting',
    recommendedCoverage: 96
  });

  assert.match(collecting, /初测已完成/);
  assert.match(collecting, /继续收集独立证据/);
  assert.match(collecting, /至少 90% 的可词形还原词次来自可追溯核心频率层/);
  assert.doesNotMatch(collecting, /预计掌握覆盖约 96%/);
  assert.doesNotMatch(collecting, /词汇量/);
});

test('frames every generated text as target-exam-oriented training rather than an equivalent real exam', async () => {
  const { API } = await loadApi();
  const prompt = API.buildArticlePrompt('cet6', 400, '', getDifficultyProfile('cet6', 'standard'));

  assert.match(prompt, /目标考试导向训练材料/);
  assert.match(prompt, /不得宣称与真实试题等效/);
  assert.doesNotMatch(prompt, /符合真实考试标准/);
  assert.doesNotMatch(prompt, /像真实的考试阅读材料/);
  assert.doesNotMatch(prompt, /四、六级词汇/);
});

test('does not retain the legacy unaudited difficulty-rule prompt table', async () => {
  const source = await readFile(new URL('../src/api.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /difficultyRules/);
  assert.doesNotMatch(source, /四级大纲词汇/);
  assert.doesNotMatch(source, /六级大纲词汇/);
});

test('streams article JSON deltas into draft snapshots without changing the final article shape', async () => {
  const { API } = await loadApi();
  const events = [
    { choices: [{ delta: { content: '{"title":"Streaming","content":"First sentence. ' } }] },
    { choices: [{ delta: { content: "Second sentence. Third sentence.\",\"titleZh\":\"流式文章\",\"translation\":\"第一句。第二句。第三句。\"}" } }] }
  ];
  const requests = [];
  const drafts = [];
  const originalFetchStream = API.fetchStream;
  API.fetchStream = async (_endpoint, body, _timeout, _signal, onEvent) => {
    requests.push(body);
    for (const event of events) onEvent(event);
    return { usage: { total_tokens: 12 } };
  };

  try {
    const article = await API.generateArticleStream(
      '写一篇文章',
      'cet4',
      '旅行',
      'journey',
      280,
      '',
      { onDraft: draft => drafts.push(draft) }
    );
    assert.equal(article.title, 'Streaming');
    assert.equal(article.titleZh, '流式文章');
    assert.match(article.content, /First sentence/);
    assert.equal(drafts.at(-1).wordCount, 6);
    assert.equal(requests[0].stream, true);
    assert.deepEqual(requests[0].stream_options, { include_usage: true });
  } finally {
    API.fetchStream = originalFetchStream;
  }
});

test('falls back when a gateway returns a normal 200 response without SSE deltas', async () => {
  const { API } = await loadApi();
  const originalFetchStream = API.fetchStream;
  const originalGenerateArticle = API.generateArticle;
  let fallbackArgs = null;
  API.fetchStream = async () => ({ usage: null });
  API.generateArticle = async (...args) => {
    fallbackArgs = args;
    return {
      title: 'Fallback',
      titleZh: '回退文章',
      content: 'One sentence. Another sentence. A final sentence.',
      translation: '第一句。第二句。最后一句。'
    };
  };

  try {
    const article = await API.generateArticleStream('写一篇文章', 'cet4', '旅行', 'journey', 280);
    assert.equal(article.title, 'Fallback');
    assert.equal(fallbackArgs?.[0], '写一篇文章');
    assert.equal(fallbackArgs?.[4], 280);
  } finally {
    API.fetchStream = originalFetchStream;
    API.generateArticle = originalGenerateArticle;
  }
});

test('uses the short relaxed specification for review reading generation', async () => {
  const { API } = await loadApi();
  const originalFetch = API.fetch;
  let request;
  API.fetch = async (_endpoint, body) => {
    request = body;
    return {
      choices: [{
        message: {
          content: JSON.stringify({
            title: 'A Short Review',
            titleZh: '短篇复习',
            content: 'One sentence. Another sentence. A final sentence.',
            translation: '第一句。第二句。最后一句。'
          })
        }
      }]
    };
  };
  try {
    await API.generateArticle('复习阅读', 'cet4', '复习', 'memory, practice', 173, '', {
      reviewMode: true,
      reviewMaxWords: 280
    });
  } finally {
    API.fetch = originalFetch;
  }
  assert.match(request.messages[0].content, /复习短篇规则/);
  assert.match(request.messages[0].content, /最多 280 词/);
  assert.doesNotMatch(request.messages[0].content, /硬性校验：总字数必须控制在 210-420/);
  assert.match(request.messages[1].content, /不设置普通文章式最低字数/);
});
