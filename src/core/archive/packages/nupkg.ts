/** NuGet packages: the .nuspec at the root. */

import { parseXml, type XmlNode } from '../../presentation/ooxml';
import type { EntryReader } from './reader';
import type { NupkgInfo } from './types';
import { attrLocal, childLocal, childrenLocal, ownText } from './xml';

export function recogniseNupkg(r: EntryReader): NupkgInfo | null {
  const path = r.files.find(p => !p.includes('/') && p.toLowerCase().endsWith('.nuspec'));
  if (!path) return null;
  const root = parseXml(r.text(path) ?? '');
  const meta = childLocal(root, 'metadata');
  if (!meta) return null;
  const text = (name: string) => ownText(childLocal(meta, name));

  const deps: string[] = [];
  const frameworks = new Set<string>();
  const dependency = (d: XmlNode, tfm: string | null) => {
    const id = attrLocal(d, 'id');
    if (!id) return;
    const version = attrLocal(d, 'version');
    deps.push(`${id}${version ? ` ${version}` : ''}${tfm ? ` (${tfm})` : ''}`);
  };
  const dependencies = childLocal(meta, 'dependencies');
  for (const d of childrenLocal(dependencies, 'dependency')) dependency(d, null);
  for (const g of childrenLocal(dependencies, 'group')) {
    const tfm = attrLocal(g, 'targetFramework');
    if (tfm) frameworks.add(tfm);
    for (const d of childrenLocal(g, 'dependency')) dependency(d, tfm);
  }
  // lib/<tfm>/… folders name the frameworks the package ships assemblies for
  for (const p of r.files) {
    const m = /^lib\/([^/]+)\//.exec(p);
    if (m?.[1]) frameworks.add(m[1].replace(/%2B/gi, '+'));
  }
  const license = childLocal(meta, 'license');
  return {
    type: 'nupkg',
    id: text('id') ?? path.replace(/\.nuspec$/i, ''),
    version: text('version') ?? '',
    authors: text('authors'),
    description: text('description'),
    license: ownText(license) ?? text('licenseUrl'),
    projectUrl: text('projectUrl'),
    dependencies: deps,
    frameworks: [...frameworks],
  };
}
