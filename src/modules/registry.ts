import { audioDetector, videoDetector } from './media/detect';
import { spreadsheetDetector } from './sheets/detect';
import { sqliteDetector } from './sqlite/detect';
import { pdfDetector } from './pdf/detect';
import { libarchiveDetector } from './libarchive/detect';
import { pemDetector } from './x509/detect';
import { moduleLibraries } from './libraries';
import type { Detector, ModuleId, ModuleInfo } from './types';

/** Metadata for every module. Shared by main thread and worker; must stay tiny. */
export const modules: ModuleInfo[] = (
  [
    {
      id: 'editor',
      title: 'Code editor',
      description: 'Monaco-based text and code preview with syntax highlighting',
      approxBytes: 5_400_000,
      hasWorker: false,
      hasUi: true,
    },
    {
      id: 'langdetect',
      title: 'Language detection',
      description: "Detects the programming language of pasted text with VS Code's ML model",
      approxBytes: 1_800_000,
      hasWorker: true,
      hasUi: false,
    },
    {
      id: 'x509',
      title: 'Certificates',
      description: 'Decodes PEM certificates, CSRs and keys',
      approxBytes: 220_000,
      hasWorker: true,
      hasUi: false,
    },
    {
      id: 'media',
      title: 'Audio & video',
      description: 'Reads audio and video metadata, tags and cover art',
      approxBytes: 250_000,
      hasWorker: true,
      hasUi: false,
    },
    {
      id: 'sheets',
      title: 'Spreadsheets',
      description: 'Reads XLSX, XLSM, XLSB, ODS and legacy XLS workbooks',
      approxBytes: 370_000,
      hasWorker: true,
      hasUi: false,
    },
    {
      id: 'sqlite',
      title: 'SQLite',
      description: 'Opens SQLite databases read-only in memory (WASM)',
      approxBytes: 700_000,
      hasWorker: true,
      hasUi: false,
    },
    {
      id: 'pdf',
      title: 'PDF',
      description: 'Page previews, metadata and text extraction for PDFs',
      approxBytes: 4_000_000,
      hasWorker: true,
      hasUi: false,
    },
    {
      id: 'libarchive',
      title: 'More archives',
      description: '7z, RAR, tar.xz, tar.bz2 and zstd archives (WASM, plus fzstd)',
      approxBytes: 1_100_000,
      hasWorker: true,
      hasUi: false,
    },
    {
      id: 'audiotools',
      title: 'Audio tools',
      description: 'Loudness normalisation for audio and video (decode, re-encode and remux)',
      approxBytes: 630_000,
      hasWorker: true,
      hasUi: false,
    },
  ] satisfies Omit<ModuleInfo, 'library'>[]
).map(m => ({ ...m, library: moduleLibraries[m.id] }));

/** Detectors for kinds owned by lazily-loaded modules. */
export const detectors: Detector[] = [
  pemDetector,
  pdfDetector,
  audioDetector,
  videoDetector,
  spreadsheetDetector,
  sqliteDetector,
  libarchiveDetector,
];

export const moduleInfo = (id: ModuleId) => modules.find(m => m.id === id);
