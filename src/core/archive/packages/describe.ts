/** Labels, Info stats and the preview's manifest card for recognised packages. */

import { formatBytes, formatCount, plural } from '../../format';
import { nevra } from '../rpm';
import type { ArchiveValue } from '../types';
import { permissionFlag } from './extension';
import { javaVersion } from './jar';
import { INSTALL_SCRIPTS } from './npm';
import type { CardItem, PackageCard, PackageInfo, RpmInfo } from './types';

/** Items shown per card list before the rest are summarised. */
const MAX_LIST = 500;

const fileCount = (v: ArchiveValue) => v.entries.filter(e => !e.isDir).length;

const EXTENSION_TITLES = {
  chrome: 'Chrome extension',
  firefox: 'Firefox add-on',
  unknown: 'Browser extension',
};
const JAR_TITLES = { jar: 'Java archive', war: 'Web archive', ear: 'Enterprise archive' };

export function packageTitle(p: PackageInfo): string {
  switch (p.type) {
    case 'jar':
      return JAR_TITLES[p.variant];
    case 'extension':
      return EXTENSION_TITLES[p.browser];
    case 'apk':
      return p.variant === 'aab' ? 'Android app bundle' : 'Android app';
    case 'wheel':
      return 'Python wheel';
    case 'nupkg':
      return 'NuGet package';
    case 'vsix':
      return p.target === 'vscode' ? 'VS Code extension' : 'Visual Studio extension';
    case 'npm':
      return 'npm package';
    case 'epub':
      return 'EPUB';
    case 'rpm':
      return 'RPM';
  }
}

/** Install hooks npm would run. */
export const npmInstallScripts = (scripts: Record<string, string>) =>
  Object.keys(scripts).filter(k => k in INSTALL_SCRIPTS);

const join = (...parts: (string | null | undefined | false)[]) =>
  parts.filter((p): p is string => typeof p === 'string' && p !== '').join(' · ');

/** The archive chip's label, e.g. "Java archive · 132 classes · Java 17". */
export function packageLabel(p: PackageInfo, v: ArchiveValue): string {
  const title = packageTitle(p);
  switch (p.type) {
    case 'jar':
      return join(
        title,
        `${formatCount(p.classCount)} ${p.classCount === 1 ? 'class' : 'classes'}`,
        p.maxMajor !== null && javaVersion(p.maxMajor),
      );
    case 'extension':
      return join(
        title,
        `MV${p.manifestVersion}`,
        plural(p.permissions.length + p.hostPermissions.length, 'permission'),
      );
    case 'apk':
      return join(title, p.package, p.versionName);
    case 'wheel':
      return join(title, `${p.name} ${p.version}`.trim(), p.tags[0]);
    case 'nupkg':
      return join(title, `${p.id} ${p.version}`.trim());
    case 'vsix':
      return join(title, p.id ?? p.name, p.version);
    case 'npm':
      return join(
        title,
        `${p.name} ${p.version}`.trim(),
        npmInstallScripts(p.scripts).length > 0 && 'install scripts',
      );
    case 'epub':
      return join(title, p.title, plural(p.chapters.length, 'chapter'));
    case 'rpm':
      return join(title, nevra(p), plural(fileCount(v), 'file'));
  }
}

const items = (xs: string[], flag?: (x: string) => string | undefined): CardItem[] => {
  const shown = xs.slice(0, MAX_LIST).map(text => {
    const f = flag?.(text);
    return f ? { text, flag: f } : { text };
  });
  if (xs.length > MAX_LIST) shown.push({ text: `… and ${formatCount(xs.length - MAX_LIST)} more` });
  return shown;
};

type Field = { label: string; value: string };
const field = (label: string, value: string | number | null | undefined): Field[] =>
  value === null || value === undefined || value === '' ? [] : [{ label, value: String(value) }];

const list = (title: string, xs: CardItem[]) => (xs.length > 0 ? [{ title, items: xs }] : []);

