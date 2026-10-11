import type { Kind } from './types';

const NAMES: Record<string, string> = {
  json: 'JSON',
  records: 'Records',
  text: 'Text',
  html: 'HTML',
  image: 'Image',
  binary: 'Binary',
  yaml: 'YAML',
  xml: 'XML',
  markdown: 'Markdown',
  ndjson: 'NDJSON',
  base64: 'Base64',
  jwt: 'JWT',
  uuid: 'UUID',
  url: 'URL',
  pem: 'PEM',
  audio: 'Audio',
  video: 'Video',
  sqlite: 'SQLite',
};

export const kindName = (kind: Kind) => NAMES[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
