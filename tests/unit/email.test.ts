import { describe, expect, it } from 'vitest';
import { authResults, authSummary, parseAuthResults } from '../../src/core/email/auth';
import {
  decodeWords,
  formatAddresses,
  formatMailDate,
  parseAddressList,
  parseHeaderBlock,
  parseMailDate,
  parseParams,
} from '../../src/core/email/headers';
import {
  bodyMarkdown,
  bodyText,
  emailLayout,
  headersJson,
  parseEmail,
  renderedHtml,
} from '../../src/core/email/message';
import {
  decodeQuotedPrintable,
  MAX_DEPTH,
  MAX_PARTS,
  parseMime,
  partText,
} from '../../src/core/email/mime';
import { parseReceived, receivedChain } from '../../src/core/email/received';
import { emailLayoutSchema } from '../../src/core/email/types';
import { register } from '../../src/core/interpreter';
import { detectKinds } from '../../src/core/interpreters';
import { emailInterpreter } from '../../src/core/interpreters/email';
import { INLINE_PNG, PDF_BYTES, sampleEml, simpleEml } from '../fixtures/email';
import { bytesContent, textContent } from './helpers';

const email = register(emailInterpreter);
const enc = (s: string) => new TextEncoder().encode(s);
const stat = (stats: { label: string; value: string }[], label: string) =>
  stats.find(s => s.label === label)?.value;

describe('email headers', () => {
  it('unfolds folded fields and keeps their order', () => {
    const { headers, malformed } = parseHeaderBlock(
      'Subject: a long\r\n  subject line\r\nX-A: 1\r\nX-A: 2\r\nnot a field\r\n',
    );
    expect(headers).toEqual([
      { name: 'Subject', value: 'a long  subject line' },
      { name: 'X-A', value: '1' },
      { name: 'X-A', value: '2' },
    ]);
    expect(malformed).toBe(1);
  });

  it('decodes RFC 2047 words in B and Q, joining adjacent ones', () => {
    expect(decodeWords('=?UTF-8?B?SGVsbG8=?= =?UTF-8?Q?_w=C3=B6rld?=')).toBe('Hello wörld');
    expect(decodeWords('Re: =?iso-8859-1?q?caf=E9?= time')).toBe('Re: café time');
    // A multi-byte character split across two words
    expect(decodeWords('=?UTF-8?B?4oK=?= =?UTF-8?B?rA==?=')).toBe('€');
    // Unknown charsets fall back to latin1
    expect(decodeWords('=?x-unknown?Q?caf=E9?=')).toBe('café');
    expect(decodeWords('no words here')).toBe('no words here');
  });

  it('reads parameters with quoting, comments and RFC 2231 continuations', () => {
    expect(parseParams('Text/HTML; charset="utf-8" (comment); format=flowed')).toEqual({
      value: 'text/html',
      params: { charset: 'utf-8', format: 'flowed' },
    });
    expect(
      parseParams(
        'attachment; filename=fallback.txt; filename*0*=iso-8859-1\'en\'r%E9sum%E9; filename*1=".txt"',
      ).params.filename,
    ).toBe('résumé.txt');
    expect(parseParams('attachment; filename="=?UTF-8?Q?na=C3=AFve.pdf?="').params.filename).toBe(
      'naïve.pdf',
    );
  });

  it('parses address lists with quoted names, comments and groups', () => {
    expect(
      parseAddressList(
        '"Smith, John" <john@x.org>, =?UTF-8?Q?J=C3=B6rg?= <j@y.de>, bare@z.com, ' +
          'Team: a@t.com, B <b@t.com>;, undisclosed-recipients:;',
      ),
    ).toEqual([
      { name: 'Smith, John', address: 'john@x.org' },
      { name: 'Jörg', address: 'j@y.de' },
      { name: null, address: 'bare@z.com' },
      { name: null, address: 'a@t.com', group: 'Team' },
      { name: 'B', address: 'b@t.com', group: 'Team' },
      { name: null, address: null, group: 'undisclosed-recipients' },
    ]);
    expect(
      formatAddresses(parseAddressList('a@x.org, Team: b@t.com, "C, D" <c@t.com>;, empty:;')),
    ).toBe('a@x.org, Team: b@t.com, "C, D" <c@t.com>;, empty: ;');
    expect(parseAddressList('ann@x.org (Ann Example)')).toEqual([
      { name: 'Ann Example', address: 'ann@x.org' },
    ]);
  });

  it('parses dates with offsets, obsolete zones and comments', () => {
    const d = parseMailDate('Tue, 1 Jul 2003 10:52:37 +0200 (CEST)');
    expect(d && new Date(d.ms).toISOString()).toBe('2003-07-01T08:52:37.000Z');
    expect(d && formatMailDate(d)).toBe('2003-07-01 10:52:37 +02:00');
    const pst = parseMailDate('2 Jan 99 08:00 PST');
    expect(pst && new Date(pst.ms).toISOString()).toBe('1999-01-02T16:00:00.000Z');
    expect(parseMailDate('yesterday')).toBeNull();
  });
});

