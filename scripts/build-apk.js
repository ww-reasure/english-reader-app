const { spawn } = require('node:child_process');
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

function buildApk() {
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

module.exports = { buildApk, getAndroidProjectDirectory, getGradleCommand };
