import type { Language } from './languages';

const SHEBANGS: [RegExp, Language][] = [
  [/\b(ba|z|da|k)?sh\b/, { monaco: 'shell', name: 'Shell' }],
  [/\bpython[\d.]*\b/, { monaco: 'python', name: 'Python' }],
  [/\b(node|deno|bun)\b/, { monaco: 'javascript', name: 'JavaScript' }],
  [/\b(tsx|ts-node)\b/, { monaco: 'typescript', name: 'TypeScript' }],
  [/\bruby\b/, { monaco: 'ruby', name: 'Ruby' }],
  [/\bperl\b/, { monaco: 'perl', name: 'Perl' }],
  [/\bpwsh\b/, { monaco: 'powershell', name: 'PowerShell' }],
];

/** Cheap, certain signals checked before running the model. */
export function detectByHeuristic(text: string): Language | null {
  const head = text.trimStart().slice(0, 200);
  const shebang = /^#!(.*)/.exec(head)?.[1];
  if (shebang) return SHEBANGS.find(([re]) => re.test(shebang))?.[1] ?? null;
  if (head.startsWith('<?php')) return { monaco: 'php', name: 'PHP' };
  if (head.startsWith('<?xml')) return { monaco: 'xml', name: 'XML' };
  return null;
}