describe('MIME', () => {
  it('decodes quoted-printable soft breaks and trailing whitespace', () => {
    const out = new TextDecoder().decode(
      decodeQuotedPrintable('caf=C3=A9 soft=\r\nbreak   \r\nend= \r\n!'),
    );
    expect(out).toBe('café softbreak\r\nend!');
  });

  it('builds the tree: alternative inside related inside mixed, preamble and epilogue ignored', () => {
    const { parts, warnings } = parseMime(sampleEml());
    expect(warnings).toEqual([]);
    expect(parts.map(p => [p.depth, p.type])).toEqual([
      [0, 'multipart/mixed'],
      [1, 'multipart/related'],
      [2, 'multipart/alternative'],
      [3, 'text/plain'],
      [3, 'text/html'],
      [2, 'image/png'],
      [1, 'application/pdf'],
    ]);
    expect(parts[0]?.children).toEqual([1, 6]);
    const text = parts[3];
    expect(text && partText(text)).toBe(
      'Hi Bob,\r\n\r\nThe numbers are in. Café budget is up 3% this quarter.',
    );
    expect(parts[5]?.bytes).toEqual(INLINE_PNG);
    expect(parts[5]?.contentId).toBe('chart@x');
    expect(parts[6]?.bytes).toEqual(PDF_BYTES);
    expect(parts[6]?.filename).toBe('Résumé 2025.pdf');
    expect(parts[6]?.disposition).toBe('attachment');
  });

  it('caps the part count and nesting depth', () => {
    const many = [
      'Content-Type: multipart/mixed; boundary=b',
      '',
      ...Array.from({ length: MAX_PARTS + 50 }, (_, i) => `--b\r\n\r\npart ${i}`),
      '--b--',
    ].join('\r\n');
    const wide = parseMime(enc(many));
    expect(wide.parts.length).toBe(MAX_PARTS);
    expect(wide.warnings).toContain(`Only the first ${MAX_PARTS} parts were read`);

    let deep = 'leaf';
    for (let i = 0; i < MAX_DEPTH + 10; i++) {
      deep = `Content-Type: multipart/mixed; boundary=b${i}\r\n\r\n--b${i}\r\n${deep}\r\n--b${i}--`;
    }
    const nested = parseMime(enc(deep));
    expect(Math.max(...nested.parts.map(p => p.depth))).toBe(MAX_DEPTH);
    expect(nested.warnings).toContain(
      `Parts nested deeper than ${MAX_DEPTH} levels were kept whole`,
    );
  });

  it('survives a missing closing boundary', () => {
    const { parts, warnings } = parseMime(
      enc('Content-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\n\r\nonly part'),
    );
    expect(parts.map(p => p.type)).toEqual(['multipart/mixed', 'text/plain']);
    expect(new TextDecoder().decode(parts[1]?.bytes)).toBe('only part');
    expect(warnings).toEqual(['A multipart has no closing boundary']);
  });
});

