import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

async function loadService() {
  const [source, multimodal] = await Promise.all([
    readFile(new URL('../src/components/chat-service.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/multimodal-context.mjs', import.meta.url), 'utf8')
  ]);
  const adapted = source
    .replace("import { LEARNING_TOOLS } from './learning-agent.js';", "const LEARNING_TOOLS = [];")
    .replace("from './multimodal-context.mjs'", `from '${dataModule(multimodal)}'`);
  return import(dataModule(adapted));
}

const emptySession = () => ({ summary: '', messages: [], activities: [] });

const createService = async api => {
  const { ChatService } = await loadService();
  return new ChatService({
    api,
    builder: {
      build: ({ userMessage, toolResults = [] }) => [
        { role: 'system', content: 'system' },
        { role: 'user', content: userMessage },
        ...toolResults.map(result => ({ role: 'system', content: JSON.stringify(result) }))
      ]
    },
    agent: {
      async execute(name) { return { tool: name, status: 'ok' }; },
      async getLearningOverview() { return { status: 'ok' }; }
    },
    webResearch: { resolve: () => ({ native: false, tavily: true }) }
  });
};

const createVisionUnavailableFixture = async () => {
  const models = [];
  const error = Object.assign(new Error('API error: 404 - model not found'), { status: 404 });
  const api = {
    isVisionModelUnavailable: () => true,
    async chatCompletion(_messages, options) {
      models.push(options.modelOverride);
      if (options.modelOverride === 'deepseek-v4-flash') {
        return { message: { role: 'assistant', content: 'text fallback' } };
      }
      throw error;
    }
  };
  const shared = {
    sessionKey: 'home', kind: 'home', session: emptySession(),
    userMessage: '普通问题', modelOverride: 'deepseek-v4-flash-vision-exp'
  };
  return {
    service: await createService(api),
    models,
    textInput: shared,
    imageInput: {
      ...shared,
      userMessage: '讲解图片',
      attachmentGroup: { prompt: '讲解图片', attachments: [{ order: 0, remoteFileId: 'file-api-1' }] }
    }
  };
};

test('image blocks survive an Agent tool call and the final round', async () => {
  const calls = [];
  const service = await createService({
    async chatCompletion(messages, options) {
      calls.push(structuredClone({ messages, options }));
      if (calls.length === 1) return { message: {
        role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'get_learning_overview', arguments: '{}' } }]
      }};
      return { message: { role: 'assistant', content: '结合你的学习记录，这张图...' } };
    }
  });

  await service.ask({
    sessionKey: 'home', kind: 'home', session: emptySession(), userMessage: '结合我的情况讲解',
    attachmentGroup: { prompt: '结合我的情况讲解', attachments: [{ order: 0, remoteFileId: 'file-api-1' }] },
    modelOverride: 'deepseek-v4-flash-vision-exp'
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].messages.at(-1).content[1].file_id, 'file-api-1');
  assert.equal(calls[1].messages.some(message => Array.isArray(message.content) && message.content.some(part => part.file_id === 'file-api-1')), true);
  assert.equal(calls[0].options.modelOverride, 'deepseek-v4-flash-vision-exp');
});

test('pure text Vision Exp failure retries Flash once, image failure does not', async () => {
  const pure = await createVisionUnavailableFixture();
  await pure.service.ask(pure.textInput);
  assert.deepEqual(pure.models, ['deepseek-v4-flash-vision-exp', 'deepseek-v4-flash']);

  const image = await createVisionUnavailableFixture();
  await assert.rejects(() => image.service.ask(image.imageInput));
  assert.deepEqual(image.models, ['deepseek-v4-flash-vision-exp']);
});
