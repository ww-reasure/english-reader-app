import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  assertKeyPhraseManifest,
  assertKeyPhrasePack,
  createKeyPhraseLibrary
} from '../src/key-phrase-library.mjs';
import { buildKeyPhraseMatcherIndex, matchKeyPhraseAt } from '../src/components/word-marking.mjs';

// 与 word-marking.mjs 的 TOKEN_PATTERN 保持一致的分词正则（自匹配检查用）。
const TOKEN_PATTERN = /[A-Za-z]+(?:['’–-][A-Za-z]+)*/gu;

const readJson = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

const manifest = await readJson('../public/data/key-phrases/manifest.json');
const packs = {};
for (const track of ['cet4', 'kaoyan', 'general']) {
  packs[track] = assertKeyPhrasePack(await readJson(`../public/data/key-phrases/${track}.json`), { track });
}

const normId = value => String(value || '').replace(/[’]/gu, "'").trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');

test('shard counts match the manifest declarations', () => {
  const validated = assertKeyPhraseManifest(manifest);
  for (const [track, meta] of Object.entries(validated.tracks)) {
    assert.equal(packs[track].phrases.length, meta.phraseCount, `${track} count drift`);
  }
});

test('general is exactly the union of the cet4 and kaoyan source packs', () => {
  const sourceIds = new Set([
    ...packs.cet4.phrases.map(row => normId(row.p)),
    ...packs.kaoyan.phrases.map(row => normId(row.p))
  ]);
  const generalIds = packs.general.phrases.map(row => normId(row.p));
  assert.equal(new Set(generalIds).size, generalIds.length, 'general has duplicate ids');
  for (const id of generalIds) {
    assert.ok(sourceIds.has(id), `general contains an id absent from both sources: ${id}`);
  }
  for (const id of sourceIds) {
    assert.ok(generalIds.includes(id), `general is missing a source id: ${id}`);
  }
});

test('shards contain no glued OCR artifacts or slash alternations', () => {
  const gluedPattern = /(?:accessibleto|admittedto|advisableto|applicableto|yourwits|beneficialto|cautiousabout|committedto|concernedabout|distinguishoneself|aninfluence|animpression|prejudiceagainst|inteffect|revolvearound|accountof|wanderaround|throughsth|sthto)/;
  for (const row of packs.general.phrases) {
    assert.ok(!gluedPattern.test(row.p), `glued entry survived: ${row.p}`);
    assert.ok(!row.p.includes('/'), `slash alternation survived: ${row.p}`);
  }
});

test('every shipped phrase is matchable through the real matcher', () => {
  const matcher = buildKeyPhraseMatcherIndex(packs.general.phrases);
  const unmatchable = [];
  const shorter = [];
  for (const row of packs.general.phrases) {
    const matches = [...row.p.matchAll(TOKEN_PATTERN)];
    const hit = matchKeyPhraseAt(matcher, matches, 0, row.p);
    if (!hit) {
      unmatchable.push(row.p);
      continue;
    }
    // 命中的 token 数不允许少于自身 token 数：同形兄弟条目（如 deal with / deals with）
    // 可以互相命中，但更短的词组绝不能吃掉完整形态。
    if (hit.tokenCount < matches.length) shorter.push(`${row.p} -> ${hit.id}`);
  }
  assert.deepEqual(unmatchable, [], 'unmatchable phrases');
  assert.deepEqual(shorter, [], 'phrases matched by a shorter candidate');
});