describe('authentication and trace', () => {
  it('reads SPF, DKIM and DMARC from the topmost Authentication-Results', () => {
    const results = parseAuthResults(
      'mx.google.com; dkim=pass header.i=@ex.com header.s=k1; spf=softfail (sender ip) smtp.mailfrom=a@ex.com; dmarc=fail (p=NONE) header.from=ex.com',
    );
    expect(results.map(r => [r.method, r.result, r.server])).toEqual([
      ['dkim', 'pass', 'mx.google.com'],
      ['spf', 'softfail', 'mx.google.com'],
      ['dmarc', 'fail', 'mx.google.com'],
    ]);
    expect(results[1]?.props['smtp.mailfrom']).toBe('a@ex.com');
    const summary = authSummary(
      authResults([
        { name: 'Authentication-Results', value: 'top; spf=fail smtp.mailfrom=x@y' },
        { name: 'Authentication-Results', value: 'lower; spf=pass smtp.mailfrom=x@y' },
      ]),
    );
    expect(summary.spf?.result).toBe('fail');
    expect(
      authSummary(authResults([{ name: 'Received-SPF', value: 'Pass (ok)' }])).spf?.result,
    ).toBe('pass');
  });

  it('lists Received hops oldest first, with delays', () => {
    expect(
      parseReceived(
        'from a.example (a.example [192.0.2.1]) by b.example (Postfix) with ESMTP id 42 for <x@y.z>; Mon, 1 Jan 2024 00:00:00 +0000',
      ),
    ).toEqual({
      from: 'a.example (a.example [192.0.2.1])',
      by: 'b.example (Postfix)',
      with: 'ESMTP',
      id: '42',
      for: 'x@y.z',
      date: '2024-01-01T00:00:00.000Z',
      ms: Date.UTC(2024, 0, 1),
    });
    const { headers } = parseHeaderBlock(
      new TextDecoder().decode(sampleEml()).split('\r\n\r\n')[0] ?? '',
    );
    const hops = receivedChain(headers);
    expect(hops.map(h => [h.hop, h.from?.split(' ')[0], h.by?.split(' ')[0], h.delay])).toEqual([
      [1, 'laptop.local', 'mx.example.net', null],
      [2, 'mx.example.net', 'mail.example.org', 30],
    ]);
  });
});

describe('email interpreter', () => {
  it('parses the sample: headers, body choice, attachments and auth', async () => {
    const v = parseEmail(sampleEml());
    expect(v.subject).toBe('Quarterly report — final');
    expect(v.from).toEqual([{ name: 'Alïce Example', address: 'alice@example.net' }]);
    expect(v.to.map(a => a.address)).toEqual(['bob@example.org', 'carol@example.org']);
    expect(v.cc.map(a => a.group)).toEqual(['Team', 'Team']);
    expect([v.htmlPart, v.textPart]).toEqual([4, 3]);
    expect(v.attachments.map(a => [a.name, a.mime, a.size, a.inline])).toEqual([
      ['part-5.png', 'image/png', INLINE_PNG.length, true],
      ['Résumé 2025.pdf', 'application/pdf', PDF_BYTES.length, false],
    ]);
    expect(email.label(v)).toBe('Email · Quarterly report — final · 1 attachment');

    const { stats } = await email.summarise(v);
    expect(stat(stats, 'From')).toBe('Alïce Example <alice@example.net>');
    expect(stat(stats, 'Date')).toBe('2025-07-01 11:00:00 +01:00');
    expect(stat(stats, 'Body')).toBe('HTML and plain text');
    expect(stat(stats, 'SPF')).toBe('pass (example.net)');
    expect(stat(stats, 'DKIM')).toBe('pass (example.net)');
    expect(stat(stats, 'DMARC')).toBe('pass (example.net)');
    expect(stat(stats, 'Inline images')).toBe('1');
    expect(stat(stats, 'Received hops')).toBe('2 · 30 seconds in transit');
  });

  it('renders the HTML body with cid: images inlined and remote images blocked', () => {
    const v = parseEmail(sampleEml());
    const { html, blocked } = renderedHtml(v);
    expect(blocked).toBe(1);
    expect(html).toContain('<img src="data:image/png;base64,');
    expect(html).not.toContain('tracker.example.com');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<style');
    expect(html).toContain('<b>Bob</b>');
    const layout = emailLayoutSchema.parse(emailLayout(v));
    expect(layout.body).toBe('html');
    expect(layout.blockedImages).toBe(1);
    expect(layout.auth.map(a => a.method)).toEqual(['spf', 'dkim', 'dmarc']);
  });

  it('gives the body as text and Markdown, and headers as JSON', () => {
    const v = parseEmail(sampleEml());
    expect(bodyText(v)).toContain('Café budget is up 3% this quarter.');
    expect(bodyMarkdown(v)).toContain('Hi **Bob**,');
    const h = headersJson(v);
    expect(h.find(x => x.name === 'Subject')?.value).toBe('Quarterly report — final');
    expect(h.filter(x => x.name === 'Received')).toHaveLength(2);
  });

  it('serves attachments as assets and opens them as derivations', async () => {
    const v = parseEmail(sampleEml());
    expect(email.derivations(v)).toEqual([{ id: 'attachment:1', label: 'Résumé 2025.pdf' }]);
    const pdf = await email.derive(v, 'attachment:1');
    expect(pdf).toEqual({ mime: 'application/pdf', name: 'Résumé 2025.pdf', bytes: PDF_BYTES });
    await expect(email.slice(v, { type: 'asset', index: 0 })).resolves.toEqual({
      bytes: INLINE_PNG,
      mime: 'image/png',
    });
    await expect(email.derive(v, 'attachment:9')).rejects.toThrow();
  });

  it('keeps a forwarded message/rfc822 part whole, opening as another email', async () => {
    const inner = new TextDecoder().decode(simpleEml());
    const outer = enc(
      [
        'From: a@b.c',
        'Subject: Fwd: Hello',
        'Content-Type: multipart/mixed; boundary=f',
        '',
        '--f',
        'Content-Type: text/plain',
        '',
        'See below.',
        '--f',
        'Content-Type: message/rfc822',
        '',
        inner,
        '--f--',
        '',
      ].join('\r\n'),
    );
    const v = parseEmail(outer);
    expect(v.attachments.map(a => [a.name, a.mime])).toEqual([['Hello.eml', 'message/rfc822']]);
    const fwd = await email.derive(v, 'attachment:0');
    expect(detectKinds(bytesContent(fwd.bytes, fwd.mime))[0]?.kind).toBe('email');
    expect(parseEmail(fwd.bytes).subject).toBe('Hello');
  });

  it('shows a plain-text message, and decodes a latin1 body', () => {
    const v = parseEmail(simpleEml(['Content-Type: text/plain; charset=iso-8859-1'], 'caf\xe9'));
    expect(v.textPart).toBe(0);
    expect(v.attachments).toEqual([]);
    expect(emailLayout(v).body).toBe('text');
    const latin = new Uint8Array([
      ...simpleEml(['Content-Type: text/plain; charset=iso-8859-1'], ''),
    ]);
    const withByte = new Uint8Array([...latin, 0x63, 0x61, 0x66, 0xe9]);
    expect(bodyText(parseEmail(withByte))).toBe('café');
  });
});

