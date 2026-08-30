import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

async function loadBuilder() {
  const source = await readFile(new URL('../src/components/context-builder.js', import.meta.url), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

test('reading context includes selected text but never full article content', async () => {
  const { ContextBuilder } = await loadBuilder();
  const messages = new ContextBuilder().build({
    kind: 'reading',
    summary: '',
    messages: [],
    userMessage: '继续解释',
    pageContext: {
      article: { title: 'Test', content: 'x'.repeat(5000) },
      sentence: 'Selected sentence.',
      paragraph: 'Current paragraph.'
    }
  });
  const joined = messages.map(message => message.content).join('\n');
  assert.match(joined, /Selected sentence/);
  assert.equal(joined.includes('x'.repeat(300)), false);
});

test('reading follow-ups receive the active sentence analysis, including its imitation sentence', async () => {
  const { ContextBuilder } = await loadBuilder();
  const messages = new ContextBuilder().build({
    kind: 'reading',
    summary: '',
    messages: [],
    userMessage: '解释仿写句里的单词',
    pageContext: {
      article: { title: 'Test' },
      sentence: 'Original sentence.',
      paragraph: 'Current paragraph.',
      analysis: '仿写练习：Students who practise daily improve steadily.'
    }
  });
  const joined = messages.map(message => message.content).join('\n');
  assert.match(joined, /Students who practise daily improve steadily/);
  assert.match(joined, /仿写/);
});

test('home context retains generated article facts and safe generation failures', async () => {
  const { ContextBuilder } = await loadBuilder();
  const messages = new ContextBuilder().build({
    kind: 'home',
    summary: '',
    messages: [
      {
        role: 'assistant',
        kind: 'article',
        createdAt: 100,
        article: {
          id: 7,
          title: 'The Temp Work Phenomenon',
          titleZh: '临时工作现象',
          difficulty: 'cet4',
          topic: '社会',
          wordCount: 254,
          content: 'This is the generated reading body.'
        }
      },
      {
        role: 'assistant',
        kind: 'generation_failure',
        createdAt: 200,
        failure: { message: '第 2 篇缺少复习词，已跳过。' }
      }
    ],
    userMessage: '刚刚为什么只成功了一篇？'
  });
  const joined = messages.map(message => message.content).join('\n');

  assert.match(joined, /The Temp Work Phenomenon/);
  assert.match(joined, /临时工作现象/);
  assert.match(joined, /This is the generated reading body/);
  assert.match(joined, /第 2 篇缺少复习词/);
});

test('home agent prompt restricts writing tools to the current user request', async () => {
  const { ContextBuilder } = await loadBuilder();
  const messages = new ContextBuilder().build({
    kind: 'home',
    summary: '',
    messages: [],
    userMessage: '这是一篇什么类型的文章？'
  });
  const system = messages.find(message => message.role === 'system')?.content || '';

  assert.match(system, /当前用户消息/);
  assert.match(system, /不得.*历史/);
  assert.match(system, /普通回答/);
});

test('home context injects structured generation facts from the recent activity ledger ahead of free-form chat', async () => {
  const { ContextBuilder } = await loadBuilder();
  const messages = new ContextBuilder().build({
    kind: 'home',
    summary: '',
    messages: [],
    activities: [{
      type: 'review_generation',
      status: 'partial_success',
      startedAt: 100,
      completedAt: 2500,
      elapsedMs: 2400,
      coveredWordCount: 16,
      failedWordCount: 8,
      articles: [{ id: 12, title: 'Review article', difficulty: 'cet6', wordCount: 300 }],
      failureReason: '第 2 篇内容不完整'
    }],
    userMessage: '刚才为什么只生成了一篇？花了多久？'
  });
  const joined = messages.map(message => message.content).join('\n');

  assert.match(joined, /真实活动账本/);
  assert.match(joined, /partial_success/);
  assert.match(joined, /Review article/);
  assert.match(joined, /2400/);
  assert.match(joined, /第 2 篇内容不完整/);
});

test('guided home requests receive progressive teaching rules and only visible lesson progress', async () => {
  const { ContextBuilder } = await loadBuilder();
  const messages = new ContextBuilder().build({
    kind: 'home', summary: '', messages: [], userMessage: '表示让步',
    pageContext: {
      homeLearningMode: 'guided_reply',
      guidedInstruction: '必须调用 adapt_guided_learning，一次只处理当前步骤。',
      guidedSession: {
        id: 'lesson-1', status: 'active', currentStepIndex: 0,
        target: { title: '理解让步', text: 'Although it was late, we stayed.' },
        steps: [
          { id: 'step-1', kind: 'free_response', title: '先说关系', content: '只说明逻辑关系。', prompt: '是什么关系？' },
          { id: 'step-2', kind: 'choice', title: '未来隐藏步骤', content: '不应提前展示', prompt: '秘密问题', choices: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correctChoiceId: 'b' }
        ],
        answers: {}, hints: {}, revision: 2
      }
    }
  });
  const joined = messages.map(message => message.content).join('\n');
  assert.match(joined, /adapt_guided_learning/);
  assert.match(joined, /先说关系/);
  assert.doesNotMatch(joined, /未来隐藏步骤/);
  assert.doesNotMatch(joined, /correctChoiceId/);
});

test('detailed home preference requests the existing full answer path without enabling guided mode', async () => {
  const { ContextBuilder } = await loadBuilder();
  const messages = new ContextBuilder().build({
    kind: 'home', summary: '', messages: [], userMessage: 'inevitable',
    pageContext: { homeLearningMode: 'detailed' }
  });
  const systems = messages.filter(message => message.role === 'system').map(message => message.content).join('\n');
  assert.match(systems, /详细解析/);
  assert.doesNotMatch(systems, /create_guided_learning/);
});
