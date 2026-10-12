import { createMemo } from '../content';
import { authSummary, authText } from '../email/auth';
import { formatAddresses } from '../email/headers';
import {
  attachmentBytes,
  bodyText,
  dateText,
  emailLayout,
  looksLikeEmail,
  parseEmail,
  renderedHtml,
} from '../email/message';
import { ATTACHMENT_PREFIX, type EmailValue } from '../email/types';
import { formatBytes, formatCount, oneLine, plural } from '../format';
import { formatDuration } from '../time';
import { hasKind } from '../guards';
import { unsupportedSlice, type Interpreter } from '../interpreter';
import type { StatRow } from '../types';

/** Above YAML (0.85) and Markdown (0.75), which a header block can also look like. */
const CONFIDENCE = 0.9;
/** With an .eml name or message/rfc822 type. */
const HINTED_CONFIDENCE = 0.95;
/** Attachments listed in the sidebar's Open group; the Attachments action gets them all. */
const MAX_OPEN = 20;

const hinted = (c: { name?: string; mime: string }) =>
  /\.eml$/i.test(c.name ?? '') || /^message\/rfc822\b/i.test(c.mime);

const detection = createMemo(c => {
  if (looksLikeEmail(c.bytes, true)) return hinted(c) ? HINTED_CONFIDENCE : CONFIDENCE;
  return hinted(c) && looksLikeEmail(c.bytes, false) ? CONFIDENCE : 0;
});

const files = (v: EmailValue) => v.attachments.filter(a => !a.inline);

function emailStats(v: EmailValue): StatRow[] {
  const dash = (s: string | null) => s || '—';
  const list = files(v);
  const inline = v.attachments.length - list.length;
  const auth = authSummary(v.auth);
  const hops = v.received;
  const first = hops.find(h => h.date !== null)?.date;
  const last = hops.findLast(h => h.date !== null)?.date;
  return [
    { label: 'From', value: dash(formatAddresses(v.from)) },
    { label: 'To', value: dash(formatAddresses(v.to)) },
    ...(v.cc.length ? [{ label: 'Cc', value: formatAddresses(v.cc) }] : []),
    ...(v.bcc.length ? [{ label: 'Bcc', value: formatAddresses(v.bcc) }] : []),
    ...(v.replyTo.length ? [{ label: 'Reply-To', value: formatAddresses(v.replyTo) }] : []),
    { label: 'Date', value: dash(dateText(v)) },
    { label: 'Subject', value: dash(v.subject) },
    { label: 'Message-ID', value: dash(v.messageId) },
    { label: 'Size', value: formatBytes(v.size) },
    {
      label: 'Body',
      value:
        v.htmlPart !== null && v.textPart !== null
          ? 'HTML and plain text'
          : v.htmlPart !== null
            ? 'HTML'
            : v.textPart !== null
              ? 'Plain text'
              : 'None',
    },
    { label: 'Parts', value: formatCount(v.parts.length) },
    {
      label: 'Attachments',
      value: list.length
        ? `${formatCount(list.length)} · ${formatBytes(list.reduce((n, a) => n + a.size, 0))}`
        : '0',
      ...(list.length > 0 && {
        children: list.map(a => ({ label: a.name, value: formatBytes(a.size) })),
      }),
    },
    ...(inline > 0 ? [{ label: 'Inline images', value: formatCount(inline) }] : []),
    ...(['spf', 'dkim', 'dmarc'] as const).flatMap(m => {
      const r = auth[m];
      return r ? [{ label: m.toUpperCase(), value: authText(r) }] : [];
    }),
    ...(hops.length
      ? [
          {
            label: 'Received hops',
            value:
              first && last && hops.length > 1
                ? `${formatCount(hops.length)} · ${formatDuration(Date.parse(last) - Date.parse(first))} in transit`
                : formatCount(hops.length),
          },
        ]
      : []),
    ...v.warnings.map(w => ({ label: 'Note', value: w })),
  ];
}

/** An RFC 5322 message (.eml): headers, MIME parts, body and attachments, parsed in core. */
export const emailInterpreter: Interpreter<EmailValue> = {
  kind: 'email',
  isValue: (v): v is EmailValue => hasKind(v, 'email'),
  detect: detection,
  parse: c => parseEmail(c.bytes),
  label(v) {
    const n = files(v).length;
    return [
      'Email',
      oneLine(v.subject || '(no subject)', 40),
      ...(n > 0 ? [plural(n, 'attachment')] : []),
    ].join(' · ');
  },
  summarise: v => ({ stats: emailStats(v), extent: v.attachments.length }),
  slice(v, req) {
    switch (req.type) {
      case 'json':
        return emailLayout(v);
      case 'html':
        return renderedHtml(v).html;
      case 'text':
        return bodyText(v);
      case 'asset': {
        const a = v.attachments[req.index];
        if (!a) throw new Error(`No attachment ${req.index}`);
        return { bytes: attachmentBytes(v, req.index), mime: a.mime };
      }
      default:
        return unsupportedSlice('email', req);
    }
  },
  export(v) {
    const head = [
      ['From', formatAddresses(v.from)],
      ['To', formatAddresses(v.to)],
      ['Cc', formatAddresses(v.cc)],
      ['Date', dateText(v) ?? ''],
      ['Subject', v.subject ?? ''],
    ]
      .filter(([, value]) => value)
      .map(([k, value]) => `${k}: ${value}`)
      .join('\n');
    const text = `${head}\n\n${bodyText(v)}`;
    return v.htmlPart !== null ? { text, html: renderedHtml(v).html } : { text };
  },
  derivations: v =>
    v.attachments
      .flatMap((a, i) => (a.inline ? [] : [{ id: `${ATTACHMENT_PREFIX}${i}`, label: a.name }]))
      .slice(0, MAX_OPEN),
  canDerive: (v, id) => attachmentIndex(v, id) !== null,
  derive(v, id) {
    const i = attachmentIndex(v, id);
    const a = i === null ? undefined : v.attachments[i];
    if (i === null || !a) throw new Error(`No attachment '${id}'`);
    return { mime: a.mime, name: a.name, bytes: attachmentBytes(v, i).slice() };
  },
};

function attachmentIndex(v: EmailValue, id: string): number | null {
  if (!id.startsWith(ATTACHMENT_PREFIX)) return null;
  const i = Number(id.slice(ATTACHMENT_PREFIX.length));
  return Number.isInteger(i) && i >= 0 && i < v.attachments.length ? i : null;
}
