import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { transformWithOxc, type Plugin, type Rolldown } from 'vite';
import type { ModulesManifest } from '../src/swProtocol';

/** Lazily-loaded module entry points: src/modules/<id>/{worker,ui}.ts(x). */
const MODULE_ENTRY = /[\\/]src[\\/]modules[\\/]([\w-]+)[\\/](worker|ui)\.tsx?$/;
const SW_SOURCE = path.resolve(import.meta.dirname, '../src/sw.ts');

type Bundle = Rolldown.OutputBundle;

/**
 * Works out which build files belong to each lazily-loaded module and emits:
 * - modules-manifest.json: { version, core: files, modules: { id: { files, bytes } } }
 * - sw.js: src/sw.ts with the manifest inlined (so every build changes sw.js and triggers an update)
 *
 * Returns the main-build plugin plus one for worker builds, which only records module entries.
 */
export function modulesManifest(): { main: Plugin; worker: () => Plugin } {
  const roots = new Map<string, string>(); // fileName → module id

  const collectRoots = (bundle: Bundle) => {
    for (const out of Object.values(bundle)) {
      const id =
        out.type === 'chunk' && out.facadeModuleId && MODULE_ENTRY.exec(out.facadeModuleId)?.[1];
      if (id) roots.set(out.fileName, id);
    }
  };

  const worker = (): Plugin => ({
    name: 'clipbox:modules-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      collectRoots(bundle);
    },
  });

  const main: Plugin = {
    name: 'clipbox:modules-manifest',
    apply: 'build',
    enforce: 'post',
    async generateBundle(_, bundle) {
      collectRoots(bundle);
      const manifest = buildManifest(bundle, roots);
      this.emitFile({
        type: 'asset',
        fileName: 'modules-manifest.json',
        source: JSON.stringify(manifest, null, 2),
      });
      const source = await readFile(SW_SOURCE, 'utf8');
      const { code } = await transformWithOxc(source, SW_SOURCE);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: code.replace('__MANIFEST__', JSON.stringify(manifest)),
      });
    },
  };

  return { main, worker };
}

export function buildManifest(bundle: Bundle, roots: Map<string, string>): ModulesManifest {
  const outputs = Object.values(bundle);
  const names = outputs.map(o => o.fileName);
  const size = new Map(outputs.map(o => [o.fileName, sizeOf(o)]));

  // Files reference each other by hashed basename: chunk imports, new URL('…', import.meta.url),
  // worker URLs, CSS, ?url assets. Scan each text file once for any known basename.
  const byBase = new Map(names.map(n => [path.posix.basename(n), n]));
  const pattern = new RegExp(
    [...byBase.keys()].map(b => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'g',
  );
  const refs = new Map<string, Set<string>>();
  for (const o of outputs) {
    const out = new Set<string>();
    const text = o.type === 'chunk' ? o.code : typeof o.source === 'string' ? o.source : '';
    for (const m of text.matchAll(pattern)) {
      const ref = byBase.get(m[0]);
      if (ref && ref !== o.fileName) out.add(ref);
    }
    if (o.type === 'chunk') {
      [...o.imports, ...o.dynamicImports].forEach(f => out.add(f));
      const meta = o.viteMetadata;
      meta?.importedCss.forEach(f => out.add(f));
      meta?.importedAssets.forEach(f => out.add(f));
    }
    refs.set(o.fileName, out);
  }

  const closure = (start: string[], stop: Set<string>) => {
    const seen = new Set<string>();
    const queue = [...start];
    for (let f = queue.pop(); f !== undefined; f = queue.pop()) {
      if (seen.has(f)) continue;
      seen.add(f);
      for (const r of refs.get(f) ?? []) if (!seen.has(r) && !stop.has(r)) queue.push(r);
    }
    return seen;
  };

  const rootFiles = new Set(roots.keys());
  const entries = outputs
    .filter(o => (o.type === 'chunk' && o.isEntry) || o.fileName === 'index.html')
    .map(o => o.fileName);
  const core = closure(entries, rootFiles);

  const modules: ModulesManifest['modules'] = {};
  for (const id of new Set(roots.values())) {
    const own = [...roots].filter(([, m]) => m === id).map(([f]) => f);
    const otherRoots = new Set([...rootFiles].filter(f => !own.includes(f)));
    const files = [...closure(own, new Set([...core, ...otherRoots]))].sort();
    modules[id] = { files, bytes: files.reduce((n, f) => n + (size.get(f) ?? 0), 0) };
  }

  const coreFiles = [...core].sort();
  const version = createHash('sha256')
    .update(JSON.stringify([coreFiles, modules]))
    .digest('hex')
    .slice(0, 12);
  return { version, core: coreFiles, modules };
}

function sizeOf(o: Rolldown.OutputChunk | Rolldown.OutputAsset): number {
  if (o.type === 'chunk') return Buffer.byteLength(o.code);
  return typeof o.source === 'string' ? Buffer.byteLength(o.source) : o.source.byteLength;
}
