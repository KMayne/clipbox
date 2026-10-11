import type { Kind } from './types';

const NAMES: Record<string, string> = {
  json: 'JSON',
  records: 'Records',
  text: 'Text',
  html: 'HTML',
  image: 'Image',
  binary: 'Binary',
};

export const kindName = (kind: Kind) => NAMES[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
