export const theme = {
  bg: '#1e1e1e',
  panel: '#2a2a2a',
  raised: '#333',
  hover: '#3a3a3a',
  text: '#e0e0e0',
  muted: '#9a9a9a',
  border: '#555',
  subtle: '#3d3d3d',
  accent: '#4ea1ff',
  error: '#ff6b6b',
  mono: "ui-monospace, 'JetBrains Mono', Menlo, Consolas, monospace",
  sans: "system-ui, -apple-system, 'Segoe UI', sans-serif",
};

export const kindColors: Record<string, string> = {
  json: '#e5c07b',
  records: '#98c379',
  text: '#abb2bf',
  html: '#e06c75',
  image: '#c678dd',
  binary: '#56b6c2',
  yaml: '#d19a66',
  xml: '#61afef',
  markdown: '#ff9e64',
  ndjson: '#e0af68',
  base64: '#7aa2f7',
  jwt: '#f7768e',
  timestamp: '#b4befe',
  uuid: '#94e2d5',
  url: '#4ec9b0',
  colour: '#f78c6c',
  pem: '#c3e88d',
  pdf: '#ff5370',
};

export const kindColor = (kind: string) => kindColors[kind] ?? theme.muted;
