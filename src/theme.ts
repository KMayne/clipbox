import { z } from 'zod';

/**
 * Colour schemes. Each supplies the same neutrals and hues; everything else (semantic tokens,
 * syntax, kind colours, the Monaco theme) derives from the active scheme. Components use the
 * derived tokens, never raw scheme values.
 */

interface Hues {
  red: string;
  orange: string;
  yellow: string;
  green: string;
  aqua: string;
  blue: string;
  purple: string;
}

export interface Scheme {
  label: string;
  /** Source and licence, for NOTICE. */
  credit: string;
  bg: string;
  /** Sidebars and headers; usually darker than bg. */
  panel: string;
  raised: string;
  hover: string;
  border: string;
  subtle: string;
  rowBorder: string;
  text: string;
  muted: string;
  faint: string;
  gray: string;
  hue: Hues;
  /** Darker or alternate variants, used to tell related kinds apart. */
  dim: Hues;
}

export const schemes = {
  gruvbox: {
    label: 'Gruvbox dark',
    credit: 'Gruvbox by Pavel Pertsev (morhetz), MIT, https://github.com/morhetz/gruvbox',
    bg: '#282828',
    panel: '#1d2021',
    raised: '#3c3836',
    hover: '#504945',
    border: '#665c54',
    subtle: '#3c3836',
    rowBorder: '#32302f',
    text: '#bdae93',
    muted: '#928374',
    faint: '#7c6f64',
    gray: '#928374',
    hue: {
      red: '#fb4934',
      orange: '#fe8019',
      yellow: '#fabd2f',
      green: '#b8bb26',
      aqua: '#8ec07c',
      blue: '#83a598',
      purple: '#d3869b',
    },
    dim: {
      red: '#cc241d',
      orange: '#d65d0e',
      yellow: '#d79921',
      green: '#98971a',
      aqua: '#689d6a',
      blue: '#458588',
      purple: '#b16286',
    },
  },
  'tokyo-night': {
    label: 'Tokyo Night',
    credit: 'Tokyo Night by enkia, MIT, https://github.com/enkia/tokyo-night-vscode-theme',
    bg: '#1a1b26',
    panel: '#16161e',
    raised: '#24283b',
    hover: '#292e42',
    border: '#3b4261',
    subtle: '#24283b',
    rowBorder: '#1f2335',
    text: '#c0caf5',
    muted: '#737aa2',
    faint: '#545c7e',
    gray: '#565f89',
    hue: {
      red: '#f7768e',
      orange: '#ff9e64',
      yellow: '#e0af68',
      green: '#9ece6a',
      aqua: '#7dcfff',
      blue: '#7aa2f7',
      purple: '#bb9af7',
    },
    dim: {
      red: '#db4b4b',
      orange: '#ff757f',
      yellow: '#cfc9c2',
      green: '#73daca',
      aqua: '#2ac3de',
      blue: '#3d59a1',
      purple: '#9d7cd8',
    },
  },
  'catppuccin-mocha': {
    label: 'Catppuccin Mocha',
    credit: 'Catppuccin, MIT, https://github.com/catppuccin/catppuccin',
    bg: '#1e1e2e',
    panel: '#181825',
    raised: '#313244',
    hover: '#45475a',
    border: '#585b70',
    subtle: '#313244',
    rowBorder: '#262637',
    text: '#cdd6f4',
    muted: '#7f849c',
    faint: '#6c7086',
    gray: '#9399b2',
    hue: {
      red: '#f38ba8',
      orange: '#fab387',
      yellow: '#f9e2af',
      green: '#a6e3a1',
      aqua: '#94e2d5',
      blue: '#89b4fa',
      purple: '#cba6f7',
    },
    dim: {
      red: '#eba0ac',
      orange: '#f2cdcd',
      yellow: '#f5e0dc',
      green: '#94e2d5',
      aqua: '#89dceb',
      blue: '#74c7ec',
      purple: '#b4befe',
    },
  },
  nord: {
    label: 'Nord',
    credit: 'Nord by Arctic Ice Studio, MIT, https://www.nordtheme.com',
    bg: '#2e3440',
    panel: '#272c36',
    raised: '#3b4252',
    hover: '#434c5e',
    border: '#4c566a',
    subtle: '#3b4252',
    rowBorder: '#343b48',
    text: '#d8dee9',
    muted: '#7b88a1',
    faint: '#616e88',
    gray: '#616e88',
    hue: {
      red: '#bf616a',
      orange: '#d08770',
      yellow: '#ebcb8b',
      green: '#a3be8c',
      aqua: '#8fbcbb',
      blue: '#88c0d0',
      purple: '#b48ead',
    },
    dim: {
      red: '#a5545c',
      orange: '#b67462',
      yellow: '#d4b67c',
      green: '#8fa87b',
      aqua: '#7aa8a7',
      blue: '#5e81ac',
      purple: '#81a1c1',
    },
  },
  'one-dark': {
    label: 'One Dark',
    credit: 'One Dark (Atom), MIT, https://github.com/atom/atom',
    bg: '#282c34',
    panel: '#21252b',
    raised: '#2c313a',
    hover: '#333842',
    border: '#3e4451',
    subtle: '#2c313a',
    rowBorder: '#2c313a',
    text: '#abb2bf',
    muted: '#7f848e',
    faint: '#5c6370',
    gray: '#5c6370',
    hue: {
      red: '#e06c75',
      orange: '#d19a66',
      yellow: '#e5c07b',
      green: '#98c379',
      aqua: '#56b6c2',
      blue: '#61afef',
      purple: '#c678dd',
    },
    dim: {
      red: '#be5046',
      orange: '#b5835a',
      yellow: '#c8a76b',
      green: '#7fa666',
      aqua: '#4a9ba5',
      blue: '#528bff',
      purple: '#a35fbd',
    },
  },
} satisfies Record<string, Scheme>;

