/** Tries each package recogniser on a listed archive; failures never break the listing. */

import type { ArchiveValue } from '../types';
import { recogniseApk } from './apk';
import { recogniseEpub } from './epub';
import { recogniseExtension } from './extension';
import { recogniseJar } from './jar';
import { recogniseNpm } from './npm';
import { recogniseNupkg } from './nupkg';
import { entryReader } from './reader';
import type { PackageInfo } from './types';
import { recogniseVsix } from './vsix';
import { recogniseWheel } from './wheel';

export interface RecogniseContext {
  /** Capture name, e.g. "app.war". */
  name?: string;
  /** Set when the zip came out of a CRX file. */
  crx?: { version: number; id: string | null } | null;
}

/**
 * The package manifest inside `v`, or undefined. Order matters: APKs and extensions can have a
 * META-INF/MANIFEST.MF too, so the Java check runs last.
 */
export function recognisePackage(
  v: ArchiveValue,
  ctx: RecogniseContext = {},
): PackageInfo | undefined {
  try {
    const r = entryReader(v);
    if (!r) return undefined;
    if (v.source.type === 'tar') return recogniseNpm(r) ?? undefined;
    return (
      recogniseEpub(r) ??
      recogniseApk(r, v) ??
      recogniseVsix(r) ??
      recogniseNupkg(r) ??
      recogniseWheel(r) ??
      recogniseExtension(r, { crx: ctx.crx ?? null, name: ctx.name }) ??
      recogniseJar(r, ctx.name) ??
      undefined
    );
  } catch {
    return undefined;
  }
}
