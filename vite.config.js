import { defineConfig } from 'vite';
import { resolve } from 'path';
import { cpSync, existsSync, mkdirSync } from 'fs';

// Custom plugin to copy src/ JS files to output (non-module)
function copySrcPlugin() {
  return {
    name: 'copy-src',
    writeBundle() {
      const srcDir = resolve(__dirname, 'src');
      const outDir = resolve(__dirname, 'www/src');
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

      const copyDir = (src, dest) => {
        for (const entry of require('fs').readdirSync(src, { withFileTypes: true })) {
          const srcPath = resolve(src, entry.name);
          const destPath = resolve(dest, entry.name);
          if (entry.isDirectory()) {
            if (!existsSync(destPath)) mkdirSync(destPath, { recursive: true });
            copyDir(srcPath, destPath);
          } else {
            cpSync(srcPath, destPath);
          }
        }
      };
      copyDir(srcDir, outDir);
    }
  };
}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'www',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
  plugins: [copySrcPlugin()],
  server: {
    port: 3000,
  },
});
