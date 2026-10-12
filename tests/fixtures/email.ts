/** Hand-built .eml messages for the email tests. */

import { solidPng } from './pptx';

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
/** Base64 wrapped at 76 columns, as mailers write it. */
const wrapped = (bytes: Uint8Array) => (b64(bytes).match(/.{1,76}/g) ?? []).join('\r\n');

export const INLINE_PNG = solidPng(4, 3, [200, 30, 30]);
export const PDF_BYTES = new TextEncoder().encode(
  '%PDF-1.4\n%fake\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n',
);

const crlf = (lines: string[]) => lines.join('\r\n');

/**
 * multipart/mixed holding multipart/related (multipart/alternative of text and HTML, plus an
 * inline cid: image) and a PDF attachment with an RFC 2231 file name.
 */
export function sampleEml(): Uint8Array<ArrayBuffer> {
  const text = crlf([
    'Received: from mx.example.net (mx.example.net [192.0.2.1])',
    '\tby mail.example.org with ESMTPS id abc123',
    '\tfor <bob@example.org>; Tue, 01 Jul 2025 10:00:30 +0000',
    'Received: from laptop.local (unknown [198.51.100.7])',
    '\tby mx.example.net with ESMTPSA id def456;',
    '\tTue, 01 Jul 2025 11:00:00 +0100',
    'Authentication-Results: mail.example.org;',
    '\tspf=pass smtp.mailfrom=alice@example.net;',
    '\tdkim=pass (2048-bit key) header.d=example.net header.s=s1;',
    '\tdmarc=pass (p=reject) header.from=example.net',
    'From: =?UTF-8?Q?Al=C3=AFce_Example?= <alice@example.net>',
    'To: "Bob, the builder" <bob@example.org>, carol@example.org',
    'Cc: Team: dave@example.org, Erin <erin@example.org>;',
    'Subject: =?UTF-8?B?UXVhcnRlcmx5IHJlcG9ydCDigJQg?=',
    ' =?UTF-8?B?ZmluYWw=?=',
    'Date: Tue, 1 Jul 2025 11:00:00 +0100',
    'Message-ID: <msg-1@example.net>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="mixed-b"',
    '',
    'This is a multi-part message in MIME format.',
    '--mixed-b',
    'Content-Type: multipart/related; boundary="rel-b"',
    '',
    '--rel-b',
    'Content-Type: multipart/alternative; boundary="alt-b"',
    '',
    '--alt-b',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'Hi Bob,',
    '',
    'The numbers are in. Caf=C3=A9 budget is up 3% this quar=',
    'ter.',
    '--alt-b',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    '<html><head><style>p{color:red}</style></head><body>',
    '<p>Hi <b>Bob</b>,</p><p>Chart:</p><img src=3D"cid:chart@x" alt=3D"chart">',
    '<img src=3D"https://tracker.example.com/pixel.gif" alt=3D"">',
    '<script>alert(1)</script></body></html>',
    '--alt-b--',
    '--rel-b',
    'Content-Type: image/png',
    'Content-Transfer-Encoding: base64',
    'Content-ID: <chart@x>',
    'Content-Disposition: inline',
    '',
    wrapped(INLINE_PNG),
    '--rel-b--',
    '--mixed-b',
    'Content-Type: application/pdf',
    'Content-Transfer-Encoding: base64',
    "Content-Disposition: attachment; filename*0*=utf-8''R%C3%A9sum%C3%A9%20;",
    ' filename*1="2025.pdf"',
    '',
    wrapped(PDF_BYTES),
    '--mixed-b--',
    'epilogue, ignored',
    '',
  ]);
  return new TextEncoder().encode(text);
}

/** A plain message with one header field per line. */
export const simpleEml = (extra: string[] = [], body = 'Hello there.\r\n') =>
  new TextEncoder().encode(
    crlf([
      'From: Alice <alice@example.net>',
      'To: bob@example.org',
      'Subject: Hello',
      'Date: Wed, 2 Jul 2025 09:30:00 -0400',
      ...extra,
      '',
      body,
    ]),
  );
