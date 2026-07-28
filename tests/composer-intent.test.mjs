import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const intentSource = await readFile(new URL('../src/components/composer-intent.js', import.meta.url), 'utf8').catch(() => null);
const intentModule = intentSource
  ? await import(`data:text/javascript;base64,${Buffer.from(intentSource).toString('base64')}`)
  : null;

test('composer routes explicit article requests into the learning-reading flow', () => {
  assert.ok(intentModule, 'composer intent router module is required');
  assert.equal(intentModule.classifyComposerIntent('请生成一篇关于科技的四级英语阅读'), 'generate');
  assert.equal(intentModule.classifyComposerIntent('帮我来一篇旅行主题的英文文章'), 'generate');
  assert.equal(intentModule.classifyComposerIntent('我想读一篇旅行主题的英语阅读'), 'generate');
  assert.equal(intentModule.classifyComposerIntent('给我一篇考研英语阅读练习'), 'generate');
  assert.equal(intentModule.classifyComposerIntent('请写一篇关于 AI 教育的英文文章'), 'generate');
  assert.equal(intentModule.classifyComposerIntent('请生成一篇英语阅读，并分析其中的高频词'), 'generate');
  assert.equal(intentModule.classifyComposerIntent('Generate a graduate reading passage of 1000 words.'), 'generate');
  assert.equal(intentModule.classifyComposerIntent('Please write an English article about ocean protection.'), 'generate');
});

test('composer keeps questions about reading generation in the chat flow', () => {
  assert.ok(intentModule, 'composer intent router module is required');
  assert.equal(intentModule.classifyComposerIntent('怎么生成一篇适合我的文章？'), 'chat');
  assert.equal(intentModule.classifyComposerIntent('为什么文章生成失败？'), 'chat');
  assert.equal(intentModule.classifyComposerIntent('请解释这篇文章里的英语词汇'), 'chat');
  assert.equal(intentModule.classifyComposerIntent('请帮我翻译一篇英语文章'), 'chat');
  assert.equal(intentModule.classifyComposerIntent('请给我分析一篇英语阅读'), 'chat');
  assert.equal(intentModule.classifyComposerIntent('请帮我翻译成英语'), 'chat');
  assert.equal(intentModule.classifyComposerIntent('我想了解如何生成英语文章'), 'chat');
  assert.equal(intentModule.classifyComposerIntent('请帮我写英语作文的大纲'), 'chat');
  assert.equal(intentModule.classifyComposerIntent('帮我修改这段英语文章的语法'), 'chat');
  assert.equal(intentModule.classifyComposerIntent('我今天最应该复习什么？'), 'chat');
  assert.equal(intentModule.classifyComposerIntent('How do I generate a suitable English reading passage?'), 'chat');
  assert.equal(intentModule.classifyComposerIntent('I want to know how to generate an English article.'), 'chat');
  assert.equal(intentModule.classifyComposerIntent('Why did my article generation fail?'), 'chat');
});
