import { describe, expect, it } from 'vitest';
import { makeContent } from '../../src/core/content';
import { defined } from '../../src/core/guards';
import { register } from '../../src/core/interpreter';
import { detectKinds } from '../../src/core/interpreters';
import { Engine } from '../../src/engine/engine';
import { pdfDetector } from '../../src/modules/pdf/detect';
import {
  clampScale,
  paperName,
  parsePdf,
  pdfInterpreter,
  pdfLabel,
} from '../../src/modules/pdf/pdf';
import { makePdf, pdfBytes, samplePdf } from '../fixtures/pdf';
import { bytesContent, textContent } from './helpers';

const pdf = register(pdfInterpreter);
const stat = (stats: { label: string; value: string }[], label: string) =>
  stats.find(s => s.label === label)?.value;

const pdfEntry = (bytes: Uint8Array<ArrayBuffer>, id: `en-${string}` = 'en-1') => {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  return { id, mime: 'application/pdf', name: 'sample.pdf', size: blob.size, blob };
};

describe('pdf detector', () => {
  it('claims %PDF- content only', () => {
    expect(pdfDetector.detect(bytesContent(pdfBytes(samplePdf()), 'application/pdf'))).toBe(1);
    expect(pdfDetector.detect(textContent('PDF-1.7 is a format'))).toBe(0);
    expect(pdfDetector.detect(bytesContent([0x89, 0x50, 0x4e, 0x47]))).toBe(0);
  });
});

describe('pdf interpreter', () => {
  it('reads page count, sizes, metadata, text layer and outline', async () => {
    const bytes = pdfBytes(samplePdf());
    const v = await parsePdf(bytes, 'sample.pdf');
    expect(v.info).toMatchObject({
      pageCount: 2,
      version: '1.7',
      encrypted: false,
      hasText: true,
      attachments: 0,
      error: null,
      meta: {
        title: 'Clipbox sample',
        author: 'Ada Lovelace',
        producer: 'Clipbox test',
        creator: 'makePdf',
        created: '2024-01-02T03:04:05.000Z',
        modified: '2024-06-07T07:09:10.000Z',
      },
    });
    expect(v.info.pageSizes).toEqual([
      { width: 595, height: 842 },
      { width: 595, height: 842 },
    ]);
    expect(v.info.outline).toEqual([
      {
        title: 'Chapter 1',
        page: 0,
        children: [{ title: 'Section 1.1', page: 0, children: [] }],
      },
      { title: 'Chapter 2', page: 1, children: [] },
    ]);
    expect(pdfLabel(v.info)).toBe('PDF · 2 pages · A4');

    const s = await pdf.summarise(v);
    expect(s.extent).toBe(2);
    expect(stat(s.stats, 'Pages')).toBe('2');
    expect(stat(s.stats, 'Page size')).toBe('A4');
    expect(stat(s.stats, 'Text layer')).toBe('yes');
    const outline = defined(s.stats.find(r => r.label === 'Outline'));
    expect(outline.value).toBe('3 entries');
    expect(outline.children?.[0]).toMatchObject({
      label: 'Chapter 1',
      value: 'p. 1',
      children: [{ label: 'Section 1.1', value: 'p. 1' }],
    });
  });

  it('extracts text with form feeds between pages', async () => {
    const v = await parsePdf(pdfBytes(samplePdf()));
    expect(await pdf.slice(v, { type: 'text' })).toBe(
      'Hello from page one\nSecond line\n\f\nPage two says goodbye',
    );
    expect((await pdf.export(v)).text).toContain('Page two says goodbye');
    expect(pdf.derivations(v).map(d => d.label)).toEqual([
      'Extract text',
      'Page 1 as PNG',
      'Page 2 as PNG',
    ]);
  });

  it('names paper sizes and labels single pages', async () => {
    expect(paperName({ width: 612, height: 792 })).toBe('Letter');
    expect(paperName({ width: 842, height: 595 })).toBe('A4 landscape');
    expect(paperName({ width: 300, height: 200.4 })).toBe('300×200 pt');
    const v = await parsePdf(pdfBytes(makePdf({ pages: [['Hi']], size: [612, 792] })));
    expect(pdfLabel(v.info)).toBe('PDF · 1 page · Letter');
    expect(clampScale({ width: 595, height: 842 }, 100)).toBeLessThan(8);
    expect(clampScale({ width: 595, height: 842 }, -1)).toBe(1);
  });

  it('reports encrypted and damaged PDFs instead of throwing', async () => {
    const enc = await parsePdf(pdfBytes(makePdf({ pages: [['secret']], encrypted: true })));
    expect(enc.doc).toBeNull();
    expect(enc.info).toMatchObject({ encrypted: true, error: 'Encrypted: a password is required' });
    expect(pdfLabel(enc.info)).toBe('PDF · encrypted');
    expect(pdf.derivations(enc)).toEqual([]);
    expect(stat((await pdf.summarise(enc)).stats, 'Error')).toBe(
      'Encrypted: a password is required',
    );

    const bad = await parsePdf(pdfBytes('%PDF-1.4\nthis is not really a pdf\n'));
    expect(bad.info.encrypted).toBe(false);
    expect(bad.info.error).toMatch(/^(Damaged PDF|Could not open PDF): /);
    expect(pdfLabel(bad.info)).toBe('PDF · damaged');
    await expect(pdf.slice(bad, { type: 'text' })).rejects.toThrow(/PDF/);
  });
});

describe('pdf in the engine', () => {
  it('loads the module, then derives text that is detected as text', async () => {
    const engine = new Engine({ loaders: { pdf: () => import('../../src/modules/pdf/worker') } });
    engine.setPolicies({ langdetect: 'off' });
    const res = await engine.ingest(pdfEntry(pdfBytes(samplePdf())));
    expect(res.interpretations[0]).toMatchObject({ kind: 'pdf', status: 'loading', module: 'pdf' });
    expect(await engine.resolve('en-1', 'pdf')).toMatchObject({
      status: 'ready',
      label: 'PDF · 2 pages · A4',
    });

    const derived = await engine.derive('en-1', 'pdf', 'text');
    expect(derived).toMatchObject({ mime: 'text/plain', name: 'sample.txt' });
    const content = makeContent(derived.mime, derived.bytes, derived.name);
    expect(content.text).toContain('Hello from page one');
    expect(detectKinds(content)[0]?.kind).toBe('text');

    const again = await engine.ingest({
      id: 'en-2',
      mime: derived.mime,
      size: derived.bytes.byteLength,
      blob: new Blob([derived.bytes], { type: derived.mime }),
    });
    expect(again.interpretations[0]).toMatchObject({ kind: 'text', status: 'ready' });
  });
});
