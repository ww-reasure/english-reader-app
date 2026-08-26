import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

async function loadShell() {
  const source = await read('../src/components/app-shell.js');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

test('vocabulary header is compact and has no decorative ring or intro tagline', async () => {
  const [shell, css] = await Promise.all([
    read('../src/components/app-shell.js'),
    read('../css/style.css')
  ]);

  assert.doesNotMatch(shell, /导入单词与阅读收藏单词一并呈现/);
  assert.match(css, /\.app-shell--vocab \.app-menu-button\s*\{[^}]*border:\s*0;/s);
  assert.doesNotMatch(css, /\.app-shell--vocab \.app-header-description\s*\{/);
});

test('vocabulary home exposes the selected today-first review hierarchy', async () => {
  const source = await read('../src/views/vocabulary.js');

  assert.match(source, /vocab-unified-today-card/);
  assert.match(source, /只练今日/);
  assert.match(source, /开始计划复习/);
  assert.match(source, /最近 7 天/);
  assert.match(source, /vocab-unified-more-trigger/);
});

test('vocabulary filters stay inline instead of opening native select sheets', async () => {
  const source = await read('../src/views/vocabulary.js');

  assert.doesNotMatch(source, /<select[^>]+aria-label="学习状态"/);
  assert.doesNotMatch(source, /<select[^>]+aria-label="排序"/);
  assert.match(source, /renderStatusFilter/);
  assert.match(source, /renderSortMode/);
  assert.match(source, /aria-pressed=/);
});

test('selection and management controls render before the word list and no idle footer remains', async () => {
  const source = await read('../src/views/vocabulary.js');
  const template = source.slice(source.indexOf('this.container.innerHTML = `'), source.indexOf('\n  renderSourceTab('));

  assert.ok(template.indexOf('${this.renderManagementBar(rows)}') < template.indexOf('vocab-unified-list vocab-list'));
  assert.doesNotMatch(source, /vocab-unified-management--idle/);
  assert.match(source, /vocab-unified-actions-menu/);
  assert.match(source, /vocab-unified-selection-count/);
});

test('back headers use app history with an explicit route fallback instead of opening the drawer', async () => {
  const [{ AppShell }, source] = await Promise.all([
    loadShell(),
    read('../src/components/app-shell.js')
  ]);

  assert.equal(AppShell.getRouteMeta('#/exam/catalog/full_paper').backFallback, '#/exam');
  assert.equal(AppShell.getRouteMeta('#/exam/review').backFallback, '#/exam');
  assert.equal(AppShell.getRouteMeta('#/flashcard').backFallback, '#/vocab');
  assert.equal(AppShell.getRouteMeta('#/reading/42').backFallback, '#/reading-list');
  assert.match(source, /window\.Router\?\.back\?\.\(meta\.backFallback\)/);
});
