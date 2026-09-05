import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = new URL('../scripts/build-key-phrases.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function makeWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'key-phrases-test-'));
  return { dir, out: join(dir, 'out') };
}

function run(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}

function writeCsv(dir, rows) {
  const path = join(dir, `input-${Math.random().toString(36).slice(2)}.csv`);
  writeFileSync(path, `\ufeff序号,词组,释义,页码\n${rows.join('\n')}\n`, 'utf8');
  return path;
}

function readShard(out, track) {
  return JSON.parse(readFileSync(join(out, `${track}.json`), 'utf8'));
}

test('parses quoted CSV rows, skips the header and auto-detects columns', () => {
  const { dir, out } = makeWorkspace();
  try {
    const csv = writeCsv(dir, [
      '1,carry out,"phrv. 执行；实施, 落实",2',
      '2,deal with,usage. 处理,3'
    ]);
    const result = run(['--input', csv, '--track', 'cet4', '--out', out]);
    assert.equal(result.status, 0, result.stderr);
    const shard = readShard(out, 'cet4');
    assert.deepEqual(shard.phrases, [
      { p: 'carry out', g: 'phrv. 执行；实施, 落实' },
      { p: 'deal with', g: 'usage. 处理' }
    ]);
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    assert.equal(manifest.tracks.cet4.phraseCount, 2);
    assert.equal(manifest.tracks.cet4.derivedFrom, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('re-imports merge by normalized phrase: new gloss wins, empty gloss keeps the old one', () => {
  const { dir, out } = makeWorkspace();
  try {
    const first = writeCsv(dir, ['1,carry out,phrv. 执行,2']);
    assert.equal(run(['--input', first, '--track', 'cet4', '--out', out]).status, 0);
    const second = writeCsv(dir, ['1,carry out,phrv. 执行；落实,3', '2,ward off,phrv. 避开,4']);
    assert.equal(run(['--input', second, '--track', 'cet4', '--out', out]).status, 0);
    const third = writeCsv(dir, ['1,carry out,,5']);
    assert.equal(run(['--input', third, '--track', 'cet4', '--out', out]).status, 0);
    const shard = readShard(out, 'cet4');
    const carry = shard.phrases.find(row => row.p === 'carry out');
    assert.equal(carry.g, 'phrv. 执行；落实', 'non-empty gloss must overwrite');
    assert.equal(shard.phrases.filter(row => row.p === 'carry out').length, 1, 'deduped by normalized id');
    assert.ok(shard.phrases.some(row => row.p === 'ward off' && row.g === 'phrv. 避开'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('expands slash alternations and parenthetical optionals into matchable variants', () => {
  const { dir, out } = makeWorkspace();
  try {
    const csv = writeCsv(dir, [
      '1,aim at/for sth,瞄准,1',
      '2,keep (on) doing sth,继续做,2'
    ]);
    assert.equal(run(['--input', csv, '--track', 'kaoyan', '--out', out]).status, 0);
    const shard = readShard(out, 'kaoyan');
    const phrases = shard.phrases.map(row => row.p);
    assert.deepEqual(phrases.sort(), ['aim at sth', 'aim for sth', 'keep doing sth', 'keep on doing sth']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unknown tracks exit non-zero and derivedFrom lands only on the requested track', () => {
  const { dir, out } = makeWorkspace();
  try {
    const csv = writeCsv(dir, ['1,carry out,phrv. 执行,2']);
    const bad = run(['--input', csv, '--track', 'gre', '--out', out]);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /未知 track/);
    assert.equal(run(['--input', csv, '--track', 'kaoyan', '--out', out]).status, 0);
    assert.equal(run(['--input', csv, '--track', 'general', '--out', out, '--derived-from', 'cet4,kaoyan']).status, 0);
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest.tracks.general.derivedFrom, ['cet4', 'kaoyan']);
    assert.equal(manifest.tracks.kaoyan.derivedFrom, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('derivedFrom carries forward on later flag-less runs and glue fixups apply', () => {
  const { dir, out } = makeWorkspace();
  try {
    const first = writeCsv(dir, ['1,carry out,phrv. 执行,2']);
    assert.equal(run(['--input', first, '--track', 'general', '--out', out, '--derived-from', 'cet4,kaoyan']).status, 0);
    const second = writeCsv(dir, ['1,be accessibleto sb,usage. 可访问的,2']);
    assert.equal(run(['--input', second, '--track', 'general', '--out', out]).status, 0);
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest.tracks.general.derivedFrom, ['cet4', 'kaoyan'], 'carry-forward must survive flag-less runs');
    const shard = readShard(out, 'general');
    assert.ok(shard.phrases.some(row => row.p === 'be accessible to sb'), 'glued entry must be fixed');
    assert.ok(!shard.phrases.some(row => row.p === 'be accessibleto sb'), 'glued entry must not remain');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
