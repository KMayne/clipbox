/**
 * The main third-party library behind each lazily-loaded module: a display name and the npm
 * package the build reads its version from (vite/modulesManifest.ts).
 *
 * No imports: the Vite config loads this file directly with Node's type stripping.
 */
export interface ModuleLibrary {
  name: string;
  package: string;
  /** SPDX licence of what the module ships, including code compiled into its WASM. */
  license: string;
}

export const moduleLibraries: Record<string, ModuleLibrary> = {
  editor: { name: 'Monaco', package: 'monaco-editor', license: 'MIT' },
  langdetect: {
    name: 'vscode-languagedetection',
    package: '@vscode/vscode-languagedetection',
    license: 'MIT',
  },
  x509: { name: '@peculiar/x509', package: '@peculiar/x509', license: 'MIT' },
  media: { name: 'music-metadata', package: 'music-metadata', license: 'MIT' },
  // SheetJS is installed from its CDN tarball, which still unpacks a package.json with a version
  sheets: { name: 'SheetJS', package: 'xlsx', license: 'Apache-2.0' },
  sqlite: { name: 'sql.js', package: 'sql.js', license: 'MIT' },
  pdf: { name: 'pdf.js', package: 'pdfjs-dist', license: 'Apache-2.0' },
  libarchive: {
    name: 'libarchive.js',
    package: 'libarchive.js',
    license: 'MIT; libarchive BSD-2-Clause',
  },
  audiotools: { name: 'Mediabunny', package: 'mediabunny', license: 'MPL-2.0' },
  qr: { name: 'jsQR', package: 'jsqr', license: 'Apache-2.0' },
  imageformats: { name: 'UTIF.js', package: 'utif2', license: 'MIT' },
  jq: { name: 'jq-wasm', package: 'jq-wasm', license: 'MIT' },
  heic: { name: 'libheif', package: 'libheif-js', license: 'LGPL-3.0' },
  mp3encoder: {
    name: '@mediabunny/mp3-encoder (LAME)',
    package: '@mediabunny/mp3-encoder',
    license: 'MPL-2.0; LAME LGPL-2.0',
  },
  aacencoder: {
    name: '@mediabunny/aac-encoder (FFmpeg)',
    package: '@mediabunny/aac-encoder',
    license: 'MPL-2.0; FFmpeg LGPL-2.1',
  },
  sevenzip: {
    name: '7-Zip (7z-wasm)',
    package: '7z-wasm',
    license: 'LGPL-2.1 + unRAR restriction',
  },
  wabt: { name: 'wabt.js', package: 'wabt', license: 'Apache-2.0' },
};
