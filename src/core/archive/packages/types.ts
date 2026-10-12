/**
 * Package manifests recognised inside archives (jar, browser extensions, APK, wheel, …, RPM), and
 * the display model the preview's manifest card reads (validated with Zod, since it arrives from
 * the worker). No heavy imports: the UI loads this file too.
 */

import { z } from 'zod';

export interface JarInfo {
  type: 'jar';
  /** jar, war (WEB-INF/web.xml) or ear (META-INF/application.xml). */
  variant: 'jar' | 'war' | 'ear';
  /** Main section of META-INF/MANIFEST.MF, continuation lines joined. */
  manifest: Record<string, string>;
  classCount: number;
  /** Highest class-file major version outside META-INF/versions/; null without classes. */
  maxMajor: number | null;
  /** Classes whose headers were read (all of them, unless there were very many). */
  classesRead: number;
  multiRelease: boolean;
  signed: boolean;
}

export interface ExtensionInfo {
  type: 'extension';
  browser: 'chrome' | 'firefox' | 'unknown';
  /** CRX version (2 or 3) when it came in a CRX file. */
  crx: number | null;
  /** From the CRX public key (or CRX3 signed header data). */
  id: string | null;
  manifestVersion: number;
  name: string;
  version: string;
  description: string | null;
  permissions: string[];
  hostPermissions: string[];
  optionalPermissions: string[];
  contentScriptMatches: string[];
  /** "service worker: bg.js", "scripts: a.js, b.js" or "page: bg.html". */
  background: string | null;
  geckoId: string | null;
  defaultLocale: string | null;
}

export interface ApkInfo {
  type: 'apk';
  variant: 'apk' | 'aab';
  /** Null when the manifest couldn't be decoded (the rest still lists). */
  package: string | null;
  versionName: string | null;
  versionCode: string | null;
  minSdk: string | null;
  targetSdk: string | null;
  label: string | null;
  permissions: string[];
  activities: number;
  services: number;
  receivers: number;
  providers: number;
  /** "v1", "v2", "v3", "v3.1". */
  signing: string[];
  /** AAB feature modules (top-level folders with a manifest/). */
  modules: string[];
  note: string | null;
}

export interface WheelInfo {
  type: 'wheel';
  name: string;
  version: string;
  summary: string | null;
  requiresPython: string | null;
  requires: string[];
  tags: string[];
  generator: string | null;
  pureLib: boolean | null;
}

export interface NupkgInfo {
  type: 'nupkg';
  id: string;
  version: string;
  authors: string | null;
  description: string | null;
  license: string | null;
  projectUrl: string | null;
  /** "Newtonsoft.Json 13.0.1 (net6.0)". */
  dependencies: string[];
  frameworks: string[];
}

export interface VsixInfo {
  type: 'vsix';
  /** VS Code extension (extension/package.json) or Visual Studio extension. */
  target: 'vscode' | 'visualstudio';
  id: string | null;
  publisher: string | null;
  name: string;
  displayName: string | null;
  version: string;
  description: string | null;
  engines: string[];
  activationEvents: string[];
  /** "commands: 12". */
  contributes: string[];
  main: string | null;
}

export interface NpmInfo {
  type: 'npm';
  name: string;
  version: string;
  description: string | null;
  license: string | null;
  bin: string[];
  dependencies: string[];
  devDependencies: number;
  peerDependencies: string[];
  /** Every script, name → command; install hooks are flagged on the card. */
  scripts: Record<string, string>;
}

export interface EpubChapter {
  href: string;
  title: string | null;
}

export interface EpubInfo {
  type: 'epub';
  title: string | null;
  authors: string[];
  language: string | null;
  publisher: string | null;
  date: string | null;
  identifier: string | null;
  version: string | null;
  chapters: EpubChapter[];
}

export interface RpmScript {
  /** "%pre", "%post", "%triggerin -- glibc", … */
  name: string;
  /** Interpreter, e.g. "/bin/sh". */
  program: string | null;
  body: string;
}

export interface RpmInfo {
  type: 'rpm';
  name: string;
  version: string;
  release: string;
  epoch: number | null;
  arch: string | null;
  source: boolean;
  summary: string | null;
  description: string | null;
  license: string | null;
  url: string | null;
  vendor: string | null;
  packager: string | null;
  group: string | null;
  buildHost: string | null;
  /** ISO 8601. */
  buildTime: string | null;
  sourceRpm: string | null;
  /** Declared installed size. */
  installedSize: number | null;
  /** "glibc >= 2.34". */
  requires: string[];
  provides: string[];
  conflicts: string[];
  obsoletes: string[];
  payloadFormat: string | null;
  /** gzip when the header doesn't say. */
  payloadCompressor: string;
  scripts: RpmScript[];
  /** Files in the header but left out of the listing: symlinks, devices, %ghost. */
  skipped: { symlinks: number; ghosts: number; other: number };
}

export type PackageInfo =
  | JarInfo
  | ExtensionInfo
  | ApkInfo
  | WheelInfo
  | NupkgInfo
  | VsixInfo
  | NpmInfo
  | EpubInfo
  | RpmInfo;

export type PackageType = PackageInfo['type'];

/** One line in a card list; `flag` says why it's risky. */
export interface CardItem {
  text: string;
  flag?: string;
}

/** What the archive preview's manifest card shows. */
export interface PackageCard {
  /** "Chrome extension", "Java archive", "RPM package". */
  title: string;
  name: string;
  version: string | null;
  badges: { text: string; tone: 'plain' | 'accent' | 'good' | 'warn' }[];
  fields: { label: string; value: string }[];
  lists: { title: string; items: CardItem[] }[];
  /** Install scripts and scriptlets, flagged. */
  scripts: { name: string; body: string; flag?: string }[];
  /** Short reasons to look closer, e.g. "Requests <all_urls>". */
  warnings: string[];
}

const cardItem = z.object({ text: z.string(), flag: z.string().optional() });

export const packageCardSchema: z.ZodType<PackageCard> = z.object({
  title: z.string(),
  name: z.string(),
  version: z.string().nullable(),
  badges: z.array(
    z.object({ text: z.string(), tone: z.enum(['plain', 'accent', 'good', 'warn']) }),
  ),
  fields: z.array(z.object({ label: z.string(), value: z.string() })),
  lists: z.array(z.object({ title: z.string(), items: z.array(cardItem) })),
  scripts: z.array(z.object({ name: z.string(), body: z.string(), flag: z.string().optional() })),
  warnings: z.array(z.string()),
});
