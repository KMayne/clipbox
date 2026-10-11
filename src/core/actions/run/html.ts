import { convertTree } from '../../html/convert';
import { parseHtml } from '../../html/dom';
import { gridCsv } from '../../csvGrid';
import { extractLinks, extractTables, linksCsv } from '../../html/extract';
import { htmlInterpreter } from '../../interpreters/html';
import type { DerivedContent } from '../../types';
import { htmlExtractLinks, htmlExtractTables, htmlToMarkdown, htmlToText } from '../catalog/html';
import { implement } from '../types';
import { textResult, withExtension } from './util';

/** Cheap checks so Extract links / tables only show up when there's something to extract. */
export const HAS_LINK = /<(a|area)\s[^>]*href/i;
export const HAS_TABLE = /<table[\s>]/i;

/** One CSV per table; several make a collection. */
export function tablesResult(tables: string[][][]): DerivedContent[] {
  return tables
    .filter(t => t.length > 0)
    .map((rows, i) => textResult(gridCsv(rows), 'text/csv', `table-${i + 1}.csv`));
}

export const htmlImpls = [
  implement(htmlToMarkdown, {
    value: htmlInterpreter.isValue,
    run: ({ value, content }) =>
      textResult(
        convertTree(parseHtml(value.html), { mode: 'markdown' }),
        'text/markdown',
        withExtension(content.name, 'md', 'page'),
      ),
  }),
  implement(htmlToText, {
    value: htmlInterpreter.isValue,
    run: ({ value, content }, { linkUrls }) =>
      textResult(
        convertTree(parseHtml(value.html), { mode: 'text', linkUrls }),
        'text/plain',
        withExtension(content.name, 'txt', 'page'),
      ),
  }),
  implement(htmlExtractLinks, {
    value: htmlInterpreter.isValue,
    applies: ({ value }) => HAS_LINK.test(value.html),
    run({ value }, { base }) {
      const links = extractLinks(parseHtml(value.html), base);
      return links.length ? textResult(linksCsv(links), 'text/csv', 'links.csv') : [];
    },
  }),
  implement(htmlExtractTables, {
    value: htmlInterpreter.isValue,
    applies: ({ value }) => HAS_TABLE.test(value.html),
    run: ({ value }) => tablesResult(extractTables(parseHtml(value.html))),
  }),
];
