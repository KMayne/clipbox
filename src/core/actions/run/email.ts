import { toCsv } from '../../csv';
import type { EmailValue } from '../../email/types';
import { attachmentBytes, bodyMarkdown, bodyText, headersJson } from '../../email/message';
import { uniqueFileNames } from '../../filenames';
import { emailInterpreter } from '../../interpreters/email';
import { formatDuration } from '../../time';
import {
  emailAttachments,
  emailBodyMarkdown,
  emailBodyText,
  emailHeadersJson,
  emailReceivedChain,
} from '../catalog/email';
import { implement } from '../types';
import { textResult, withExtension } from './util';

const value = emailInterpreter.isValue;
const hasBody = ({ value }: { value: EmailValue }) =>
  value.htmlPart !== null || value.textPart !== null;

export const emailImpls = [
  implement(emailAttachments, {
    value,
    applies: ({ value }) => value.attachments.length > 0,
    run({ value }, { inline }) {
      const picked = value.attachments.flatMap((a, i) => (inline || !a.inline ? [{ a, i }] : []));
      if (picked.length === 0) throw new Error('This email has only inline images');
      // Unique, so a collection saved with "Download all" keeps every file
      const names = uniqueFileNames(picked.map(({ a }) => ({ name: a.name, mime: a.mime })));
      return picked.map(({ a, i }, n) => ({
        mime: a.mime,
        name: names[n] ?? a.name,
        bytes: attachmentBytes(value, i).slice(),
      }));
    },
  }),
  implement(emailBodyText, {
    value,
    applies: hasBody,
    run: ({ value, content }) =>
      textResult(bodyText(value), 'text/plain', withExtension(content.name, 'txt', 'body')),
  }),
  implement(emailBodyMarkdown, {
    value,
    applies: hasBody,
    run: ({ value, content }) =>
      textResult(bodyMarkdown(value), 'text/markdown', withExtension(content.name, 'md', 'body')),
  }),
  implement(emailHeadersJson, {
    value,
    run: ({ value, content }) =>
      textResult(
        JSON.stringify(headersJson(value), null, 2),
        'application/json',
        withExtension(content.name, 'json', 'headers'),
      ),
  }),
  implement(emailReceivedChain, {
    value,
    applies: ({ value }) => value.received.length > 0,
    run({ value }, { format }) {
      if (format === 'json') {
        return textResult(
          JSON.stringify(value.received, null, 2),
          'application/json',
          'received.json',
        );
      }
      // A table (the records kind): seconds for sorting, plus a readable delay
      const rows = value.received.map(h => ({
        ...h,
        after: h.delay === null ? '' : formatDuration(h.delay * 1000, 'short'),
      }));
      return textResult(
        toCsv(rows, ['hop', 'date', 'delay', 'after', 'from', 'by', 'with', 'id', 'for']),
        'text/csv',
        'received.csv',
      );
    },
  }),
];
