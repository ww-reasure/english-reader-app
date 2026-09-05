import { defineConfig } from 'vite';
import { resolve } from 'path';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';

const PRIVATE_PACK_PREFIX = 'exam-packs/private/';

function shouldCopyPublicAsset(relativePath, includePrivatePacks) {
  if (relativePath === 'index.html') return false;
  return includePrivatePacks
    || (relativePath !== PRIVATE_PACK_PREFIX.slice(0, -1) && !relativePath.startsWith(PRIVATE_PACK_PREFIX));
}

function copyDir(src, dest, relativeRoot = src, shouldCopy = () => true) {
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = resolve(src, entry.name);
    const destPath = resolve(dest, entry.name);
    const relativePath = resolve(relativeRoot, srcPath).replace(`${resolve(relativeRoot)}\\`, '').replaceAll('\\', '/');
    if (!shouldCopy(relativePath)) continue;
    if (entry.isDirectory()) {
      if (!existsSync(destPath)) mkdirSync(destPath, { recursive: true });
      copyDir(srcPath, destPath, relativeRoot, shouldCopy);
    } else {
      cpSync(srcPath, destPath);
    }
  }
}

function releaseArtifactPlugin({ flavor }) {
  const includePrivatePacks = flavor === 'private-qa';
  return {
    name: 'release-artifact-boundary',
    writeBundle() {
      const publicDir = resolve(__dirname, 'public');
      const outDir = resolve(__dirname, 'www');
      copyDir(publicDir, outDir, publicDir, relativePath => shouldCopyPublicAsset(relativePath, includePrivatePacks));

      const packageJson = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'));
      const versionManifest = JSON.parse(readFileSync(resolve(__dirname, 'version.json'), 'utf8'));
      // 按实际产物声明：没有私有题包目录时不得宣称包含它们。
      const privateExamPacksIncluded = includePrivatePacks && existsSync(resolve(publicDir, 'exam-packs', 'private'));
      writeFileSync(resolve(outDir, 'release-manifest.json'), `${JSON.stringify({
        schemaVersion: 1,
        flavor,
        version: packageJson.version,
        versionCode: Number(versionManifest.versionCode),
        privateExamPacksIncluded,
        distribution: includePrivatePacks ? 'internal-authorized' : 'public'
      }, null, 2)}\n`, 'utf8');
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const flavor = mode === 'private-qa' ? 'private-qa' : 'public';
  return {
    root: '.',
    publicDir: command === 'serve' ? 'public' : false,
    build: {
      outDir: 'www',
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(__dirname, 'index.html'),
      },
    },
    plugins: [releaseArtifactPlugin({ flavor })],
    server: {
      port: 3000,
      // Worktree dev servers resolve npm packages from the parent repository's
      // node_modules. Allow serving those fonts/assets so Font Awesome icons do
      // not 403 (which makes every fa-* icon disappear).
      fs: {
        allow: ['..', '../..']
      }
    },
  };
});
