/**
 * Hand-built .pptx files for tests: just the parts Clipbox reads, zipped with fflate. Pictures are
 * real (tiny, solid-colour) PNGs so the browser can show them.
 */
import { strToU8, zipSync, zlibSync } from 'fflate';

export interface SlideSpec {
  title?: string;
  /** Uses a centred-title placeholder instead of a title one. */
  centredTitle?: boolean;
  paragraphs?: string[];
  notes?: string[];
  /** Names of files under ppt/media/ the slide shows, in order. */
  images?: string[];
  hidden?: boolean;
}

export interface PptxSpec {
  slides: SlideSpec[];
  /** ppt/media/ files by name. */
  media?: Record<string, Uint8Array>;
  title?: string;
  author?: string;
  /** EMU; 16:9 by default. */
  size?: [number, number];
  /** Lists the slides in presentation.xml in reverse file order, to test that order wins. */
  reverseFiles?: boolean;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const para = (text: string) =>
  `<a:p><a:pPr/>${text
    .split('\n')
    .map(line => `<a:r><a:rPr lang="en-GB"/><a:t>${esc(line)}</a:t></a:r>`)
    .join('<a:br/>')}</a:p>`;

const shape = (id: number, ph: string | null, paras: string[]) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr>${
    ph === null ? '' : ph === '' ? '<p:ph idx="1"/>' : `<p:ph type="${ph}"/>`
  }</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${paras.map(para).join('')}</p:txBody></p:sp>`;

const picture = (id: number, rid: string) =>
  `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
  `<p:blipFill><a:blip r:embed="${rid}"/></p:blipFill><p:spPr/></p:pic>`;

const rels = (items: [string, string, string][]) =>
  `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items
    .map(
      ([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`,
    )
    .join('')}</Relationships>`;

export function makePptx(spec: PptxSpec): Uint8Array<ArrayBuffer> {
  const files: Record<string, Uint8Array> = {};
  const put = (path: string, text: string) => (files[path] = strToU8(text));
  const [cx, cy] = spec.size ?? [12192000, 6858000];

  put(
    '[Content_Types].xml',
    `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      '</Types>',
  );
  put(
    'docProps/core.xml',
    `${DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">` +
      (spec.title ? `<dc:title>${esc(spec.title)}</dc:title>` : '') +
      (spec.author ? `<dc:creator>${esc(spec.author)}</dc:creator>` : '') +
      '<cp:lastModifiedBy>Grace Hopper</cp:lastModifiedBy>' +
      '<dcterms:created>2024-01-02T03:04:05Z</dcterms:created>' +
      '<dcterms:modified>2024-06-07T08:09:10Z</dcterms:modified>' +
      '</cp:coreProperties>',
  );

  const n = spec.slides.length;
  // Slide k (0-based) is stored as slide{fileNo(k)}.xml
  const fileNo = (k: number) => (spec.reverseFiles ? n - k : k + 1);
  put(
    'ppt/presentation.xml',
    `${DECL}<p:presentation ${NS}><p:sldIdLst>${spec.slides
      .map((_, k) => `<p:sldId id="${256 + k}" r:id="rId${100 + fileNo(k)}"/>`)
      .join(
        '',
      )}</p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
  );
  // Relationships listed in file order, which differs from deck order when reversed
  put(
    'ppt/_rels/presentation.xml.rels',
    rels(
      Array.from({ length: n }, (_, i) => [
        `rId${100 + i + 1}`,
        'slide',
        `slides/slide${i + 1}.xml`,
      ]),
    ),
  );

  spec.slides.forEach((s, k) => {
    const no = fileNo(k);
    const slideRels: [string, string, string][] = [
      ['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
    ];
    const pics = (s.images ?? []).map((name, j) => {
      const rid = `rId${10 + j}`;
      slideRels.push([rid, 'image', `../media/${name}`]);
      return picture(100 + j, rid);
    });
    const body = [
      ...(s.title !== undefined
        ? [shape(2, s.centredTitle ? 'ctrTitle' : 'title', [s.title])]
        : []),
      ...(s.paragraphs ? [shape(3, '', s.paragraphs)] : []),
      shape(4, 'sldNum', [String(k + 1)]),
      ...pics,
    ].join('');
    put(
      `ppt/slides/slide${no}.xml`,
      `${DECL}<p:sld ${NS}${s.hidden ? ' show="0"' : ''}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${body}</p:spTree></p:cSld></p:sld>`,
    );
    if (s.notes) {
      slideRels.push(['rId2', 'notesSlide', `../notesSlides/notesSlide${no}.xml`]);
      put(
        `ppt/notesSlides/notesSlide${no}.xml`,
        `${DECL}<p:notes ${NS}><p:cSld><p:spTree>${shape(2, 'sldImg', [])}${shape(3, 'body', s.notes)}${shape(4, 'sldNum', [String(k + 1)])}</p:spTree></p:cSld></p:notes>`,
      );
    }
    put(`ppt/slides/_rels/slide${no}.xml.rels`, rels(slideRels));
  });

  for (const [name, bytes] of Object.entries(spec.media ?? {})) files[`ppt/media/${name}`] = bytes;
  return new Uint8Array(zipSync(files));
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of b) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A valid PNG filled with one RGB colour. */
export function solidPng(width: number, height: number, rgb: [number, number, number]) {
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) raw.set(rgb, y * (width * 3 + 1) + 1 + x * 3);
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set(strToU8(type), 4);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** An EMF header (enough for the magic check to see it isn't a web image). */
export const emfStub = () => {
  const b = new Uint8Array(88);
  b.set([1, 0, 0, 0]);
  b.set(strToU8(' EMF'), 40);
  return b;
};

/**
 * Three slides listed out of file order: a title slide with notes and two pictures (one also
 * on slide 2), a hidden slide, plus an unused picture, a duplicate and an EMF.
 */
export const samplePptx = () => {
  const red = solidPng(40, 30, [220, 40, 40]);
  return makePptx({
    title: 'Quarterly review',
    author: 'Ada Lovelace',
    reverseFiles: true,
    slides: [
      {
        title: 'Welcome',
        centredTitle: true,
        paragraphs: ['Q3 results & plans', 'Line one\nLine two'],
        notes: ['Say hello', 'Mention the weather'],
        images: ['image2.png', 'image1.png'],
      },
      {
        title: 'Numbers',
        paragraphs: ['Revenue up 12%'],
        images: ['image1.png', 'image3.png', 'image4.emf'],
      },
      { paragraphs: ['No title here'], hidden: true },
    ],
    media: {
      'image1.png': red,
      'image2.png': solidPng(64, 64, [40, 120, 220]),
      // Same bytes as image1: dropped by content
      'image3.png': red,
      'image4.emf': emfStub(),
      'image5.png': solidPng(16, 16, [40, 200, 80]),
    },
  });
};
