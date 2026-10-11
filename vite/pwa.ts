import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { HtmlTagDescriptor, Plugin } from 'vite';
import { DEFAULT_SCHEME, schemes } from '../src/theme.ts';
import type { ShareAction } from '../src/swProtocol.ts';

/*
 * Makes Clipbox an installable PWA: emits the web app manifest and its icons (vite/icons/, made by
 * scripts/icons.ts) and links them from index.html. Every URL is built from Vite's `base`, so a
 * subpath deploy (BASE_PATH=/clipbox/) gets a manifest scoped to /clipbox/.
 *
 * The files are emitted into the bundle, so vite/modulesManifest.ts finds them through index.html
 * and the manifest's references and the service worker precaches them with the core.
 */

export const MANIFEST_FILE = 'manifest.webmanifest';
/** Where Android's share sheet POSTs; handled by src/sw.ts. */
export const SHARE_ACTION: ShareAction = 'share-target';

const ICON_DIR = path.resolve(import.meta.dirname, 'icons');
/** Icon files, emitted under icons/. */
const ICON_FILES = [
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-192.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
];

const nord = schemes[DEFAULT_SCHEME];
/** The top bar's colour (and the splash screen's background). */
export const THEME_COLOR = nord.panel;
export const BACKGROUND_COLOR = nord.bg;
const DESCRIPTION =
  'Paste anything (text, JSON, CSV, HTML, images, files) and inspect it: interpretations, preview, stats and schema. Runs entirely in your browser.';

/** File types the installed desktop app offers to open (Chromium's file handling). */
const FILE_TYPES: Record<string, string[]> = {
  'text/plain': ['.txt', '.log'],
  'text/csv': ['.csv'],
  'text/tab-separated-values': ['.tsv'],
  'text/markdown': ['.md'],
  'text/html': ['.html', '.htm'],
  'text/xml': ['.xml'],
  'application/json': ['.json', '.geojson'],
  'application/x-ndjson': ['.ndjson', '.jsonl'],
  'application/yaml': ['.yaml', '.yml'],
  'application/pdf': ['.pdf'],
  'application/zip': ['.zip'],
  'application/gzip': ['.gz', '.tgz'],
  'application/x-tar': ['.tar'],
  'application/x-7z-compressed': ['.7z'],
  'application/vnd.sqlite3': ['.sqlite', '.db'],
  'application/x-pem-file': ['.pem', '.crt', '.cer'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
  'application/vnd.oasis.opendocument.spreadsheet': ['.ods'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'image/svg+xml': ['.svg'],
};

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: 'any' | 'maskable';
}

export interface WebManifest {
  id: string;
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: 'standalone';
  theme_color: string;
  background_color: string;
  categories: string[];
  icons: ManifestIcon[];
  share_target: {
    action: string;
    method: 'POST';
    enctype: 'multipart/form-data';
    params: {
      title: string;
      text: string;
      url: string;
      files: { name: string; accept: string[] }[];
    };
  };
  file_handlers: { action: string; accept: Record<string, string[]> }[];
  launch_handler: { client_mode: string[] };
  handle_links: 'preferred';
}

/** `base` as Vite resolves it: '/' or '/sub/path/' (leading and trailing slashes). */
export function webManifest(base: string): WebManifest {
  const at = (file: string) => `${base}${file}`;
  const icon = (file: string, px: number, purpose: ManifestIcon['purpose']): ManifestIcon => ({
    src: at(`icons/${file}`),
    sizes: `${px}x${px}`,
    type: 'image/png',
    purpose,
  });
  return {
    id: base,
    name: 'Clipbox',
    short_name: 'Clipbox',
    description: DESCRIPTION,
    start_url: base,
    scope: base,
    display: 'standalone',
    theme_color: THEME_COLOR,
    background_color: BACKGROUND_COLOR,
    categories: ['developer', 'utilities', 'productivity'],
    icons: [
      icon('icon-192.png', 192, 'any'),
      icon('icon-512.png', 512, 'any'),
      icon('icon-maskable-192.png', 192, 'maskable'),
      icon('icon-maskable-512.png', 512, 'maskable'),
    ],
    share_target: {
      action: at(SHARE_ACTION),
      method: 'POST',
      enctype: 'multipart/form-data',
      params: {
        title: 'title',
        text: 'text',
        url: 'url',
        files: [{ name: 'files', accept: ['*/*'] }],
      },
    },
    file_handlers: [{ action: base, accept: FILE_TYPES }],
    // Shares, opened files and links reuse the open window rather than stacking new ones
    launch_handler: { client_mode: ['navigate-existing', 'auto'] },
    handle_links: 'preferred',
  };
}

/** The tags index.html needs for installing, theming the browser UI and iOS's home screen. */
export function headTags(base: string): HtmlTagDescriptor[] {
  const meta = (name: string, content: string): HtmlTagDescriptor => ({
    tag: 'meta',
    attrs: { name, content },
    injectTo: 'head',
  });
  const link = (attrs: Record<string, string>): HtmlTagDescriptor => ({
    tag: 'link',
    attrs,
    injectTo: 'head',
  });
  return [
    meta('description', DESCRIPTION),
    meta('theme-color', THEME_COLOR),
    link({ rel: 'manifest', href: `${base}${MANIFEST_FILE}` }),
    link({ rel: 'icon', type: 'image/svg+xml', href: `${base}icons/icon.svg` }),
    link({ rel: 'apple-touch-icon', href: `${base}icons/apple-touch-icon.png` }),
    // iOS: full-screen from the home screen, under a translucent status bar (safe-area padding
    // keeps content clear of it)
    meta('mobile-web-app-capable', 'yes'),
    meta('apple-mobile-web-app-capable', 'yes'),
    meta('apple-mobile-web-app-title', 'Clipbox'),
    meta('apple-mobile-web-app-status-bar-style', 'black-translucent'),
  ];
}

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

export function pwa(): Plugin {
  let base = '/';
  let build = false;
  return {
    name: 'clipbox:pwa',
    configResolved(config) {
      base = config.base;
      build = config.command === 'build';
    },
    transformIndexHtml: () => headTags(base),
    async buildStart() {
      // Only the production build emits files; the dev server serves them below
      if (!build) return;
      this.emitFile({
        type: 'asset',
        fileName: MANIFEST_FILE,
        source: JSON.stringify(webManifest(base), null, 2),
      });
      for (const file of ICON_FILES) {
        this.emitFile({
          type: 'asset',
          fileName: `icons/${file}`,
          source: await readFile(path.join(ICON_DIR, file)),
        });
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        if (pathname === `${base}${MANIFEST_FILE}`) {
          res.setHeader('Content-Type', 'application/manifest+json');
          res.end(JSON.stringify(webManifest(base), null, 2));
          return;
        }
        const file = pathname.startsWith(`${base}icons/`)
          ? pathname.slice(`${base}icons/`.length)
          : null;
        if (file === null || !ICON_FILES.includes(file)) return next();
        readFile(path.join(ICON_DIR, file)).then(data => {
          res.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream');
          res.end(data);
        }, next);
      });
    },
  };
}
