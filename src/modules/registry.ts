import { audioDetector, videoDetector } from './media/detect';
import { spreadsheetDetector } from './sheets/detect';
import { sqliteDetector } from './sqlite/detect';
import { pdfDetector } from './pdf/detect';
import { libarchiveDetector } from './libarchive/detect';
import { pemDetector } from './x509/detect';
import type { Detector, ModuleId, ModuleInfo, Policies, Policy } from './types';

/** Metadata for every module. Shared by main thread and worker; must stay tiny. */
export const modules: ModuleInfo[] = [
  {
    id: 'editor',
    title: 'Code editor',
    description: 'Monaco-based text and code preview with syntax highlighting',
    approxBytes: 5_400_000,
    defaultPolicy: 'auto',
    hasWorker: false,
    hasUi: true,
  },
  {
    id: 'langdetect',
    title: 'Language detection',
    description: "Detects the programming language of pasted text (VS Code's ML model)",
    approxBytes: 1_800_000,
    defaultPolicy: 'auto',
    hasWorker: true,
    hasUi: false,
  },
  {
    id: 'x509',
    title: 'Certificates',
    description: 'Decodes PEM certificates, CSRs and keys (@peculiar/x509)',
    approxBytes: 220_000,
    defaultPolicy: 'auto',
    hasWorker: true,
    hasUi: false,
  },
  {
    id: 'media',
    title: 'Audio & video',
    description: 'Reads audio and video metadata, tags and cover art (music-metadata)',
    approxBytes: 250_000,
    defaultPolicy: 'auto',
    hasWorker: true,
    hasUi: false,
  },
  {
    id: 'sheets',
    title: 'Spreadsheets',
    description: 'Reads XLSX, XLSM, XLSB, ODS and legacy XLS workbooks (SheetJS)',
    approxBytes: 370_000,
    defaultPolicy: 'auto',
    hasWorker: true,
    hasUi: false,
  },
  {
    id: 'sqlite',
    title: 'SQLite',
    description: 'Opens SQLite databases read-only in memory (sql.js, WASM)',
    approxBytes: 700_000,
    defaultPolicy: 'auto',
    hasWorker: true,
    hasUi: false,
  },
  {
    id: 'pdf',
    title: 'PDF',
    description: 'Page previews, metadata and text extraction for PDFs (pdf.js)',
    approxBytes: 4_000_000,
    defaultPolicy: 'auto',
    hasWorker: true,
    hasUi: false,
  },
  {
    id: 'libarchive',
    title: 'More archives',
    description: '7z, RAR, tar.xz, tar.bz2 and zstd archives (libarchive WASM, fzstd)',
    approxBytes: 1_100_000,
    defaultPolicy: 'auto',
    hasWorker: true,
    hasUi: false,
  },
];

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

export function defaultPolicies(): Policies {
  return Object.fromEntries(modules.map(m => [m.id, m.defaultPolicy]));
}

export const policyOf = (policies: Policies, id: ModuleId): Policy =>
  id === 'core' ? 'preload' : (policies[id] ?? moduleInfo(id)?.defaultPolicy ?? 'off');