describe('email detection', () => {
  it('detects messages above text, YAML and Markdown', () => {
    const kinds = detectKinds(bytesContent(sampleEml(), 'text/plain'));
    expect(kinds[0]).toEqual({ kind: 'email', confidence: 0.9 });
    expect(detectKinds(textContent(new TextDecoder().decode(simpleEml())))[0]?.kind).toBe('email');
  });

  it('is surer with an .eml name or message/rfc822 type', () => {
    expect(email.detect(bytesContent(simpleEml(), 'message/rfc822'))).toBe(0.95);
    // A sparse .eml (no From) still counts
    const sparse = enc('Subject: note\r\nX-Mailer: x\r\n\r\nbody');
    expect(email.detect(bytesContent(sparse, 'message/rfc822'))).toBe(0.9);
    expect(email.detect(bytesContent(sparse))).toBe(0);
  });

  it('accepts an mbox "From " line and a byte order mark before the headers', () => {
    const mbox = enc('From alice@example.net Wed Jul  2 09:30:00 2025\n');
    expect(email.detect(bytesContent(new Uint8Array([...mbox, ...simpleEml()])))).toBe(0.9);
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...simpleEml()]);
    expect(email.detect(bytesContent(bom))).toBe(0.9);
    expect(parseEmail(bom).subject).toBe('Hello');
  });

  it.each([
    ['YAML without a blank line', 'from: alice@example.net\nsubject: hi\ndate: 2024-01-01\n'],
    ['YAML mapping', 'name: app\nversion: 1\n\nfrom: x\n'],
    ['YAML with a From key but no message field', 'From: a@b.c\nTo: d@e.f\n\nbody'],
    ['HTTP response', 'HTTP/1.1 200 OK\r\nDate: Mon, 1 Jan 2024\r\nFrom: a@b.c\r\n\r\n{}'],
    ['HTTP request', 'GET / HTTP/1.1\r\nHost: x\r\nFrom: a@b.c\r\nDate: x\r\n\r\n'],
    ['prose', 'Dear Bob,\n\nFrom: me\nSubject: lunch\n'],
    ['From without an address', 'From: Alice\nSubject: hi\n\nbody'],
    ['a header block with a stray line', 'From: a@b.c\nSubject: x\nnot a header\n\nbody'],
  ])('ignores %s', (_, text) => {
    expect(email.detect(textContent(text))).toBe(0);
  });
});
