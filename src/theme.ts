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
};

export const kindColor = (kind: string) => kindColors[kind] ?? theme.muted;
