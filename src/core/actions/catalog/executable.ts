import { z } from 'zod';
import { defineAction } from '../types';

const kinds = ['executable'];

export const executableExtractIcon = defineAction({
  id: 'executable.extractIcon',
  title: 'Extract icon',
  group: 'Extract',
  kinds,
  params: z.object({}),
});

export const executableVersionInfo = defineAction({
  id: 'executable.versionInfo',
  title: 'Version info as JSON',
  group: 'Extract',
  kinds,
  params: z.object({}),
});

export const executableImportsCsv = defineAction({
  id: 'executable.importsCsv',
  title: 'Imports as CSV',
  group: 'Extract',
  kinds,
  params: z.object({}),
});

export const executableExportsCsv = defineAction({
  id: 'executable.exportsCsv',
  title: 'Exports as CSV',
  group: 'Extract',
  kinds,
  params: z.object({}),
});

export const executableSectionsCsv = defineAction({
  id: 'executable.sectionsCsv',
  title: 'Sections as CSV',
  group: 'Extract',
  kinds,
  params: z.object({}),
});

export const executableManifest = defineAction({
  id: 'executable.manifest',
  title: 'Extract manifest',
  group: 'Extract',
  kinds,
  params: z.object({}),
});

export const executableCertificates = defineAction({
  id: 'executable.certificates',
  title: 'Extract signing certificates',
  group: 'Extract',
  kinds,
  params: z.object({}),
});

export const STRINGS_ENCODINGS = {
  both: 'ASCII and UTF-16',
  ascii: 'ASCII only',
  utf16: 'UTF-16LE only',
};

export const executableStrings = defineAction({
  id: 'executable.strings',
  title: 'Extract strings',
  group: 'Extract',
  kinds,
  params: z.object({
    minLength: z.number().int().min(2).max(256).default(6).meta({ title: 'Minimum length' }),
    encoding: z
      .enum(['both', 'ascii', 'utf16'])
      .default('both')
      .meta({ title: 'Encoding', optionLabels: STRINGS_ENCODINGS }),
    offsets: z.boolean().default(false).meta({ title: 'Show offsets' }),
  }),
  label: p => `Extract strings (${p.minLength}+ chars)`,
});

export const executableOverlay = defineAction({
  id: 'executable.overlay',
  title: 'Extract overlay',
  group: 'Extract',
  kinds,
  params: z.object({}),
});

export const executableActions = [
  executableExtractIcon,
  executableVersionInfo,
  executableImportsCsv,
  executableExportsCsv,
  executableSectionsCsv,
  executableManifest,
  executableCertificates,
  executableStrings,
  executableOverlay,
];
