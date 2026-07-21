const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packagePath = path.join(root, 'package.json');
const packageLockPath = path.join(root, 'package-lock.json');
const androidBuildPath = path.join(root, 'android', 'app', 'build.gradle');

function bumpVersion(version, releaseType) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`不支持的版本号：${version}`);
  const [, major, minor, patch] = match.map(Number);
  if (releaseType === 'patch') return `${major}.${minor}.${patch + 1}`;
  if (releaseType === 'minor') return `${major}.${minor + 1}.0`;
  throw new Error('版本类型只能是 patch（小更新）或 minor（大更新）');
}

function withAndroidVersion(buildGradle, version) {
  const codeMatch = /versionCode\s+(\d+)/.exec(buildGradle);
  if (!codeMatch || !/versionName\s+["'][^"']+["']/.test(buildGradle)) {
    throw new Error('无法在 android/app/build.gradle 中找到 versionCode 或 versionName');
  }
  const nextCode = Number(codeMatch[1]) + 1;
  return buildGradle
    .replace(/versionCode\s+\d+/, `versionCode ${nextCode}`)
    .replace(/versionName\s+["'][^"']+["']/, `versionName "${version}"`);
}

function getReleaseVersion(packageVersion, buildGradle) {
  return /versionName\s+["']([^"']+)["']/.exec(buildGradle)?.[1] || packageVersion;
}

function writeVersion(releaseType) {
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const buildGradle = fs.readFileSync(androidBuildPath, 'utf8');
  const nextVersion = bumpVersion(getReleaseVersion(packageJson.version, buildGradle), releaseType);
  packageJson.version = nextVersion;
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

  if (fs.existsSync(packageLockPath)) {
    const packageLock = JSON.parse(fs.readFileSync(packageLockPath, 'utf8'));
    packageLock.version = nextVersion;
    if (packageLock.packages?.['']) packageLock.packages[''].version = nextVersion;
    fs.writeFileSync(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`, 'utf8');
  }

  fs.writeFileSync(androidBuildPath, withAndroidVersion(buildGradle, nextVersion), 'utf8');
  return nextVersion;
}

if (require.main === module) {
  const nextVersion = writeVersion(process.argv[2]);
  console.log(`版本已更新至 ${nextVersion}`);
}

module.exports = { bumpVersion, getReleaseVersion, withAndroidVersion, writeVersion };
