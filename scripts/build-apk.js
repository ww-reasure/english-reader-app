const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { assertReleaseMetadata } = require('./bump-version.js');

const PRIVATE_QA_FLAVOR = 'private-qa';

function getGradleCommand(platform = process.platform) {
  return {
    command: platform === 'win32' ? 'gradlew.bat' : './gradlew',
    args: ['assembleDebug']
  };
}

function getAndroidProjectDirectory() {
  return path.resolve(__dirname, '..', 'android');
}

function getProjectDirectory() {
  return path.resolve(__dirname, '..');
}

function getReleaseApkPath({ projectDirectory = getProjectDirectory(), version, versionCode, flavor }) {
  if (flavor !== PRIVATE_QA_FLAVOR) {
    throw new Error('APK 构建只允许使用 --flavor private-qa');
  }
  return path.resolve(projectDirectory, '..', '..', `EnglishReader-private-qa-v${version}-${versionCode}-debug.apk`);
}

function parseBuildOptions(argv = process.argv) {
  const flavorIndex = argv.indexOf('--flavor');
  const flavor = flavorIndex >= 0 ? argv[flavorIndex + 1] : null;
  if (flavor !== PRIVATE_QA_FLAVOR) {
    throw new Error('APK 构建必须显式指定 --flavor private-qa');
  }
  return { flavor };
}

function assertBuildReleaseMetadata(packageJson, buildGradle, versionManifest, packageLock) {
  return assertReleaseMetadata(packageJson, buildGradle, versionManifest, packageLock);
}

function preflightBuildReleaseMetadata() {
  const projectDirectory = getProjectDirectory();
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectDirectory, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(fs.readFileSync(path.join(projectDirectory, 'package-lock.json'), 'utf8'));
  const buildGradle = fs.readFileSync(path.join(projectDirectory, 'android', 'app', 'build.gradle'), 'utf8');
  const versionManifest = JSON.parse(fs.readFileSync(path.join(projectDirectory, 'version.json'), 'utf8'));
  return assertBuildReleaseMetadata(packageJson, buildGradle, versionManifest, packageLock);
}

function withAndroidNamespace(buildGradle, namespace) {
  if (/^\s*namespace\s*(?:=|\s)/m.test(buildGradle)) return buildGradle;
  return buildGradle.replace(/android\s*\{/, match => `${match}\n    namespace '${namespace}'`);
}

function ensureLegacyTextToSpeechNamespace() {
  const pluginRoot = path.resolve(__dirname, '..', 'node_modules', '@capacitor-community', 'text-to-speech', 'android');
  const buildGradlePath = path.join(pluginRoot, 'build.gradle');
  const manifestPath = path.join(pluginRoot, 'src', 'main', 'AndroidManifest.xml');
  if (!fs.existsSync(buildGradlePath) || !fs.existsSync(manifestPath)) return false;

  const manifest = fs.readFileSync(manifestPath, 'utf8');
  const namespace = manifest.match(/\bpackage\s*=\s*["']([^"']+)["']/)?.[1];
  if (!namespace) return false;

  const current = fs.readFileSync(buildGradlePath, 'utf8');
  const updated = withAndroidNamespace(current, namespace);
  if (updated === current) return false;
  fs.writeFileSync(buildGradlePath, updated, 'utf8');
  return true;
}

function getGradleApkPath() {
  return path.join(getAndroidProjectDirectory(), 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
}

function getSourceContext(projectDirectory) {
  const runGit = args => {
    try {
      return require('node:child_process').execFileSync('git', args, {
        cwd: projectDirectory,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
    } catch {
      return null;
    }
  };
  return {
    sourceRevision: runGit(['rev-parse', 'HEAD']),
    sourceDirty: Boolean(runGit(['status', '--porcelain']))
  };
}

function writeApkEvidence({ outputPath, projectDirectory, version, versionCode, flavor }) {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex').toUpperCase();
  const checksumPath = `${outputPath}.sha256`;
  fs.writeFileSync(checksumPath, `${digest}  ${path.basename(outputPath)}\n`, 'utf8');
  return {
    apkPath: outputPath,
    checksumPath,
    sha256: digest,
    version,
    versionCode,
    flavor,
    ...getSourceContext(projectDirectory)
  };
}

async function buildApk({ flavor = PRIVATE_QA_FLAVOR } = {}) {
  if (flavor !== PRIVATE_QA_FLAVOR) {
    throw new Error('APK 构建只允许使用 --flavor private-qa');
  }
  const releaseMetadata = preflightBuildReleaseMetadata();
  const projectDirectory = getProjectDirectory();
  const artifactModule = await import('./release-artifact.mjs');
  const artifactResult = artifactModule.assertReleaseArtifact({
    artifactDir: path.join(projectDirectory, 'www'),
    flavor,
    expectedVersion: releaseMetadata.version,
    expectedVersionCode: releaseMetadata.versionCode
  });
  ensureLegacyTextToSpeechNamespace();
  const { command, args } = getGradleCommand();
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: getAndroidProjectDirectory(),
      shell: process.platform === 'win32',
      stdio: 'inherit'
    });
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`Android Debug 构建失败（退出码 ${code ?? 'unknown'}）`));
    });
  });

  const verifyApkModule = await import('./verify-apk-artifact.mjs');
  await verifyApkModule.verifyApk(
    getGradleApkPath(),
    flavor,
    releaseMetadata.version,
    releaseMetadata.versionCode
  );

  const outputPath = getReleaseApkPath({
    projectDirectory,
    version: releaseMetadata.version,
    versionCode: releaseMetadata.versionCode,
    flavor
  });
  fs.copyFileSync(getGradleApkPath(), outputPath);
  const evidence = writeApkEvidence({
    outputPath,
    projectDirectory,
    version: releaseMetadata.version,
    versionCode: releaseMetadata.versionCode,
    flavor
  });
  process.stdout.write(`Release artifact PASS: ${JSON.stringify(artifactResult)}\n`);
  process.stdout.write(`APK evidence: ${JSON.stringify(evidence)}\n`);
  return evidence;
}

if (require.main === module) {
  let options;
  try {
    options = parseBuildOptions(process.argv);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
  if (options) {
    buildApk(options).catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}

module.exports = {
  assertBuildReleaseMetadata,
  buildApk,
  ensureLegacyTextToSpeechNamespace,
  getAndroidProjectDirectory,
  getGradleApkPath,
  getGradleCommand,
  getReleaseApkPath,
  getProjectDirectory,
  getSourceContext,
  parseBuildOptions,
  preflightBuildReleaseMetadata,
  writeApkEvidence,
  withAndroidNamespace
};
