import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { register } from '../../src/core/interpreter';
import { detectKinds } from '../../src/core/interpreters';
import { presentationInterpreter } from '../../src/core/interpreters/presentation';
import { paragraphText, parseXml, resolvePart } from '../../src/core/presentation/ooxml';
import { presentationLayoutSchema } from '../../src/core/presentation/types';
import type { EntryId } from '../../src/core/types';
import { Engine } from '../../src/engine/engine';
import { makePptx, samplePptx } from '../fixtures/pptx';
import { bytesContent } from './helpers';

const presentation = register(presentationInterpreter);
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const stat = (stats: { label: string; value: string }[], label: string) =>
  stats.find(s => s.label === label)?.value;

const entry = (bytes: Uint8Array<ArrayBuffer>, id: EntryId = 'en-1') => {
  const blob = new Blob([bytes], { type: PPTX_MIME });
  return { id, mime: PPTX_MIME, name: 'review.pptx', size: blob.size, blob };
};

async function engineWith(bytes = samplePptx()) {
  const engine = new Engine({ loaders: {} });
  await engine.ingest(entry(bytes));
  return engine;
}

describe('presentation detection', () => {
  it('outranks the archive kind, which stays on offer', () => {
    const kinds = detectKinds(bytesContent(samplePptx(), PPTX_MIME));
    expect(kinds.slice(0, 2)).toEqual([
      { kind: 'presentation', confidence: 0.95 },
      { kind: 'archive', confidence: 0.5 },
    ]);
  });

  it('ignores other zips and Office files', () => {
    const docx = new Uint8Array(
      zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8('<w/>') }),
    );
    expect(presentation.detect(bytesContent(docx))).toBe(0);
    const zip = new Uint8Array(zipSync({ 'ppt/presentation.xml': strToU8('<p/>') }));
    expect(presentation.detect(bytesContent(zip))).toBe(0);
  });
});

describe('presentation parsing', () => {
  it('reads slides in sldIdLst order with title, text, notes and media', async () => {
    const v = await presentation.parse(bytesContent(samplePptx(), PPTX_MIME), {
      service: async () => null,
    });
    if (!presentationInterpreter.isValue(v)) throw new Error('not a presentation');
    expect(v.slides.map(s => [s.number, s.path, s.title, s.hidden])).toEqual([
      [1, 'ppt/slides/slide3.xml', 'Welcome', false],
      [2, 'ppt/slides/slide2.xml', 'Numbers', false],
      [3, 'ppt/slides/slide1.xml', null, true],
    ]);
    const [first, second, third] = v.slides;
    expect(first?.paragraphs).toEqual(['Q3 results & plans', 'Line one\nLine two']);
    expect(first?.notes).toEqual(['Say hello', 'Mention the weather']);
    expect(third?.paragraphs).toEqual(['No title here']);
    // Media in reference order
    const paths = (s: typeof first) => s?.media.map(i => v.media[i]?.path);
    expect(paths(first)).toEqual(['ppt/media/image2.png', 'ppt/media/image1.png']);
    expect(paths(second)).toEqual([
      'ppt/media/image1.png',
      'ppt/media/image3.png',
      'ppt/media/image4.emf',
    ]);
    expect(v.meta).toEqual({
      title: 'Quarterly review',
      author: 'Ada Lovelace',
      lastModifiedBy: 'Grace Hopper',
      created: '2024-01-02T03:04:05Z',
      modified: '2024-06-07T08:09:10Z',
    });
    expect(v.slideSize).toEqual({ width: 12192000, height: 6858000 });
    expect(presentation.label(v)).toBe('PowerPoint · 3 slides · 16:9');
  });

  it('summarises slides, metadata and media', async () => {
    const engine = await engineWith();
    const { stats, extent } = await engine.summary('en-1', 'presentation');
    expect(extent).toBe(3);
    expect(stat(stats, 'Slides')).toBe('3');
    expect(stat(stats, 'Hidden slides')).toBe('1');
    expect(stat(stats, 'Author')).toBe('Ada Lovelace');
    expect(stat(stats, 'Slide size')).toBe('13.33 × 7.5 in (16:9)');
    expect(stat(stats, 'Slides with notes')).toBe('1');
    expect(stat(stats, 'Images')).toBe('5');
    expect(stat(stats, 'Unused media')).toBe('1');
  });

  it('serves the layout and pictures by index', async () => {
    const engine = await engineWith();
    const layout = presentationLayoutSchema.parse(
      await engine.slice('en-1', 'presentation', { type: 'json' }),
    );
    expect(layout.slides).toHaveLength(3);
    const index = layout.media.findIndex(m => m.path === 'ppt/media/image2.png');
    const asset = await engine.slice('en-1', 'presentation', { type: 'asset', index });
    expect(asset).toMatchObject({ mime: 'image/png' });
    await expect(
      engine.slice('en-1', 'presentation', { type: 'asset', index: 99 }),
    ).rejects.toThrow('No media file 99');
  });

  it('copes with missing optional parts', async () => {
    const bytes = makePptx({ slides: [{ title: 'Only' }], size: [9144000, 6858000] });
    const v = await presentation.parse(bytesContent(bytes), { service: async () => null });
    if (!presentationInterpreter.isValue(v)) throw new Error('not a presentation');
    expect(v.meta.title).toBeNull();
    expect(v.media).toEqual([]);
    expect(presentation.label(v)).toBe('PowerPoint · 1 slide · 4:3');
  });
});

describe('ooxml helpers', () => {
  it('resolves relationship targets against the owning part', () => {
    expect(resolvePart('ppt/slides/slide1.xml', '../media/image1.png')).toBe(
      'ppt/media/image1.png',
    );
    expect(resolvePart('ppt/presentation.xml', 'slides/slide1.xml')).toBe('ppt/slides/slide1.xml');
    expect(resolvePart('ppt/presentation.xml', '/ppt/slides/slide2.xml')).toBe(
      'ppt/slides/slide2.xml',
    );
  });

  it('joins runs, fields and breaks, decoding entities', () => {
    const p = parseXml(
      '<a:p><a:r><a:rPr b="1"/><a:t>Fish &amp; </a:t></a:r><a:r><a:t>chips</a:t></a:r><a:br/>' +
        '<a:fld type="slidenum"><a:t>&#55;</a:t></a:fld><a:endParaRPr/></a:p>',
    );
    if (!p) throw new Error('no xml');
    expect(paragraphText(p)).toBe('Fish & chips\n7');
  });
});
