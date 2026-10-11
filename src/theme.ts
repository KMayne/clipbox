/**
 * Gruvbox dark palette (https://github.com/morhetz/gruvbox, MIT, © Pavel Pertsev).
 * Components use the semantic tokens in `theme`, not these raw values.
 */
export const gruvbox = {
  bg0h: '#1d2021',
  bg0: '#282828',
  bg0s: '#32302f',
  bg1: '#3c3836',
  bg2: '#504945',
  bg3: '#665c54',
  bg4: '#7c6f64',
  gray: '#928374',
  fg4: '#a89984',
  fg3: '#bdae93',
  fg2: '#d5c4a1',
  fg1: '#ebdbb2',
  red: '#fb4934',
  green: '#b8bb26',
  yellow: '#fabd2f',
  blue: '#83a598',
  purple: '#d3869b',
  aqua: '#8ec07c',
  orange: '#fe8019',
  redDim: '#cc241d',
  greenDim: '#98971a',
  yellowDim: '#d79921',
  blueDim: '#458588',
  purpleDim: '#b16286',
  aquaDim: '#689d6a',
  orangeDim: '#d65d0e',
};

const g = gruvbox;

/** `#rrggbb` → `rgba(r, g, b, alpha)`. */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export const theme = {
  bg: g.bg0,
  panel: g.bg0h,
  raised: g.bg1,
  hover: g.bg2,
  text: g.fg3,
  muted: g.gray,
  /** De-emphasised text: line numbers, row indexes, offsets. */
  faint: g.bg4,
  border: g.bg3,
  subtle: g.bg1,
  /** Hairlines between table rows. */
  rowBorder: g.bg0s,
  accent: g.blue,
  accentSoft: withAlpha(g.blue, 0.15),
  /** Text on coloured badges and accent fills. */
  onAccent: g.bg0h,
  error: g.red,
  warning: g.yellow,
  success: g.green,
  scrollbar: g.bg2,
  mono: "ui-monospace, 'JetBrains Mono', Menlo, Consolas, monospace",
  sans: "system-ui, -apple-system, 'Segoe UI', sans-serif",
};

/** Value colours for JSON-like trees. */
export const syntax = {
  key: g.blue,
  string: g.green,
  number: g.purple,
  boolean: g.orange,
  null: g.gray,
  punctuation: g.gray,
};

export const kindColors: Record<string, string> = {
  json: g.yellow,
  ndjson: g.yellowDim,
  records: g.green,
  spreadsheet: g.greenDim,
  sqlite: g.aquaDim,
  yaml: g.aqua,
  text: g.fg4,
  markdown: g.fg2,
  html: g.orange,
  xml: g.orangeDim,
  image: g.purple,
  video: g.purpleDim,
  audio: g.blue,
  base64: g.blueDim,
  binary: g.gray,
  archive: g.fg3,
  pdf: g.red,
  jwt: g.redDim,
  pem: g.aqua,
  timestamp: g.blue,
  uuid: g.purpleDim,
  url: g.blueDim,
  colour: g.orange,
};

export const kindColor = (kind: string) => kindColors[kind] ?? theme.muted;
