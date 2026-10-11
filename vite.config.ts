import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { modulesManifest } from './vite/modulesManifest';

const manifest = modulesManifest();

export default defineConfig({
  // Served from a subpath in production (e.g. /clipbox/); the deploy sets BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), manifest.main],
  worker: { format: 'es', plugins: () => [manifest.worker()] },
  optimizeDeps: {
    // Pre-bundle lazily-imported deps at startup, otherwise first use triggers a dev-server reload
    include: [
      '@vscode/vscode-languagedetection',
      '@peculiar/x509',
      'reflect-metadata',
      'music-metadata',
      'monaco-editor/editor/editor.api',
      'monaco-editor/languages/definitions/register.all',
      'monaco-editor/languages/features/json/register',
    ],
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
  },
});