function rpmCard(p: RpmInfo): Omit<PackageCard, 'title'> {
  const skipped = [
    p.skipped.symlinks > 0 && plural(p.skipped.symlinks, 'symlink'),
    p.skipped.ghosts > 0 && `${formatCount(p.skipped.ghosts)} %ghost`,
    p.skipped.other > 0 && `${formatCount(p.skipped.other)} other`,
  ].filter((s): s is string => typeof s === 'string');
  return {
    name: p.name,
    version: [p.version, p.release].filter(Boolean).join('-') || null,
    badges: [
      ...(p.arch ? [{ text: p.source ? 'source' : p.arch, tone: 'accent' as const }] : []),
      { text: `${p.payloadFormat ?? 'cpio'} · ${p.payloadCompressor}`, tone: 'plain' },
      ...(p.scripts.length > 0
        ? [{ text: plural(p.scripts.length, 'scriptlet'), tone: 'warn' as const }]
        : []),
    ],
    fields: [
      ...field('Package', nevra(p)),
      ...field('Summary', p.summary),
      ...field('License', p.license),
      ...field('URL', p.url),
      ...field('Vendor', p.vendor),
      ...field('Packager', p.packager),
      ...field('Group', p.group),
      ...field('Build host', p.buildHost),
      ...field('Build time', p.buildTime?.replace('T', ' ')),
      ...field('Source RPM', p.sourceRpm),
      ...field('Installed size', p.installedSize === null ? null : formatBytes(p.installedSize)),
      ...field('Payload', `${p.payloadFormat ?? 'cpio'}, ${p.payloadCompressor}`),
      ...field('Not listed', skipped.join(', ')),
    ],
    lists: [
      ...list('Requires', items(p.requires)),
      ...list('Provides', items(p.provides)),
      ...list('Conflicts', items(p.conflicts)),
      ...list('Obsoletes', items(p.obsoletes)),
    ],
    scripts: p.scripts.map(s => ({
      name: s.program ? `${s.name} (${s.program})` : s.name,
      body: s.body,
      flag: 'Runs as root when the package is installed, upgraded or removed',
    })),
    warnings: p.scripts.length > 0 ? [`Has ${plural(p.scripts.length, 'scriptlet')}`] : [],
  };
}

