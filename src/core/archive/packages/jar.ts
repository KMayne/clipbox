/** Java archives (jar, war, ear): META-INF/MANIFEST.MF and the class files' versions. */

import type { JarInfo } from './types';
import type { EntryReader } from './reader';

export const JAR_MANIFEST = 'META-INF/MANIFEST.MF';
/** Above this many classes the label's Java version comes from a sample. */
const MAX_CLASSES_READ = 50_000;
const VERSIONED = /^META-INF\/versions\/\d+\//;

/**
 * The main section of a manifest: "Name: value" lines up to the first blank line, with
 * continuation lines (starting with one space) joined on.
 */
export function parseManifestMf(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let last: string | null = null;
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line === '') {
      if (Object.keys(out).length > 0) break;
      continue;
    }
    if (line.startsWith(' ')) {
      if (last !== null) out[last] = (out[last] ?? '') + line.slice(1);
      continue;
    }
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    last = line.slice(0, colon).trim();
    out[last] = line.slice(colon + 1).replace(/^ /, '');
  }
  for (const k of Object.keys(out)) out[k] = (out[k] ?? '').trim();
  return out;
}

/** A class file's major version (CAFEBABE magic), or null. */
export function classMajor(header: Uint8Array | null): number | null {
  if (!header || header.length < 8) return null;
  if (header[0] !== 0xca || header[1] !== 0xfe || header[2] !== 0xba || header[3] !== 0xbe)
    return null;
  return ((header[6] ?? 0) << 8) | (header[7] ?? 0);
}

/** "Java 17" for 61, "Java 1.4" for 48; majors below 45 aren't Java. */
export function javaVersion(major: number): string {
  if (major >= 49) return `Java ${major - 44}`;
  if (major >= 45) return `Java 1.${Math.max(1, major - 44)}`;
  return `class version ${major}`;
}

export const isClass = (path: string) => path.endsWith('.class');

/** Java archive when there's a manifest or class files (other recognisers run first). */
export function recogniseJar(r: EntryReader, name: string | undefined): JarInfo | null {
  const classes = r.files.filter(isClass);
  if (!r.has(JAR_MANIFEST) && classes.length === 0) return null;
  const mf = r.text(JAR_MANIFEST);
  const manifest = mf === null ? {} : parseManifestMf(mf);

  let maxMajor: number | null = null;
  let classesRead = 0;
  for (const path of classes) {
    if (classesRead >= MAX_CLASSES_READ) break;
    if (VERSIONED.test(path)) continue;
    const major = classMajor(r.prefix(path, 8));
    classesRead++;
    if (major !== null && (maxMajor === null || major > maxMajor)) maxMajor = major;
  }

  const lower = (name ?? '').toLowerCase();
  const variant =
    r.has('WEB-INF/web.xml') || lower.endsWith('.war')
      ? 'war'
      : r.has('META-INF/application.xml') || lower.endsWith('.ear')
        ? 'ear'
        : 'jar';
  return {
    type: 'jar',
    variant,
    manifest,
    classCount: classes.length,
    maxMajor,
    classesRead,
    multiRelease: manifest['Multi-Release']?.toLowerCase() === 'true',
    signed: r.files.some(p => /^META-INF\/[^/]+\.SF$/i.test(p)),
  };
}
