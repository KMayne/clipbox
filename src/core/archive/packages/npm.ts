/** npm packages: package/package.json inside the .tgz. */

import { isRecord } from '../../guards';
import { str, type EntryReader } from './reader';
import type { NpmInfo } from './types';

const NPM_PACKAGE = 'package/package.json';

/** Lifecycle scripts npm runs on install, and why they matter. */
export const INSTALL_SCRIPTS: Record<string, string> = {
  preinstall: 'Runs before the package installs',
  install: 'Runs when the package installs',
  postinstall: 'Runs after the package installs',
};

const deps = (v: unknown): string[] =>
  isRecord(v) ? Object.entries(v).map(([k, x]) => (typeof x === 'string' ? `${k} ${x}` : k)) : [];

export function recogniseNpm(r: EntryReader): NpmInfo | null {
  const pkg = r.json(NPM_PACKAGE);
  if (!pkg || typeof pkg.name !== 'string') return null;
  const bin =
    typeof pkg.bin === 'string'
      ? [`${pkg.name.replace(/^@[^/]+\//, '')} → ${pkg.bin}`]
      : isRecord(pkg.bin)
        ? Object.entries(pkg.bin).map(([k, v]) => `${k} → ${String(v)}`)
        : [];
  const scripts: Record<string, string> = {};
  if (isRecord(pkg.scripts)) {
    for (const [k, v] of Object.entries(pkg.scripts)) if (typeof v === 'string') scripts[k] = v;
  }
  const license = str(pkg, 'license') ?? (isRecord(pkg.license) ? str(pkg.license, 'type') : null);
  return {
    type: 'npm',
    name: pkg.name,
    version: str(pkg, 'version') ?? '',
    description: str(pkg, 'description'),
    license,
    bin,
    dependencies: deps(pkg.dependencies),
    devDependencies: deps(pkg.devDependencies).length,
    peerDependencies: deps(pkg.peerDependencies),
    scripts,
  };
}
