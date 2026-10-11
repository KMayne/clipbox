import { Marked, type Token } from 'marked';
import { convertTree } from '../../html/convert';
import { parseHtml, serialize } from '../../html/dom';
import { extractLinks, extractTables, linksCsv, sanitiseTree } from '../../html/extract';
import { markdownInterpreter } from '../../interpreters/markdown';
import type { DerivedContent } from '../../types';
import {
  markdownExtractCode,
  markdownExtractLinks,
  markdownExtractTables,
  markdownToHtml,
  markdownToText,
} from '../catalog/markdown';
import { implement } from '../types';
import { HAS_LINK, HAS_TABLE, tablesResult } from './html';
import { textResult, withExtension } from './util';

const marked = new Marked({ gfm: true });

/** Extension and MIME type for a fenced block's language tag. */
const LANGUAGES: Record<string, [string, string?]> = {
  js: ['js', 'text/javascript'],
  javascript: ['js', 'text/javascript'],
  jsx: ['jsx', 'text/javascript'],
  mjs: ['mjs', 'text/javascript'],
  ts: ['ts'],
  typescript: ['ts'],
  tsx: ['tsx'],
  json: ['json', 'application/json'],
  jsonc: ['jsonc'],
  json5: ['json5'],
  ndjson: ['ndjson', 'application/x-ndjson'],
  yaml: ['yaml', 'application/yaml'],
  yml: ['yaml', 'application/yaml'],
  toml: ['toml'],
  ini: ['ini'],
  xml: ['xml', 'application/xml'],
  html: ['html', 'text/html'],
  svg: ['svg', 'image/svg+xml'],
  css: ['css', 'text/css'],
  scss: ['scss'],
  sass: ['sass'],
  less: ['less'],
  md: ['md', 'text/markdown'],
  markdown: ['md', 'text/markdown'],
  csv: ['csv', 'text/csv'],
  tsv: ['tsv', 'text/tab-separated-values'],
  sql: ['sql'],
  py: ['py'],
  python: ['py'],
  python3: ['py'],
  rb: ['rb'],
  ruby: ['rb'],
  go: ['go'],
  golang: ['go'],
  rs: ['rs'],
  rust: ['rs'],
  java: ['java'],
  kotlin: ['kt'],
  kt: ['kt'],
  swift: ['swift'],
  c: ['c'],
  h: ['h'],
  cpp: ['cpp'],
  'c++': ['cpp'],
  cc: ['cpp'],
  hpp: ['hpp'],
  cs: ['cs'],
  csharp: ['cs'],
  'c#': ['cs'],
  fs: ['fs'],
  fsharp: ['fs'],
  php: ['php'],
  pl: ['pl'],
  perl: ['pl'],
  lua: ['lua'],
  r: ['r'],
  scala: ['scala'],
  dart: ['dart'],
  elixir: ['ex'],
  ex: ['ex'],
  erlang: ['erl'],
  haskell: ['hs'],
  hs: ['hs'],
  clojure: ['clj'],
  ocaml: ['ml'],
  zig: ['zig'],
  nim: ['nim'],
  sh: ['sh'],
  bash: ['sh'],
  shell: ['sh'],
  zsh: ['sh'],
  console: ['sh'],
  fish: ['fish'],
  ps1: ['ps1'],
  powershell: ['ps1'],
  pwsh: ['ps1'],
  bat: ['bat'],
  cmd: ['bat'],
  dockerfile: ['Dockerfile'],
  docker: ['Dockerfile'],
  makefile: ['Makefile'],
  make: ['Makefile'],
  graphql: ['graphql'],
  gql: ['graphql'],
  proto: ['proto'],
  protobuf: ['proto'],
  diff: ['diff'],
  patch: ['patch'],
  vue: ['vue'],
  svelte: ['svelte'],
  tex: ['tex'],
  latex: ['tex'],
  mermaid: ['mmd'],
  dot: ['dot'],
  graphviz: ['dot'],
  nginx: ['conf'],
  apache: ['conf'],
  hcl: ['hcl'],
  terraform: ['tf'],
  tf: ['tf'],
  asm: ['asm'],
  wasm: ['wat'],
  wat: ['wat'],
  vb: ['vb'],
  matlab: ['m'],
  julia: ['jl'],
  groovy: ['groovy'],
  gradle: ['gradle'],
  text: ['txt'],
  txt: ['txt'],
  plaintext: ['txt'],
};

export interface CodeBlock {
  lang: string;
  code: string;
}

/** Fenced and indented code blocks, in order, including ones nested in lists and quotes. */
export function codeBlocks(source: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  marked.walkTokens(marked.lexer(source), (t: Token) => {
    if (t.type !== 'code') return;
    const lang = typeof t.lang === 'string' ? (t.lang.trim().split(/[\s{]/)[0] ?? '') : '';
    blocks.push({ lang, code: typeof t.text === 'string' ? t.text : '' });
  });
  return blocks;
}

/** `code-2.py`; a bare `Dockerfile`-style name keeps its number as a suffix. */
export function codeFile(block: CodeBlock, index: number): DerivedContent {
  const [ext = 'txt', mime = 'text/plain'] = LANGUAGES[block.lang.toLowerCase()] ?? [
    /^[a-z0-9]{1,8}$/i.test(block.lang) ? block.lang.toLowerCase() : 'txt',
  ];
  const name = /^[A-Z]/.test(ext) ? `${ext}-${index}` : `code-${index}.${ext}`;
  const text = block.code.endsWith('\n') ? block.code : `${block.code}\n`;
  return textResult(text, mime, name);
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A standalone page around rendered Markdown. */
export const htmlDocument = (title: string, body: string) =>
  [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    '</head>',
    '<body>',
    body.trimEnd(),
    '</body>',
    '</html>',
    '',
  ].join('\n');

const stem = (name: string | undefined) => name?.replace(/\.[^./\\]*$/, '') ?? '';

export const markdownImpls = [
  implement(markdownToHtml, {
    value: markdownInterpreter.isValue,
    run({ value, content }, { sanitise, document, title }) {
      const body = sanitise ? serialize(sanitiseTree(parseHtml(value.html))) : value.html;
      const name = withExtension(content.name, 'html', 'document');
      if (!document) return textResult(body, 'text/html', name);
      const heading = value.outline[0]?.text;
      const pageTitle = title.trim() || heading || stem(content.name) || 'Document';
      return textResult(htmlDocument(pageTitle, body), 'text/html', name);
    },
  }),
  implement(markdownToText, {
    value: markdownInterpreter.isValue,
    run: ({ value, content }, { linkUrls }) =>
      textResult(
        convertTree(parseHtml(value.html), { mode: 'text', linkUrls }),
        'text/plain',
        withExtension(content.name, 'txt', 'document'),
      ),
  }),
  implement(markdownExtractLinks, {
    value: markdownInterpreter.isValue,
    applies: ({ value }) => HAS_LINK.test(value.html),
    run({ value }, { base }) {
      const links = extractLinks(parseHtml(value.html), base);
      return links.length ? textResult(linksCsv(links), 'text/csv', 'links.csv') : [];
    },
  }),
  implement(markdownExtractCode, {
    value: markdownInterpreter.isValue,
    applies: ({ value }) => value.html.includes('<pre>') || value.html.includes('<pre '),
    run: ({ value }) => codeBlocks(value.source).map((b, i) => codeFile(b, i + 1)),
  }),
  implement(markdownExtractTables, {
    value: markdownInterpreter.isValue,
    applies: ({ value }) => HAS_TABLE.test(value.html),
    run: ({ value }) => tablesResult(extractTables(parseHtml(value.html))),
  }),
];
