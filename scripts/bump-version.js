const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packagePath = path.join(root, 'package.json');
const packageLockPath = path.join(root, 'package-lock.json');
const androidBuildPath = path.join(root, 'android', 'app', 'build.gradle');
const versionJsonPath = path.join(root, 'version.json');

function bumpVersion(version, releaseType) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`不支持的版本号：${version}`);
  const [, major, minor, patch] = match.map(Number);
  if (releaseType === 'patch') return `${major}.${minor}.${patch + 1}`;
  if (releaseType === 'minor') return `${major}.${minor + 1}.0`;
  throw new Error('版本类型只能是 patch（小更新）或 minor（大更新）');
}

function getAndroidVersionCode(buildGradle) {
  const codeMatch = /versionCode\s+(\d+)/.exec(buildGradle);
  if (!codeMatch) {
    throw new Error('无法在 android/app/build.gradle 中找到 versionCode');
  }
  return Number(codeMatch[1]);
}

function withAndroidVersion(buildGradle, version, versionCode = getAndroidVersionCode(buildGradle) + 1) {
  const codeMatch = /versionCode\s+(\d+)/.exec(buildGradle);
  if (!codeMatch || !/versionName\s+["'][^"']+["']/.test(buildGradle)) {
    throw new Error('无法在 android/app/build.gradle 中找到 versionCode 或 versionName');
  }
  return buildGradle
    .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
    .replace(/versionName\s+["'][^"']+["']/, `versionName "${version}"`);
}

function getReleaseVersion(packageVersion, buildGradle) {
  return /versionName\s+["']([^"']+)["']/.exec(buildGradle)?.[1] || packageVersion;
}

function withVersionManifest(manifest, version, versionCode, buildDate) {
  return {
    ...manifest,
    version,
    versionCode,
    buildDate
  };
}

function getPackageLockVersion(packageLock) {
  return packageLock?.packages?.['']?.version || packageLock?.version || null;
}

function assertReleaseMetadata(packageJson, buildGradle, versionManifest, packageLock) {
  const version = packageJson?.version;
  const gradleVersion = getReleaseVersion(version, buildGradle);
  const versionCode = getAndroidVersionCode(buildGradle);
  const errors = [];

  if (version !== gradleVersion) errors.push('package.json 与 android/app/build.gradle 的版本号不一致');
  if (versionManifest?.version !== version || Number(versionManifest?.versionCode) !== versionCode) {
    errors.push('version.json 与当前发布版本不一致');
  }

  if (packageLock && getPackageLockVersion(packageLock) !== version) {
    errors.push('package-lock.json 与 package.json 的版本号不一致');
  }

  if (errors.length) {
    throw new Error(`发布版本元数据不一致：${errors.join('；')}`);
  }

  return { version, versionCode };
}

function writeVersion(releaseType) {
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const buildGradle = fs.readFileSync(androidBuildPath, 'utf8');
  const nextVersion = bumpVersion(getReleaseVersion(packageJson.version, buildGradle), releaseType);
  const nextCode = getAndroidVersionCode(buildGradle) + 1;
  packageJson.version = nextVersion;
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

  if (fs.existsSync(packageLockPath)) {
    const packageLock = JSON.parse(fs.readFileSync(packageLockPath, 'utf8'));
    packageLock.version = nextVersion;
    if (packageLock.packages?.['']) packageLock.packages[''].version = nextVersion;
    fs.writeFileSync(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`, 'utf8');
  }

  fs.writeFileSync(androidBuildPath, withAndroidVersion(buildGradle, nextVersion, nextCode), 'utf8');

  const versionManifest = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
  fs.writeFileSync(versionJsonPath, `${JSON.stringify(
    withVersionManifest(versionManifest, nextVersion, nextCode, new Date().toISOString().slice(0, 10)),
    null,
    2
  )}\n`, 'utf8');

  return nextVersion;
}

if (require.main === module) {
  const nextVersion = writeVersion(process.argv[2]);
  console.log(`版本已更新至 ${nextVersion}`);
}

module.exports = {
  assertReleaseMetadata,
  bumpVersion,
  getAndroidVersionCode,
  getPackageLockVersion,
  getReleaseVersion,
  withAndroidVersion,
  withVersionManifest,
  writeVersion
};
