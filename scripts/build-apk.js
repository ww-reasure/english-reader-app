const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function getGradleCommand(platform = process.platform) {
  return {
    command: platform === 'win32' ? 'gradlew.bat' : './gradlew',
    args: ['assembleDebug']
  };
}

function getAndroidProjectDirectory() {
  return path.resolve(__dirname, '..', 'android');
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

function buildApk() {
  ensureLegacyTextToSpeechNamespace();
  const { command, args } = getGradleCommand();
  return new Promise((resolve, reject) => {
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
}

if (require.main === module) {
  buildApk().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { buildApk, ensureLegacyTextToSpeechNamespace, getAndroidProjectDirectory, getGradleCommand, withAndroidNamespace };
