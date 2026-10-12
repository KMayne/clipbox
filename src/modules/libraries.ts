/**
 * The main third-party library behind each lazily-loaded module: a display name and the npm
 * package the build reads its version from (vite/modulesManifest.ts).
 *
 * No imports: the Vite config loads this file directly with Node's type stripping.
 */
export interface ModuleLibrary {
  name: string;
  package: string;
}

export const moduleLibraries: Record<string, ModuleLibrary> = {
  editor: { name: 'Monaco', package: 'monaco-editor' },
  langdetect: { name: 'vscode-languagedetection', package: '@vscode/vscode-languagedetection' },
  x509: { name: '@peculiar/x509', package: '@peculiar/x509' },
  media: { name: 'music-metadata', package: 'music-metadata' },
  // SheetJS is installed from its CDN tarball, which still unpacks a package.json with a version
  sheets: { name: 'SheetJS', package: 'xlsx' },
  sqlite: { name: 'sql.js', package: 'sql.js' },
  pdf: { name: 'pdf.js', package: 'pdfjs-dist' },
  libarchive: { name: 'libarchive.js', package: 'libarchive.js' },
  audiotools: { name: 'Mediabunny', package: 'mediabunny' },
  qr: { name: 'jsQR', package: 'jsqr' },
  imageformats: { name: 'UTIF.js', package: 'utif2' },
  jq: { name: 'jq-wasm', package: 'jq-wasm' },
  heic: { name: 'libheif', package: 'libheif-js' },
  wabt: { name: 'wabt.js', package: 'wabt' },
};
