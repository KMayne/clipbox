/**
 * Hand-written PDFs for tests. Everything is ASCII, so the result works both as a string
 * (e2e `dropFile`) and as bytes (unit tests).
 */

export interface PdfOptions {
  /** Lines of text per page. */
  pages: string[][];
  title?: string;
  author?: string;
  /** Adds an outline: one entry per page, plus a child under the first. */
  outline?: boolean;
  /** Width and height in points; A4 by default. */
  size?: [number, number];
  /** Adds a Standard security handler with random keys, so a password is required. */
  encrypted?: boolean;
  /** Image XObjects, stored as ASCII hex so the file stays ASCII. */
  images?: PdfImage[];
  /** Indexes into `images` drawn on each page (one list per page). */
  pageImages?: number[][];
}

export interface PdfImage {
  width: number;
  height: number;
  /** One value per component: [r, g, b], or [gray] for DeviceGray; the image is one flat colour. */
  color: number[];
  /** A 1-bit stencil mask (painted everywhere) instead of a colour image. */
  mask?: boolean;
}

const hex = (bytes: number[]) => bytes.map(b => b.toString(16).padStart(2, '0')).join('');

function imageObject(img: PdfImage): string {
  const { width: w, height: h } = img;
  const [dict, data] = img.mask
    ? ['/ImageMask true /BitsPerComponent 1', hex(new Array<number>(Math.ceil(w / 8) * h).fill(0))]
    : [
        `/ColorSpace /${img.color.length === 1 ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8`,
        hex(Array.from({ length: w * h }, () => img.color).flat()),
      ];
  const stream = `${data}>`;
  return `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} ${dict} /Filter /ASCIIHexDecode /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
}

const escape = (s: string) => s.replace(/[\\()]/g, c => `\\${c}`);

export function makePdf(opts: PdfOptions): string {
  const [w, h] = opts.size ?? [595, 842];
  const objects: string[] = [];
  const add = (body: string) => objects.push(body); // object number = index + 1

  const n = opts.pages.length;
  // 1 catalog, 2 pages, 3 font, 4 info, then per page: page + content, then outline objects
  const pageObj = (i: number) => 5 + i * 2;
  const outlineRoot = 5 + n * 2;
  const outlineItem = (i: number) => outlineRoot + 1 + i;
  const outlineChild = outlineRoot + 1 + n;
  // Images come after the outline (if any) and before the encryption dictionary
  const imageObj = (k: number) => (opts.outline ? outlineChild + 1 : outlineRoot) + k;

  add(
    `<< /Type /Catalog /Pages 2 0 R${opts.outline ? ` /Outlines ${outlineRoot} 0 R /PageMode /UseOutlines` : ''} >>`,
  );
  add(
    `<< /Type /Pages /Kids [${opts.pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${n} >>`,
  );
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add(
    `<< /Producer (Clipbox test) /Creator (makePdf)${opts.title ? ` /Title (${escape(opts.title)})` : ''}${
      opts.author ? ` /Author (${escape(opts.author)})` : ''
    } /CreationDate (D:20240102030405Z) /ModDate (D:20240607080910+01'00') >>`,
  );
  opts.pages.forEach((lines, i) => {
    const ops = ['BT', '/F1 24 Tf', '28 TL', `72 ${h - 96} Td`];
    lines.forEach((line, j) => ops.push(`${j > 0 ? 'T* ' : ''}(${escape(line)}) Tj`));
    ops.push('ET');
    const drawn = opts.pageImages?.[i] ?? [];
    drawn.forEach((k, j) => ops.push(`q 100 0 0 100 ${72 + j * 110} 300 cm /Im${k} Do Q`));
    const stream = ops.join('\n');
    const xobjects = drawn.length
      ? ` /XObject << ${[...new Set(drawn)].map(k => `/Im${k} ${imageObj(k)} 0 R`).join(' ')} >>`
      : '';
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /Font << /F1 3 0 R >>${xobjects} >> /Contents ${objects.length + 2} 0 R >>`,
    );
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  if (opts.outline) {
    add(
      `<< /Type /Outlines /First ${outlineItem(0)} 0 R /Last ${outlineItem(n - 1)} 0 R /Count ${n + 1} >>`,
    );
    opts.pages.forEach((_, i) => {
      const links = [
        i > 0 ? `/Prev ${outlineItem(i - 1)} 0 R` : '',
        i < n - 1 ? `/Next ${outlineItem(i + 1)} 0 R` : '',
        i === 0 ? `/First ${outlineChild} 0 R /Last ${outlineChild} 0 R /Count 1` : '',
      ].join(' ');
      add(
        `<< /Title (Chapter ${i + 1}) /Parent ${outlineRoot} 0 R ${links} /Dest [${pageObj(i)} 0 R /Fit] >>`,
      );
    });
    add(`<< /Title (Section 1.1) /Parent ${outlineItem(0)} 0 R /Dest [${pageObj(0)} 0 R /Fit] >>`);
  }
  for (const img of opts.images ?? []) add(imageObject(img));
  let encryptRef = '';
  if (opts.encrypted) {
    const hex32 = (seed: number) =>
      Array.from({ length: 32 }, (_, i) => ((i * 37 + seed) & 0xff).toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
    add(`<< /Filter /Standard /V 1 /R 2 /O <${hex32(7)}> /U <${hex32(91)}> /P -44 >>`);
    encryptRef = ` /Encrypt ${objects.length} 0 R /ID [<00112233445566778899AABBCCDDEEFF> <00112233445566778899AABBCCDDEEFF>]`;
  }

  let out = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 4 0 R${encryptRef} >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

/** Two A4 pages with a title, author and outline. */
export const samplePdf = () =>
  makePdf({
    pages: [['Hello from page one', 'Second line'], ['Page two says goodbye']],
    title: 'Clipbox sample',
    author: 'Ada Lovelace',
    outline: true,
  });

export const pdfBytes = (s: string) => new TextEncoder().encode(s);
