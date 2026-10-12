/** VSIX: VS Code extensions (extension/package.json) and Visual Studio extensions (vsixmanifest). */

import { isRecord } from '../../guards';
import { parseXml } from '../../presentation/ooxml';
import { str, strings, type EntryReader } from './reader';
import type { VsixInfo } from './types';
import { attrLocal, childLocal, childrenLocal, ownText } from './xml';

const VSIX_MANIFEST = 'extension.vsixmanifest';
const VSCODE_PACKAGE = 'extension/package.json';

/** "commands: 12" for each `contributes` key (array lengths, object key counts). */
function contributesSummary(c: unknown): string[] {
  if (!isRecord(c)) return [];
  return Object.entries(c).map(([k, v]) => {
    const n = Array.isArray(v) ? v.length : isRecord(v) ? Object.keys(v).length : 1;
    return `${k}: ${n}`;
  });
}

export function recogniseVsix(r: EntryReader): VsixInfo | null {
  if (!r.has(VSIX_MANIFEST)) return null;
  const root = parseXml(r.text(VSIX_MANIFEST) ?? '');
  const meta = childLocal(root, 'Metadata');
  const identity = childLocal(meta, 'Identity');
  const pkg = r.json(VSCODE_PACKAGE);
  if (pkg) {
    const engines = isRecord(pkg.engines)
      ? Object.entries(pkg.engines).flatMap(([k, v]) =>
          typeof v === 'string' ? [`${k} ${v}`] : [],
        )
      : [];
    const publisher = str(pkg, 'publisher') ?? attrLocal(identity, 'Publisher');
    const name = str(pkg, 'name') ?? attrLocal(identity, 'Id') ?? '';
    return {
      type: 'vsix',
      target: 'vscode',
      id: publisher ? `${publisher}.${name}` : name,
      publisher,
      name,
      displayName: str(pkg, 'displayName') ?? ownText(childLocal(meta, 'DisplayName')),
      version: str(pkg, 'version') ?? attrLocal(identity, 'Version') ?? '',
      description: str(pkg, 'description'),
      engines,
      activationEvents: strings(pkg.activationEvents),
      contributes: contributesSummary(pkg.contributes),
      main: str(pkg, 'main') ?? str(pkg, 'browser'),
    };
  }
  if (!identity) return null;
  const targets = childrenLocal(childLocal(root, 'Installation'), 'InstallationTarget').flatMap(
    t => {
      const id = attrLocal(t, 'Id');
      const version = attrLocal(t, 'Version');
      return id ? [`${id}${version ? ` ${version}` : ''}`] : [];
    },
  );
  const id = attrLocal(identity, 'Id');
  return {
    type: 'vsix',
    target: 'visualstudio',
    id,
    publisher: attrLocal(identity, 'Publisher'),
    name: id ?? '',
    displayName: ownText(childLocal(meta, 'DisplayName')),
    version: attrLocal(identity, 'Version') ?? '',
    description: ownText(childLocal(meta, 'Description')),
    engines: targets,
    activationEvents: [],
    contributes: childrenLocal(childLocal(root, 'Assets'), 'Asset').flatMap(a => {
      const type = attrLocal(a, 'Type');
      return type ? [type] : [];
    }),
    main: null,
  };
}
