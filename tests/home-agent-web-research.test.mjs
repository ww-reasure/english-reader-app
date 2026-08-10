import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { AppCapabilityRegistry } from '../src/components/app-capabilities.mjs';

async function loadConversationStore() {
  const source = await readFile(new URL('../src/components/conversation-store.js', import.meta.url), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}
import { normalizeResearchSources } from '../src/components/web-research.mjs';

async function loadTool() {
  const source = await readFile(new URL('../src/components/article-generation-tool.js', import.meta.url), 'utf8');
  const profile = await readFile(new URL('../src/difficulty-profile.mjs', import.meta.url), 'utf8');
  const profileUrl = 'data:text/javascript;base64,' + Buffer.from(profile).toString('base64');
  const research = await readFile(new URL('../src/components/web-research.mjs', import.meta.url), 'utf8');
  const researchUrl = 'data:text/javascript;base64,' + Buffer.from(research).toString('base64');
  const adapted = source
    .replace("from '../difficulty-profile.mjs'", `from '${profileUrl}'`)
    .replace("from './web-research.mjs'", `from '${researchUrl}'`);
  return import('data:text/javascript;base64,' + Buffer.from(adapted).toString('base64'));
}

async function read(relativePath) {
  return (await readFile(new URL(relativePath, import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
}

test('capability registry advertises web research with a settings prerequisite', () => {
  const entry = AppCapabilityRegistry.get('web_research');
  assert.ok(entry, 'web_research capability must be registered');
  assert.equal(entry.route, '#/chat');
  assert.ok(entry.prerequisites.some(value => /Tavily/.test(value)));
  assert.match(entry.summary, /联网检索/);
});

test('home conversation persists a web_research activity with the real query facts', async () => {
  const { ConversationStore } = await loadConversationStore();
  const values = new Map();
  const store = new ConversationStore({
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  }, () => 1000);
  store.append('home', { role: 'user', kind: 'text', content: '查一下最近 AI 新闻' });
  store.appendActivity('home', {
    type: 'web_research',
    status: 'success',
    query: 'latest AI news',
    resultCount: 5,
    domains: ['example.com', 'example.org']
  });

  const activities = store.getRecentActivities('home', 10);
  const search = activities.find(activity => activity.type === 'web_research');
  assert.ok(search);
  assert.equal(search.query, 'latest AI news');
  assert.equal(search.resultCount, 5);
});

test('generation tool saves validated research sources on the article', async () => {
  const { ArticleGenerationTool } = await loadTool();
  const saved = [];
  const tool = new ArticleGenerationTool({
    api: {
      generateArticle: async () => ({ title: 'Space News', content: 'A short article', translation: '短文', wordCount: 4 })
    },
    db: {
      getAllLearnWords: async () => [],
      saveArticle: async article => { saved.push(article); return 7; },
      deleteArticle: async () => {}
    },
    validate: () => ({ passed: true, metrics: { wordCount: 4 }, deviations: [] })
  });

  await tool.execute({ request: '生成文章' }, {
    articleFields: {
      generationJobId: 'job-1',
      researchSources: [
        { title: 'One', url: 'https://example.com/one' },
        { title: 'Two', url: 'https://example.org/two' },
        { title: 'Bad', url: '' },
        { title: 'Three', url: 'https://example.net/three' }
      ],
      researchSearchedAt: 1234
    }
  });

  assert.equal(saved.length, 1);
  assert.equal(saved[0].generationJobId, 'job-1');
  assert.deepEqual(saved[0].researchSources, normalizeResearchSources([
    { title: 'One', url: 'https://example.com/one' },
    { title: 'Two', url: 'https://example.org/two' },
    { title: 'Bad', url: '' },
    { title: 'Three', url: 'https://example.net/three' }
  ]));
  assert.equal(saved[0].researchSearchedAt, 1234);
});

test('generate_reading tool advertises research sources and query arguments', async () => {
  const { GENERATE_READING_TOOL } = await loadTool();
  const properties = GENERATE_READING_TOOL.function.parameters.properties;
  assert.ok(properties.researchSources);
  assert.ok(properties.researchQuery);
});

test('chat view wires search_web, research cards and research-backed generation', async () => {
  const chat = await read('../src/views/chat.js');
  const generationBlock = chat.slice(chat.indexOf('async executeHomeTool('), chat.indexOf('buildGenerationContext('));

  assert.match(chat, /const SEARCH_WEB_TOOL/);
  assert.match(chat, /SEARCH_WEB_TOOL, GENERATE_READING_TOOL\]/);
  assert.match(chat, /name === 'search_web'/);
  assert.match(generationBlock, /type: 'research_sources'/);
  assert.match(chat, /artifact\.type === 'research_sources'/);
  assert.match(chat, /kind:\s*'research_sources'/);
  assert.match(chat, /addResearchSourcesToDOM/);
  assert.match(chat, /type:\s*'web_research'/);
  assert.match(chat, /据此生成阅读/);
});

test('handleGenerate and agent generation carry research sources into the job payload', async () => {
  const chat = await read('../src/views/chat.js');
  const handle = chat.slice(chat.indexOf('async handleGenerate('), chat.indexOf('publishReviewArticles('));
  const generationBlock = chat.slice(chat.indexOf('async executeHomeTool('), chat.indexOf('buildGenerationContext('));

  assert.match(handle, /researchSources = null/);
  assert.match(handle, /researchQuery = ''/);
  assert.match(handle, /researchSources:/);
  assert.match(handle, /researchBrief/);
  assert.match(generationBlock, /const researchSources = normalizeResearchSources\(/);
  assert.match(generationBlock, /const researchBrief = /);
});

test('single generation job saves research sources through controlled article fields', async () => {
  const chat = await read('../src/views/chat.js');
  const job = chat.slice(chat.indexOf('async executeSingleGenerationJob('), chat.indexOf('async executeReviewGenerationJob('));

  assert.match(job, /researchSources: payload\.researchSources/);
  assert.match(job, /researchSearchedAt: payload\.researchSearchedAt/);
});

test('context builder explains web search boundaries and formats research activities', async () => {
  const builder = await read('../src/components/context-builder.js');

  assert.match(builder, /search_web/);
  assert.match(builder, /最新资讯/);
  assert.match(builder, /type === 'web_research'/);
  assert.match(builder, /resultCount/);
  assert.match(builder, /query/);
});

test('reading page, shelf and history surface research sources without faking them', async () => {
  const [reading, shelf, history] = await Promise.all([
    read('../src/views/reading.js'),
    read('../src/views/reading-list.js'),
    read('../src/views/history.js')
  ]);

  assert.match(reading, /researchSources/);
  assert.match(reading, /资料来源/);
  assert.match(shelf, /researchSources/);
  assert.match(shelf, /联网资料/);
  assert.match(history, /researchSources/);
  assert.match(history, /联网资料/);
});


test('search_web is bounded to two searches per user request', async () => {
  const chat = await read('../src/views/chat.js');

  assert.match(chat, /_searchCallCounts/);
  assert.match(chat, /searchCalls > 2/);
  assert.match(chat, /status: 'search_limit'/);
  assert.doesNotMatch(chat, /status: 'search_limit'[\s\S]{0,80}artifact/);
});