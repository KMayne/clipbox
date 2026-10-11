import type { DerivedContent } from '../../types';

/** UTF-8 text as derived content. */
export const textResult = (text: string, mime = 'text/plain', name?: string): DerivedContent => ({
  mime,
  ...(name !== undefined && { name }),
  bytes: new TextEncoder().encode(text),
});

/** Lines without their endings; a trailing newline doesn't make an extra empty line. */
export function splitLines(text: string): { lines: string[]; trailingNewline: boolean } {
  const lines = text.split(/\r?\n/);
  const trailingNewline = lines.length > 1 && lines.at(-1) === '';
  if (trailingNewline) lines.pop();
  return { lines, trailingNewline };
}

export const joinLines = (lines: string[], trailingNewline: boolean) =>
  lines.join('\n') + (trailingNewline ? '\n' : '');

/** `name` with its extension replaced (or added), e.g. "photo.png" → "photo.webp". */
export function withExtension(name: string | undefined, ext: string, fallback: string): string {
  const base = name ? name.replace(/\.[^./\\]*$/, '') : fallback;
  return `${base || fallback}.${ext}`;
}