export type SchemeId = keyof typeof schemes;

export const DEFAULT_SCHEME: SchemeId = 'nord';
const STORAGE_KEY = 'clipbox.theme';

const schemeIdSchema = z.enum([
  'gruvbox',
  'tokyo-night',
  'catppuccin-mocha',
  'nord',
  'one-dark',
]) satisfies z.ZodType<SchemeId>;

function storedSchemeId(): SchemeId | null {
  try {
    const parsed = schemeIdSchema.safeParse(localStorage.getItem(STORAGE_KEY));
    return parsed.success ? parsed.data : null;
  } catch {
    return null; // storage unavailable
  }
}

/**
 * Chosen once at load, because components build their styles from these tokens when imported:
 * `?theme=<id>` (for previews) beats the saved choice, which beats the default.
 */
function activeSchemeId(): SchemeId {
  if (typeof location === 'undefined') return DEFAULT_SCHEME;
  const requested = schemeIdSchema.safeParse(new URLSearchParams(location.search).get('theme'));
  if (requested.success) return requested.data;
  return storedSchemeId() ?? DEFAULT_SCHEME;
}

/** Saves the scheme and reloads, since styles are built from the scheme at load. */
export function setScheme(id: SchemeId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // storage unavailable: the choice won't persist
  }
  const url = new URL(location.href);
  url.searchParams.delete('theme');
  location.replace(url);
}

export const schemeId = activeSchemeId();
/** The active scheme's raw colours. Prefer the semantic tokens below. */
export const palette: Scheme = schemes[schemeId];
const p = palette;

/** `#rrggbb` → `rgba(r, g, b, alpha)`. */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export const theme = {
  bg: p.bg,
  panel: p.panel,
  raised: p.raised,
  hover: p.hover,
  text: p.text,
  muted: p.muted,
  /** De-emphasised text: line numbers, row indexes, offsets. */
  faint: p.faint,
  border: p.border,
  subtle: p.subtle,
  /** Hairlines between table rows. */
  rowBorder: p.rowBorder,
  accent: p.hue.blue,
  accentSoft: withAlpha(p.hue.blue, 0.15),
  /** Text on coloured badges and accent fills. */
  onAccent: p.panel,
  error: p.hue.red,
  warning: p.hue.yellow,
  success: p.hue.green,
  scrollbar: p.hover,
  mono: "ui-monospace, 'JetBrains Mono', Menlo, Consolas, monospace",
  sans: "system-ui, -apple-system, 'Segoe UI', sans-serif",
};

/** Value colours for JSON-like trees. */
export const syntax = {
  key: p.hue.blue,
  string: p.hue.green,
  number: p.hue.purple,
  boolean: p.hue.orange,
  null: p.gray,
  punctuation: p.gray,
};

export const kindColors: Record<string, string> = {
  json: p.hue.yellow,
  ndjson: p.dim.yellow,
  records: p.hue.green,
  spreadsheet: p.dim.green,
  sqlite: p.dim.aqua,
  yaml: p.hue.aqua,
  text: p.muted,
  markdown: p.text,
  html: p.hue.orange,
  xml: p.dim.orange,
  image: p.hue.purple,
  video: p.dim.purple,
  audio: p.hue.blue,
  base64: p.dim.blue,
  binary: p.gray,
  archive: p.dim.yellow,
  pdf: p.hue.red,
  jwt: p.dim.red,
  pem: p.hue.aqua,
  timestamp: p.hue.blue,
  uuid: p.dim.purple,
  url: p.dim.blue,
  colour: p.hue.orange,
};

export const kindColor = (kind: string) => kindColors[kind] ?? theme.muted;
