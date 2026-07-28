import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assertLexiconManifest } from '../src/lexicon.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');
export const DEFAULT_SOURCE_DIRECTORY = resolve(projectRoot, 'data', 'lexicon-sources');
export const DEFAULT_MANIFEST_PATH = resolve(projectRoot, 'public', 'data', 'lexicon-manifest.json');

function isInside(root, target) {
  const relativePath = relative(root, target);
  return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.includes(':'));
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertFetchableSource(source) {
  assertLexiconManifest({
    schemaVersion: 1,
    lexiconVersion: 'source-validation',
    sources: [source]
  });
}

function getSnapshotPath(sourceDir, source) {
  if (typeof source?.snapshotPath !== 'string' || !source.snapshotPath.trim()) {
    throw new Error(`来源 ${source?.id || '未知'} 缺少 snapshotPath，不能写入构建快照`);
  }
  const root = resolve(sourceDir);
  const snapshotPath = resolve(root, source.snapshotPath);
  if (!isInside(root, snapshotPath)) {
    throw new Error(`来源 ${source.id} 的 snapshotPath 超出来源目录`);
  }
  return snapshotPath;
}

/**
 * Downloads one immutable source and verifies bytes before creating its local
 * build cache entry. The cache is deliberately not shipped in the APK; only
 * the reviewed core artifact is.
 */
export async function fetchPinnedSource({
  source,
  sourceDir,
  fetchFn = globalThis.fetch,
  mkdirFn = mkdir,
  writeFileFn = writeFile
} = {}) {
  assertFetchableSource(source);
  if (typeof fetchFn !== 'function') throw new Error('词库快照获取需要 fetch 实现');

  const response = await fetchFn(source.url);
  if (!response?.ok) {
    throw new Error(`下载词库来源失败：${source.id}（HTTP ${response?.status || '未知'}）`);
  }
  if (typeof response.arrayBuffer !== 'function') {
    throw new Error(`下载词库来源失败：${source.id} 未返回字节流`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const actualSha256 = digest(bytes);
  const expectedSha256 = String(source.sha256 || '').toLowerCase();
  if (actualSha256 !== expectedSha256) {
    throw new Error(`来源 ${source.id} 的校验和不匹配：期望 ${expectedSha256}，实际 ${actualSha256}`);
  }
  if (bytes.byteLength !== source.byteSize) {
    throw new Error(`来源 ${source.id} 的字节数不匹配：期望 ${source.byteSize}，实际 ${bytes.byteLength}`);
  }

  const snapshotPath = getSnapshotPath(sourceDir, source);
  await mkdirFn(dirname(snapshotPath), { recursive: true });
  await writeFileFn(snapshotPath, bytes);
  return {
    id: source.id,
    snapshotPath: source.snapshotPath,
    sha256: actualSha256,
    byteSize: bytes.byteLength
  };
}

/**
 * Materializes every active manifest source into a local, checksum-verified
 * cache. It is intentionally sequential: a failed source never makes the
 * following source look verified in build logs.
 */
export async function fetchLexiconSourceSnapshots({
  manifest,
  sourceDir = DEFAULT_SOURCE_DIRECTORY,
  fetchFn = globalThis.fetch,
  mkdirFn = mkdir,
  writeFileFn = writeFile
} = {}) {
  assertLexiconManifest(manifest);
  const snapshots = [];
  for (const source of manifest.sources) {
    snapshots.push(await fetchPinnedSource({ source, sourceDir, fetchFn, mkdirFn, writeFileFn }));
  }
  return snapshots;
}

function argumentValue(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? resolve(args[index + 1]) : fallback;
}

async function runCli() {
  const args = process.argv.slice(2);
  const manifestPath = argumentValue(args, '--manifest', DEFAULT_MANIFEST_PATH);
  const sourceDir = argumentValue(args, '--source-dir', DEFAULT_SOURCE_DIRECTORY);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const snapshots = await fetchLexiconSourceSnapshots({ manifest, sourceDir });
  process.stdout.write(`${JSON.stringify({ manifestPath, sourceDir, snapshots }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
