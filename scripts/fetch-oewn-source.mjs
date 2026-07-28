import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  DEFAULT_OEWN_MANIFEST_PATH,
  DEFAULT_SOURCE_DIRECTORY,
  assertOewnArtifactSource
} from './build-oewn-artifact.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');

function isInside(root, target) {
  const relativePath = relative(root, target);
  return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.includes(':'));
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function snapshotPathFor(sourceDir, source) {
  const root = resolve(sourceDir);
  const snapshotPath = resolve(root, source.snapshotPath);
  if (!isInside(root, snapshotPath)) {
    throw new Error(`OEWN 来源 ${source.id} 的 snapshotPath 超出来源目录`);
  }
  return snapshotPath;
}

/**
 * Downloads the one officially pinned OEWN archive. Bytes are checked before
 * the ignored local cache is written, so a changed host asset cannot silently
 * alter the shipped derivative.
 */
export async function fetchPinnedOewnSource({
  source,
  sourceDir = DEFAULT_SOURCE_DIRECTORY,
  fetchFn = globalThis.fetch,
  mkdirFn = mkdir,
  writeFileFn = writeFile
} = {}) {
  assertOewnArtifactSource(source);
  if (typeof fetchFn !== 'function') throw new Error('OEWN 快照获取需要 fetch 实现');

  const response = await fetchFn(source.url);
  if (!response?.ok || typeof response.arrayBuffer !== 'function') {
    throw new Error(`下载 OEWN 来源失败：${source.id}（HTTP ${response?.status || '未知'}）`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualSha256 = digest(bytes);
  if (actualSha256 !== source.sha256.toLowerCase()) {
    throw new Error(`OEWN 来源校验和不匹配：期望 ${source.sha256.toLowerCase()}，实际 ${actualSha256}`);
  }
  if (bytes.byteLength !== source.byteSize) {
    throw new Error(`OEWN 来源字节数不匹配：期望 ${source.byteSize}，实际 ${bytes.byteLength}`);
  }

  const snapshotPath = snapshotPathFor(sourceDir, source);
  await mkdirFn(dirname(snapshotPath), { recursive: true });
  await writeFileFn(snapshotPath, bytes);
  return {
    id: source.id,
    snapshotPath: source.snapshotPath,
    sha256: actualSha256,
    byteSize: bytes.byteLength
  };
}

function argumentValue(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? resolve(args[index + 1]) : fallback;
}

async function runCli() {
  const args = process.argv.slice(2);
  const manifestPath = argumentValue(args, '--manifest', DEFAULT_OEWN_MANIFEST_PATH);
  const sourceDir = argumentValue(args, '--source-dir', DEFAULT_SOURCE_DIRECTORY);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const snapshot = await fetchPinnedOewnSource({ source: manifest?.source, sourceDir });
  process.stdout.write(`${JSON.stringify({ manifestPath, sourceDir, snapshot }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
