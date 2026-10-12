import { describe, expect, it } from 'vitest';
import type { EntryId } from '../../src/core/types';
import { Engine } from '../../src/engine/engine';
import { INLINE_PNG, PDF_BYTES, sampleEml, simpleEml } from '../fixtures/email';

const MIME = 'message/rfc822';
const td = new TextDecoder();

const entry = (bytes: Uint8Array<ArrayBuffer>, id: EntryId = 'en-1') => {
  const blob = new Blob([bytes], { type: MIME });
  return { id, mime: MIME, name: 'report.eml', size: blob.size, blob };
};

async function engineWith(bytes = sampleEml()) {
  const engine = new Engine({ loaders: {} });
  await engine.ingest(entry(bytes));
  return engine;
}

describe('email actions', () => {
  it('lists the actions that apply', async () => {
    expect(await (await engineWith()).actions('en-1', 'email')).toEqual(
      expect.arrayContaining([
        'email.attachments',
        'email.bodyText',
        'email.bodyMarkdown',
        'email.headersJson',
        'email.receivedChain',
      ]),
    );
    // No attachments and no Received headers: those two don't apply
    const plain = await (await engineWith(simpleEml())).actions('en-1', 'email');
    expect(plain).not.toContain('email.attachments');
    expect(plain).not.toContain('email.receivedChain');
  });

  it('extracts attachments, inline images only when asked', async () => {
    const engine = await engineWith();
    const files = await engine.runAction('en-1', 'email', 'email.attachments', {});
    expect(files).toEqual([{ mime: 'application/pdf', name: 'Résumé 2025.pdf', bytes: PDF_BYTES }]);
    const all = await engine.runAction('en-1', 'email', 'email.attachments', { inline: true });
    expect(all.map(f => [f.name, f.bytes])).toEqual([
      ['part-5.png', INLINE_PNG],
      ['Résumé 2025.pdf', PDF_BYTES],
    ]);
  });

  it('gives attachments unique names', async () => {
    const part = (body: string) =>
      [
        '--b',
        'Content-Type: text/plain',
        'Content-Disposition: attachment; filename="notes.txt"',
        '',
        body,
      ].join('\r\n');
    const eml = new TextEncoder().encode(
      [
        'From: a@b.c',
        'Subject: dupes',
        'Content-Type: multipart/mixed; boundary=b',
        '',
        '--b',
        'Content-Type: text/plain',
        '',
        'body',
        part('one'),
        part('two'),
        '--b--',
      ].join('\r\n'),
    );
    const out = await (await engineWith(eml)).runAction('en-1', 'email', 'email.attachments', {});
    expect(out.map(f => [f.name, td.decode(f.bytes)])).toEqual([
      ['notes.txt', 'one'],
      ['notes (2).txt', 'two'],
    ]);
  });

  it('converts the body to text and Markdown', async () => {
    const engine = await engineWith();
    const [text] = await engine.runAction('en-1', 'email', 'email.bodyText', {});
    expect(text?.name).toBe('report.txt');
    expect(td.decode(text?.bytes)).toContain('Café budget');
    const [md] = await engine.runAction('en-1', 'email', 'email.bodyMarkdown', {});
    expect(md?.mime).toBe('text/markdown');
    expect(td.decode(md?.bytes)).toContain('Hi **Bob**,');
  });

  it('gives the headers as JSON', async () => {
    const [out] = await (await engineWith()).runAction('en-1', 'email', 'email.headersJson', {});
    const headers: unknown = JSON.parse(td.decode(out?.bytes));
    expect(headers).toEqual(
      expect.arrayContaining([{ name: 'Message-ID', value: '<msg-1@example.net>' }]),
    );
  });

  it('tabulates the Received chain as CSV or JSON', async () => {
    const engine = await engineWith();
    const [csv] = await engine.runAction('en-1', 'email', 'email.receivedChain', {});
    expect(csv?.mime).toBe('text/csv');
    const lines = td.decode(csv?.bytes).trim().split('\r\n');
    expect(lines[0]).toBe('hop,date,delay,after,from,by,with,id,for');
    expect(lines[2]).toMatch(/^2,2025-07-01T10:00:30.000Z,30,30s,/);
    const [json] = await engine.runAction('en-1', 'email', 'email.receivedChain', {
      format: 'json',
    });
    expect(JSON.parse(td.decode(json?.bytes))).toHaveLength(2);
  });
});