function cardBody(p: PackageInfo): Omit<PackageCard, 'title'> {
  switch (p.type) {
    case 'jar': {
      const m = p.manifest;
      const version =
        m['Implementation-Version'] ?? m['Bundle-Version'] ?? m['Specification-Version'] ?? null;
      return {
        name:
          m['Implementation-Title'] ?? m['Bundle-Name'] ?? m['Bundle-SymbolicName'] ?? p.variant,
        version,
        badges: [
          ...(p.maxMajor !== null
            ? [{ text: javaVersion(p.maxMajor), tone: 'accent' as const }]
            : []),
          ...(p.multiRelease ? [{ text: 'Multi-Release', tone: 'plain' as const }] : []),
          { text: p.signed ? 'signed' : 'unsigned', tone: p.signed ? 'good' : 'plain' },
        ],
        fields: [
          ...field('Main-Class', m['Main-Class']),
          ...field('Classes', formatCount(p.classCount)),
          ...field(
            'Java target',
            p.maxMajor === null
              ? null
              : `${javaVersion(p.maxMajor)} (class version ${p.maxMajor}${p.classesRead < p.classCount ? `, from ${formatCount(p.classesRead)} classes` : ''})`,
          ),
          ...Object.entries(m)
            .filter(([k]) =>
              /^(Implementation|Bundle|Specification)-|^(Created-By|Built-By|Build-Jdk.*|Automatic-Module-Name|Launcher-Agent-Class|Premain-Class|Agent-Class)$/.test(
                k,
              ),
            )
            .map(([label, value]) => ({ label, value })),
        ],
        lists: [],
        scripts: [],
        warnings: [],
      };
    }
    case 'extension': {
      const flagged = [...p.permissions, ...p.hostPermissions].filter(x => permissionFlag(x));
      return {
        name: p.name,
        version: p.version || null,
        badges: [
          { text: `MV${p.manifestVersion}`, tone: 'accent' },
          ...(p.crx !== null ? [{ text: `CRX${p.crx}`, tone: 'plain' as const }] : []),
          ...(flagged.length > 0
            ? [{ text: plural(flagged.length, 'risky permission'), tone: 'warn' as const }]
            : []),
        ],
        fields: [
          ...field('Extension ID', p.id),
          ...field('Gecko ID', p.geckoId),
          ...field('Description', p.description),
          ...field('Background', p.background),
          ...field('Default locale', p.defaultLocale),
        ],
        lists: [
          ...list('Permissions', items(p.permissions, permissionFlag)),
          ...list('Host permissions', items(p.hostPermissions, permissionFlag)),
          ...list('Optional permissions', items(p.optionalPermissions)),
          ...list('Content scripts run on', items(p.contentScriptMatches, permissionFlag)),
        ],
        scripts: [],
        warnings: flagged.map(x => `Requests ${x}`),
      };
    }
    case 'apk':
      return {
        name: p.label && !p.label.startsWith('@') ? p.label : (p.package ?? 'Android app'),
        version: p.versionName,
        badges: [
          ...p.signing.map(s => ({ text: `signed ${s}`, tone: 'good' as const })),
          ...(p.signing.length === 0 && p.variant === 'apk'
            ? [{ text: 'unsigned', tone: 'warn' as const }]
            : []),
        ],
        fields: [
          ...field('Package', p.package),
          ...field('Version code', p.versionCode),
          ...field('Min SDK', p.minSdk),
          ...field('Target SDK', p.targetSdk),
          ...field('Activities', p.activities),
          ...field('Services', p.services),
          ...field('Receivers', p.receivers),
          ...field('Providers', p.providers),
          ...field('Note', p.note),
        ],
        lists: [
          ...list(
            'Permissions',
            items(p.permissions.map(x => x.replace(/^android\.permission\./, ''))),
          ),
          ...list('Modules', items(p.modules)),
        ],
        scripts: [],
        warnings: [],
      };
    case 'wheel':
      return {
        name: p.name,
        version: p.version || null,
        badges: [
          ...p.tags.map(t => ({ text: t, tone: 'accent' as const })),
          ...(p.pureLib === true ? [{ text: 'pure Python', tone: 'plain' as const }] : []),
        ],
        fields: [
          ...field('Summary', p.summary),
          ...field('Requires Python', p.requiresPython),
          ...field('Generator', p.generator),
        ],
        lists: list('Dependencies', items(p.requires)),
        scripts: [],
        warnings: [],
      };
    case 'nupkg':
      return {
        name: p.id,
        version: p.version || null,
        badges: p.frameworks.slice(0, 12).map(f => ({ text: f, tone: 'accent' as const })),
        fields: [
          ...field('Authors', p.authors),
          ...field('Description', p.description),
          ...field('License', p.license),
          ...field('Project URL', p.projectUrl),
        ],
        lists: [
          ...list('Dependencies', items(p.dependencies)),
          ...list('Target frameworks', items(p.frameworks)),
        ],
        scripts: [],
        warnings: [],
      };
    case 'vsix': {
      const startup = p.activationEvents.includes('*');
      return {
        name: p.displayName ?? p.name,
        version: p.version || null,
        badges: [
          ...p.engines.map(e => ({ text: e, tone: 'accent' as const })),
          ...(startup ? [{ text: 'activates on startup', tone: 'warn' as const }] : []),
        ],
        fields: [
          ...field('ID', p.id),
          ...field('Publisher', p.publisher),
          ...field('Description', p.description),
          ...field('Entry point', p.main),
        ],
        lists: [
          ...list(
            'Activation events',
            items(p.activationEvents, e => (e === '*' ? 'Activates on every startup' : undefined)),
          ),
          ...list(p.target === 'vscode' ? 'Contributes' : 'Assets', items(p.contributes)),
        ],
        scripts: [],
        warnings: startup ? ['Activates on every startup'] : [],
      };
    }
    case 'npm': {
      const hooks = npmInstallScripts(p.scripts);
      return {
        name: p.name,
        version: p.version || null,
        badges: [
          ...(p.license ? [{ text: p.license, tone: 'plain' as const }] : []),
          ...(hooks.length > 0
            ? [{ text: plural(hooks.length, 'install script'), tone: 'warn' as const }]
            : []),
        ],
        fields: [
          ...field('Description', p.description),
          ...field('Dev dependencies', p.devDependencies || null),
        ],
        lists: [
          ...list('Executables', items(p.bin)),
          ...list('Dependencies', items(p.dependencies)),
          ...list('Peer dependencies', items(p.peerDependencies)),
        ],
        scripts: Object.entries(p.scripts).map(([name, body]) => {
          const flag = INSTALL_SCRIPTS[name];
          return flag ? { name, body, flag } : { name, body };
        }),
        warnings: hooks.map(h => `Runs a ${h} script`),
      };
    }
    case 'epub':
      return {
        name: p.title ?? 'Untitled',
        version: null,
        badges: [
          ...(p.version ? [{ text: `EPUB ${p.version}`, tone: 'accent' as const }] : []),
          ...(p.language ? [{ text: p.language, tone: 'plain' as const }] : []),
        ],
        fields: [
          ...field('Author', p.authors.join(', ')),
          ...field('Publisher', p.publisher),
          ...field('Date', p.date),
          ...field('Identifier', p.identifier),
          ...field('Chapters', formatCount(p.chapters.length)),
        ],
        lists: list(
          'Spine',
          items(p.chapters.map(c => (c.title ? `${c.title} — ${c.href}` : c.href))),
        ),
        scripts: [],
        warnings: [],
      };
    case 'rpm':
      return rpmCard(p);
  }
}

export const packageCard = (p: PackageInfo): PackageCard => ({
  title: packageTitle(p),
  ...cardBody(p),
});

/** Info sidebar rows: the package type, name and version, then the card's fields. */
export function packageStats(p: PackageInfo): { label: string; value: string }[] {
  const c = packageCard(p);
  return [
    { label: 'Package', value: c.title },
    { label: 'Name', value: c.name },
    ...(c.version ? [{ label: 'Version', value: c.version }] : []),
    ...c.fields.filter(f => f.label !== 'Package' && f.label !== 'Description'),
    ...(c.warnings.length > 0 ? [{ label: 'Flagged', value: c.warnings.join('; ') }] : []),
  ];
}
