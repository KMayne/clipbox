import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { modulesManifest } from './vite/modulesManifest.ts';
import { pwa } from './vite/pwa.ts';

const manifest = modulesManifest();

export default defineConfig({
  // Served from a subpath in production (e.g. /clipbox/); the deploy sets BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  // pwa() emits the web app manifest and icons before modulesManifest() lists the core files
  plugins: [react(), pwa(), manifest.main],
  // Shown in Settings → Modules next to the build's version
  define: { __BUILD_DATE__: JSON.stringify(new Date().toISOString()) },
  worker: {
    format: 'es',
    plugins: () => [manifest.worker()],
    rolldownOptions: {
      output: {
        codeSplitting: {
          // One Mediabunny chunk for audiotools and the encoder modules: the encoders register
          // into Mediabunny's module state, so they must share its single copy
          groups: [
            // Vite's empty stand-in for Node built-ins, which other modules import too; its own
            // chunk keeps it from pulling them onto the Mediabunny chunk
            { name: 'browser-external', test: /__vite-browser-external/, priority: 1 },
            { name: 'mediabunny', test: /[\\/]node_modules[\\/]mediabunny[\\/]/ },
          ],
        },
      },
    },
  },
  // Agents' git worktrees live under .claude/worktrees; their builds would reload the page
  server: { watch: { ignored: ['**/.claude/**'] } },
  optimizeDeps: {
    // Only the app's own page; the default crawls every index.html, worktrees' dist/ included
    entries: ['index.html'],
    // Pre-bundle lazily-imported deps at startup, otherwise first use triggers a dev-server reload
    include: [
      '@vscode/vscode-languagedetection',
      '@peculiar/x509',
      'reflect-metadata',
      'music-metadata',
      'mediabunny',
      '@mediabunny/mp3-encoder',
      '@mediabunny/aac-encoder',
      'jsqr',
      'xlsx',
      'sql.js',
      'jq-wasm',
      'pdfjs-dist',
      'pdfjs-dist/build/pdf.worker.mjs',
      'fzstd',
      'utif2',
      'libheif-js/libheif-wasm/libheif.js',
      '7z-wasm/7zz.es6.js',
      'libarchive.js/src/webworker/wasm-module.js',
      'libarchive.js/src/webworker/archive-reader.js',
      'libarchive.js/src/webworker/wasm-gen/libarchive.js',
      'monaco-editor/editor/editor.api',
      'monaco-editor/languages/definitions/register.all',
      'monaco-editor/languages/features/json/register',
    ],
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
  },
});
