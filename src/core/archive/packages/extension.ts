/** Browser extensions (CRX, XPI or a plain zip): manifest.json with a manifest_version. */

import { isRecord } from '../../guards';
import { str, strings, type EntryReader } from './reader';
import type { ExtensionInfo } from './types';

/** Permissions worth a closer look, and why. */
export const RISKY_PERMISSIONS: Record<string, string> = {
  '<all_urls>': 'Reads and changes data on every site',
  debugger: 'Attaches the debugger to pages',
  nativeMessaging: 'Talks to programs installed on the computer',
  webRequestBlocking: 'Blocks or rewrites network requests',
  cookies: 'Reads and changes cookies',
  history: 'Reads browsing history',
  management: 'Manages other extensions',
  proxy: 'Controls the proxy settings',
};

/** Host patterns that match every site. */
const ALL_SITES = /^(<all_urls>|\*:\/\/\*\/\*|https?:\/\/\*\/\*)$/;

export function permissionFlag(p: string): string | undefined {
  return RISKY_PERMISSIONS[p] ?? (ALL_SITES.test(p) ? RISKY_PERMISSIONS['<all_urls>'] : undefined);
}

/** MV2 mixes host patterns into `permissions`. */
const isHostPattern = (p: string) => p === '<all_urls>' || p.includes('://');

/** "__MSG_appName__" → the default locale's message (keys are case-insensitive). */
function localiser(r: EntryReader, locale: string | null) {
  const messages = locale ? r.json(`_locales/${locale}/messages.json`) : null;
  const byKey = new Map<string, string>();
  if (messages) {
    for (const [k, v] of Object.entries(messages)) {
      if (isRecord(v) && typeof v.message === 'string') byKey.set(k.toLowerCase(), v.message);
    }
  }
  return (s: string | null) =>
    s === null
      ? null
      : s.replace(/__MSG_(\w+)__/g, (m, key: string) => byKey.get(key.toLowerCase()) ?? m);
}

function backgroundOf(bg: unknown): string | null {
  if (!isRecord(bg)) return null;
  const sw = str(bg, 'service_worker');
  if (sw) return `service worker: ${sw}`;
  const scripts = strings(bg.scripts);
  if (scripts.length > 0) return `scripts: ${scripts.join(', ')}`;
  const page = str(bg, 'page');
  return page ? `page: ${page}` : null;
}

export interface ExtensionContext {
  /** From the CRX header, when the zip came in one. */
  crx: { version: number; id: string | null } | null;
  name: string | undefined;
}

export function recogniseExtension(r: EntryReader, ctx: ExtensionContext): ExtensionInfo | null {
  const m = r.json('manifest.json');
  if (!m || typeof m.manifest_version !== 'number') return null;
  const locale = str(m, 'default_locale');
  const t = localiser(r, locale);

  const all = strings(m.permissions);
  const mv = m.manifest_version;
  const permissions = mv >= 3 ? all : all.filter(p => !isHostPattern(p));
  const hostPermissions = mv >= 3 ? strings(m.host_permissions) : all.filter(isHostPattern);
  const matches = new Set<string>();
  if (Array.isArray(m.content_scripts)) {
    for (const cs of m.content_scripts) {
      if (isRecord(cs)) for (const p of strings(cs.matches)) matches.add(p);
    }
  }
  const gecko = isRecord(m.browser_specific_settings)
    ? m.browser_specific_settings.gecko
    : isRecord(m.applications)
      ? m.applications.gecko
      : undefined;
  const geckoId = isRecord(gecko) ? str(gecko, 'id') : null;
  const firefox =
    geckoId !== null ||
    /\.xpi$/i.test(ctx.name ?? '') ||
    r.has('META-INF/mozilla.rsa') ||
    r.has('META-INF/cose.sig');

  return {
    type: 'extension',
    browser: ctx.crx ? 'chrome' : firefox ? 'firefox' : 'unknown',
    crx: ctx.crx?.version ?? null,
    id: ctx.crx?.id ?? null,
    manifestVersion: mv,
    name: t(str(m, 'name')) ?? '(unnamed)',
    version: str(m, 'version') ?? '',
    description: t(str(m, 'description')),
    permissions,
    hostPermissions,
    optionalPermissions: [
      ...strings(m.optional_permissions),
      ...strings(m.optional_host_permissions),
    ],
    contentScriptMatches: [...matches],
    background: backgroundOf(m.background),
    geckoId,
    defaultLocale: locale,
  };
}
