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

function extractRows(source) {
  const trimmed = String(source || '').trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    const rows = Array.isArray(parsed) ? parsed : parsed.phrases;
    if (!Array.isArray(rows)) throw new Error('JSON 资料需要是数组或含 phrases 数组的对象');
    return rows.map(row => {
      if (typeof row === 'string') return parseRow(row);
      return { phrase: row?.phrase ?? row?.p ?? row?.word, gloss: row?.gloss ?? row?.g ?? row?.glossZh ?? row?.translation ?? '' };
    });
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

function main() {
  const inputPath = parseArg('input');
  const track = normalizeTrack(parseArg('track'));
  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', parseArg('out') || 'public/data/key-phrases');
  if (!inputPath || !existsSync(inputPath)) {
    console.error('用法：node scripts/build-key-phrases.mjs --input <资料文件> [--track general]');
    process.exit(1);
  }
  if (!KNOWN_TRACKS.has(track)) {
    console.error(`未知 track：${track}（可用：general/cet4/cet6/kaoyan）`);
    process.exit(1);
  }

  const rows = extractRows(readFileSync(inputPath, 'utf8'));
  const shardPath = resolve(outDir, `${track}.json`);
  const merged = readExistingShard(shardPath, track);
  let added = 0;
  let updated = 0;
  for (const row of rows) {
    const phrase = normalizeText(row?.phrase);
    if (!phrase) continue;
    const id = normalizeId(phrase);
    const gloss = normalizeText(row?.gloss || '');
    const existing = merged.get(id);
    if (!existing) {
      merged.set(id, { phrase, gloss });
      added += 1;
    } else if (gloss && gloss !== existing.gloss) {
      merged.set(id, { phrase, gloss });
      updated += 1;
    }
  }

  const phrases = [...merged.values()]
    .sort((left, right) => normalizeId(left.phrase).localeCompare(normalizeId(right.phrase), 'en-US'))
    .map(entry => ({ p: entry.phrase, g: entry.gloss }));

  mkdirSync(outDir, { recursive: true });
  writeFileSync(shardPath, `${JSON.stringify({ schemaVersion: 1, track, phrases }, null, 2)}\n`, 'utf8');

  const tracks = {};
  for (const file of existsSync(outDir) ? readShardFiles(outDir) : []) {
    const shardTrack = file.replace(/\.json$/, '');
    if (shardTrack === 'manifest') continue;
    const shard = JSON.parse(readFileSync(resolve(outDir, file), 'utf8'));
    tracks[shardTrack] = { path: `${shardTrack}.json`, phraseCount: shard.phrases.length };
  }
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
