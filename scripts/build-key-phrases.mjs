#!/usr/bin/env node
/**
 * 重点词组资料 → public/data/key-phrases/ 打包脚本。
 *
 * 用法：
 *   node scripts/build-key-phrases.mjs --input <资料文件> [--track general] [--out public/data/key-phrases]
 *
 * 支持输入格式（按内容自动识别）：
 *   - JSON 数组：["look forward to", ...] 或 [{ "phrase": "...", "gloss": "..." }, ...]
 *   - JSON 对象：{ "phrases": [...] }
 *   - 文本行：每行一条，"词组<TAB>释义" / "词组 | 释义" / "词组 ― 释义"，无分隔时整行为词组
 *
 * 同一 track 重复导入时按规范化词组合并（新释义覆盖旧释义），manifest 每次重建。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KAOYAN_INPUTS = new Set(['kaoyan', 'kaoyan1', 'kaoyan2', 'kaoyan-general']);
const KNOWN_TRACKS = new Set(['general', 'cet4', 'cet6', 'kaoyan']);

function parseArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

function normalizeText(value) {
  return String(value || '')
    .replace(/[’]/gu, "'")
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizeId(value) {
  return normalizeText(value).toLocaleLowerCase('en-US');
}

function normalizeTrack(value) {
  const raw = normalizeText(value || 'general').toLocaleLowerCase('en-US');
  if (KAOYAN_INPUTS.has(raw)) return 'kaoyan';
  return raw;
}

function parseRow(raw) {
  const line = String(raw || '').replace(/[\r\n]+$/u, '');
  if (!line.trim()) return null;
  // TAB 先于规范化处理：normalizeText 会把空白折叠掉，TAB 分隔必须在原始行上找。
  const tabAt = line.indexOf('\t');
  if (tabAt > 0) {
    return { phrase: line.slice(0, tabAt), gloss: line.slice(tabAt + 1) };
  }
  const normalized = normalizeText(line);
  const separators = [' | ', '｜', ' —— ', ' — ', ' – '];
  for (const separator of separators) {
    const at = normalized.indexOf(separator);
    if (at > 0) {
      return { phrase: normalized.slice(0, at), gloss: normalized.slice(at + separator.length) };
    }
  }
  return { phrase: normalized, gloss: '' };
}

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (inQuotes) {
      if (char === '"' && line[index + 1] === '"') { current += '"'; index += 1; }
      else if (char === '"') inQuotes = false;
      else current += char;
    } else if (char === '"') inQuotes = true;
    else if (char === ',') { fields.push(current); current = ''; }
    else current += char;
  }
  if (inQuotes) throw new Error(`CSV 行存在未闭合引号：${line.slice(0, 60)}...`);
  fields.push(current);
  return fields;
}

function rowFromCsvFields(fields) {
  let phrase = null;
  let gloss = '';
  for (const field of fields) {
    const value = normalizeText(field);
    if (!value) continue;
    const hasCJK = /[\u4e00-\u9fff]/u.test(value);
    if (!hasCJK && /[A-Za-z]{2}/u.test(value)) {
      if (phrase === null) phrase = value;
    } else if (hasCJK && !gloss) {
      gloss = value;
    }
  }
  return phrase ? { phrase, gloss } : null;
}

function extractRows(source, { isCsv = false } = {}) {
  const trimmed = String(source || '').replace(/^\ufeff/u, '').trim();
  if (!isCsv && (trimmed.startsWith('[') || trimmed.startsWith('{'))) {
    const parsed = JSON.parse(trimmed);
    const rows = Array.isArray(parsed) ? parsed : parsed.phrases;
    if (!Array.isArray(rows)) throw new Error('JSON 资料需要是数组或含 phrases 数组的对象');
    return rows.map(row => {
      if (typeof row === 'string') return parseRow(row);
      return { phrase: row?.phrase ?? row?.p ?? row?.word, gloss: row?.gloss ?? row?.g ?? row?.glossZh ?? row?.translation ?? '' };
    });
  }
  if (isCsv) {
    return trimmed.split(/\r?\n/).map(line => line.trim() ? rowFromCsvFields(parseCsvLine(line)) : null);
  }
  return trimmed.split(/\r?\n/).map(parseRow);
}

function readExistingShard(shardPath, track) {
  if (!existsSync(shardPath)) return new Map();
  try {
    const parsed = JSON.parse(readFileSync(shardPath, 'utf8'));
    const rows = assertShardShape(parsed, track) ? parsed.phrases : [];
    return new Map(rows.map(row => [normalizeId(row.p), { phrase: row.p, gloss: row.g || '' }]));
  } catch {
    console.warn(`⚠ 既有分片 ${shardPath} 无法解析，忽略并重建`);
    return new Map();
  }
}

function assertShardShape(value, track) {
  return value?.schemaVersion === 1 && value?.track === track && Array.isArray(value?.phrases);
}

// 已知 OCR 粘连词修正表（源自不背单词 App 导出资料的 PDF 提取缺陷）。
// 键为规范化（小写+空白折叠）后的粘连形态，值为修正后的词组。
const OCR_PHRASE_FIXUPS = new Map(Object.entries({
  'ascribe sthto...': 'ascribe sth to...',
  'attribute sthto sb': 'attribute sth to sb',
  'attribute sthto sth': 'attribute sth to sth',
  'be accessibleto sb': 'be accessible to sb',
  'be admittedto sth': 'be admitted to sth',
  'be advisableto do': 'be advisable to do',
  'be applicableto': 'be applicable to',
  "be at yourwits' end": "be at your wits' end",
  'be beneficialto': 'be beneficial to',
  'be cautiousabout sth': 'be cautious about sth',
  'be committedto sth': 'be committed to sth',
  'be concernedabout sth': 'be concerned about sth',
  'distinguishoneself': 'distinguish oneself',
  'have aninfluence on': 'have an influence on',
  'make animpression': 'make an impression',
  'prejudiceagainst': 'prejudice against',
  'put sth inteffect': 'put sth into effect',
  'revolvearound': 'revolve around',
  'take accountof sth': 'take account of sth',
  'wanderaround': 'wander around',
  'work throughsth': 'work through sth'
}));

// 斜杠替代表展开："aim at/for sth" → ["aim at sth", "aim for sth"]。
// 匹配引擎只认相邻 token，斜杠原样入库的词组永远无法命中（约 73 条）。
const MAX_SLASH_VARIANTS = 8;

function expandSlashVariants(phrase) {
  if (!phrase.includes('/')) return [phrase];
  let variants = [''];
  for (const token of phrase.split(' ')) {
    const options = token.includes('/') ? token.split('/').filter(Boolean) : [token];
    const next = [];
    for (const prefix of variants) {
      for (const option of options) {
        next.push(prefix ? `${prefix} ${option}` : option);
      }
    }
    if (next.length > MAX_SLASH_VARIANTS) return [phrase];
    variants = next;
  }
  return variants.filter(Boolean);
}

// 括号可选词展开："keep (on) doing sth" → ["keep doing sth", "keep on doing sth"]。
// 匹配引擎无法表达可选 token，括号原样入库的词组同样永远无法命中。
function expandParentheticalVariants(phrase) {
  if (!/\([^)]*\)/.test(phrase)) return [phrase];
  let variants = [''];
  for (const token of phrase.split(' ')) {
    const optional = /^\((.*)\)$/u.exec(token);
    const options = optional ? [optional[1], ''] : [token];
    const next = [];
    for (const prefix of variants) {
      for (const option of options) {
        next.push(option ? (prefix ? `${prefix} ${option}` : option) : prefix);
      }
    }
    if (next.length > MAX_SLASH_VARIANTS) return [phrase];
    variants = next;
  }
  return variants.filter(Boolean);
}

function main() {
  const inputPath = parseArg('input');
  const track = normalizeTrack(parseArg('track'));
  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', parseArg('out') || 'public/data/key-phrases');
  const derivedFrom = (parseArg('derived-from') || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => normalizeTrack(value));
  if (!inputPath || !existsSync(inputPath)) {
    console.error('用法：node scripts/build-key-phrases.mjs --input <资料文件> [--track general]');
    process.exit(1);
  }
  if (!KNOWN_TRACKS.has(track)) {
    console.error(`未知 track：${track}（可用：general/cet4/cet6/kaoyan）`);
    process.exit(1);
  }

  const rows = extractRows(readFileSync(inputPath, 'utf8'), { isCsv: inputPath.toLowerCase().endsWith('.csv') });
  const shardPath = resolve(outDir, `${track}.json`);
  const merged = readExistingShard(shardPath, track);
  // 修正表覆盖的粘连条目从既有分片中移除，随后以修正形态重新入库。
  for (const glued of OCR_PHRASE_FIXUPS.keys()) {
    if (merged.delete(glued)) console.log(`  ↺ 移除粘连条目：${glued}`);
  }
  // 斜杠/括号条目在匹配引擎里永远不可命中：从既有分片清除，由本次输入的展开变体重建。
  for (const [id, entry] of [...merged]) {
    if (entry.phrase.includes('/') || /[()]/u.test(entry.phrase)) {
      merged.delete(id);
      console.log(`  ↺ 移除不可命中条目：${id}`);
    }
  }
  let added = 0;
  let updated = 0;
  for (const row of rows) {
    const rawPhrase = normalizeText(row?.phrase);
    if (!rawPhrase) continue;
    const phrase = OCR_PHRASE_FIXUPS.get(normalizeId(rawPhrase)) || rawPhrase;
    const gloss = normalizeText(row?.gloss || '');
    for (const variant of expandSlashVariants(phrase).flatMap(expandParentheticalVariants)) {
      const id = normalizeId(variant);
      const existing = merged.get(id);
      if (!existing) {
        merged.set(id, { phrase: variant, gloss });
        added += 1;
      } else if (gloss && gloss !== existing.gloss) {
        merged.set(id, { phrase: variant, gloss });
        updated += 1;
      }
    }
  }

  const phrases = [...merged.values()]
    .sort((left, right) => normalizeId(left.phrase).localeCompare(normalizeId(right.phrase), 'en-US'))
    .map(entry => ({ p: entry.phrase, g: entry.gloss }));

  mkdirSync(outDir, { recursive: true });
  writeFileSync(shardPath, `${JSON.stringify({ schemaVersion: 1, track, phrases }, null, 2)}\n`, 'utf8');

  const tracks = {};
  // 重建 manifest 时继承既有的 derivedFrom 标记，--derived-from 只覆盖当前 track。
  let previousTracks = {};
  const manifestPath = resolve(outDir, 'manifest.json');
  try {
    previousTracks = JSON.parse(readFileSync(manifestPath, 'utf8'))?.tracks || {};
  } catch {
    previousTracks = {};
  }
  for (const file of existsSync(outDir) ? readShardFiles(outDir) : []) {
    const shardTrack = file.replace(/\.json$/, '');
    if (shardTrack === 'manifest') continue;
    const shard = JSON.parse(readFileSync(resolve(outDir, file), 'utf8'));
    const meta = { path: `${shardTrack}.json`, phraseCount: shard.phrases.length };
    const previousDerived = previousTracks[shardTrack]?.derivedFrom;
    if (previousDerived) meta.derivedFrom = previousDerived;
    tracks[shardTrack] = meta;
  }
  if (derivedFrom.length) tracks[track].derivedFrom = derivedFrom;
  const packVersion = new Date().toISOString().slice(0, 10);
  writeFileSync(
    resolve(outDir, 'manifest.json'),
    `${JSON.stringify({ schemaVersion: 1, packVersion, tracks }, null, 2)}\n`,
    'utf8'
  );

  console.log(`✓ ${track}: 新增 ${added} 条，更新释义 ${updated} 条，共 ${phrases.length} 条`);
  console.log(`  → ${shardPath}`);
  console.log(`  → manifest tracks: ${Object.keys(tracks).join(', ')}`);
}

function readShardFiles(dir) {
  try {
    return readdirSync(dir).filter(name => name.endsWith('.json'));
  } catch {
    return [];
  }
}

main();
