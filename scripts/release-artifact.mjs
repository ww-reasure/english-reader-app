import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE_FLAVORS } from '../src/exam/home-visibility.mjs';

const PRIVATE_ROOT = 'exam-packs/private';
const REQUIRED_PRIVATE_PACKAGE_ID = 'local.kaoyan.en1';
const RAW_PRIVATE_SEGMENTS = ['private_exam_sources', 'raw'];

function fail(message) {
  throw new Error(`Release artifact invalid: ${message}`);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${label} is missing or invalid JSON (${error.message})`);
  }
}

function normalizeArtifactPath(value) {
  const text = String(value || '').replaceAll('\\', '/');
  if (!text || text === '/' || text.startsWith('//') || /^[A-Za-z]:\//.test(text)) {
    fail(`absolute or empty pack path: ${value}`);
  }
  const normalized = normalize(text.replace(/^\//, '')).replaceAll('\\', '/');
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    fail(`pack path escapes artifact: ${value}`);
  }
  return normalized.replace(/^\//, '');
}

function listFiles(root, current = root) {
  if (!existsSync(current)) return [];
  return readdirSync(current, { withFileTypes: true }).flatMap(entry => {
    const path = join(current, entry.name);
    if (entry.isDirectory()) return listFiles(root, path);
    if (!entry.isFile()) return [];
    return [relative(root, path).split(sep).join('/')];
  });
}

function assertNoRawPrivateSources(artifactDir) {
  for (const path of listFiles(artifactDir)) {
    const lower = path.toLowerCase();
    const segments = lower.split('/');
    const isPrivatePath = RAW_PRIVATE_SEGMENTS.some(segment => segments.includes(segment));
    const isPrivatePackSource = lower.startsWith(`${PRIVATE_ROOT}/`) && /\.(md|markdown|pdf)$/i.test(lower);
    if (isPrivatePath || isPrivatePackSource) {
      fail(`raw private source path is present: ${path}`);
    }
  }
}

function assertManifest(manifest, flavor, expectedVersion, expectedVersionCode) {
  if (!manifest || manifest.schemaVersion !== 1) fail('release-manifest.json schemaVersion must be 1');
  if (manifest.flavor !== flavor) fail(`manifest flavor ${manifest.flavor} does not match ${flavor}`);
  if (String(manifest.version) !== String(expectedVersion)) fail(`manifest version ${manifest.version} does not match ${expectedVersion}`);
  if (Number(manifest.versionCode) !== Number(expectedVersionCode)) fail(`manifest versionCode ${manifest.versionCode} does not match ${expectedVersionCode}`);
  const expectedPrivate = flavor === 'private-qa';
  if (Boolean(manifest.privateExamPacksIncluded) !== expectedPrivate) {
    fail(`manifest privateExamPacksIncluded must be ${expectedPrivate}`);
  }
  const expectedDistribution = expectedPrivate ? 'internal-authorized' : 'public';
  if (manifest.distribution !== expectedDistribution) fail(`manifest distribution must be ${expectedDistribution}`);
}

function assertPrivatePacks(artifactDir, requiredPrivatePackageId) {
  const privateDir = join(artifactDir, PRIVATE_ROOT.replaceAll('/', sep));
  const indexPath = join(privateDir, 'index.json');
  if (!existsSync(indexPath)) fail('private exam pack index is missing');
  const index = readJson(indexPath, 'private exam pack index');
  if (index.schemaVersion !== 1 || !Array.isArray(index.packs)) fail('private exam pack index schema is invalid');

  const packageIds = [];
  for (const entry of index.packs) {
    if (!entry || typeof entry.packageId !== 'string') fail('private pack entry has no packageId');
    const packPath = normalizeArtifactPath(entry.path);
    const expectedPrefix = `${PRIVATE_ROOT}/`;
    if (!packPath.startsWith(expectedPrefix)) fail(`private pack path is outside ${PRIVATE_ROOT}: ${entry.path}`);
    const absolutePath = join(artifactDir, packPath.replaceAll('/', sep));
    if (!existsSync(absolutePath) || !lstatSync(absolutePath).isFile()) fail(`indexed pack is missing: ${entry.packageId}`);
    packageIds.push(entry.packageId);
  }

  if (!packageIds.includes(requiredPrivatePackageId)) {
    fail(`missing required private pack ${requiredPrivatePackageId}`);
  }

  const declaredPaths = new Set(['index.json']);
  for (const entry of index.packs) {
    const packPath = normalizeArtifactPath(entry.path);
    declaredPaths.add(packPath.slice(`${PRIVATE_ROOT}/`.length));
  }
  for (const file of listFiles(privateDir)) {
    if (!declaredPaths.has(file)) {
      fail(`undeclared private pack file is present: ${file}`);
    }
  }

  return packageIds;
}

export function assertReleaseArtifact({
  artifactDir,
  flavor,
  expectedVersion,
  expectedVersionCode,
  requiredPrivatePackageId = REQUIRED_PRIVATE_PACKAGE_ID
}) {
  if (!RELEASE_FLAVORS.includes(flavor)) fail(`unsupported flavor ${flavor}`);
  if (!artifactDir) fail('artifactDir is required');

  const manifest = readJson(join(artifactDir, 'release-manifest.json'), 'release-manifest.json');
  assertManifest(manifest, flavor, expectedVersion, expectedVersionCode);
  assertNoRawPrivateSources(artifactDir);

  const privateRoot = join(artifactDir, PRIVATE_ROOT.replaceAll('/', sep));
  if (flavor === 'public' && existsSync(privateRoot)) fail('private exam pack directory is present in public artifact');
  const packs = flavor === 'private-qa' ? assertPrivatePacks(artifactDir, requiredPrivatePackageId) : [];

  return {
    flavor,
    version: String(manifest.version),
    versionCode: Number(manifest.versionCode),
    packs
  };
}

function parseArgs(argv) {
  const dirIndex = argv.indexOf('--dir');
  const flavorIndex = argv.indexOf('--flavor');
  return {
    artifactDir: dirIndex >= 0 ? argv[dirIndex + 1] : 'www',
    flavor: flavorIndex >= 0 ? argv[flavorIndex + 1] : 'private-qa'
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const { artifactDir, flavor } = parseArgs(process.argv.slice(2));
    const packageJson = readJson('package.json', 'package.json');
    const versionManifest = readJson('version.json', 'version.json');
    const result = assertReleaseArtifact({
      artifactDir,
      flavor,
      expectedVersion: packageJson.version,
      expectedVersionCode: versionManifest.versionCode
    });
    process.stdout.write(`Release artifact PASS: ${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

export {
  PRIVATE_ROOT,
  REQUIRED_PRIVATE_PACKAGE_ID,
  normalizeArtifactPath,
  parseArgs
};
