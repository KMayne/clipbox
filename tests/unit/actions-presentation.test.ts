import { describe, expect, it } from 'vitest';
import { parseRange } from '../../src/core/actions/extract';
import type { EntryId } from '../../src/core/types';
import { Engine } from '../../src/engine/engine';
import { makePptx, samplePptx, solidPng } from '../fixtures/pptx';

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const td = new TextDecoder();

const entry = (bytes: Uint8Array<ArrayBuffer>, id: EntryId = 'en-1') => {
  const blob = new Blob([bytes], { type: PPTX_MIME });
  return { id, mime: PPTX_MIME, name: 'review.pptx', size: blob.size, blob };
};

async function engineWith(bytes = samplePptx()) {
  const engine = new Engine({ loaders: {} });
  await engine.ingest(entry(bytes));
  return engine;
}

describe('presentation actions', () => {
  it('extracts each distinct image once, by first slide use, then unused ones', async () => {
    const engine = await engineWith();
    const out = await engine.runAction('en-1', 'presentation', 'presentation.extractImages', {});
    expect(out.map(o => [o.name, o.mime])).toEqual([
      ['slide-01-image1.png', 'image/png'],
      ['slide-01-image2.png', 'image/png'],
      ['unused-image1.png', 'image/png'],
    ]);
    // slide-01-image1 is image2.png (the blue 64×64 one)
    expect(out[0]?.bytes).toEqual(solidPng(64, 64, [40, 120, 220]));
  });

  it('limits images to a slide range', async () => {
    const engine = await engineWith();
    const run = (slides: string) =>
      engine.runAction('en-1', 'presentation', 'presentation.extractImages', { slides });
    expect((await run('2')).map(o => o.name)).toEqual(['slide-02-image1.png']);
    expect((await run('1-2')).map(o => o.name)).toEqual([
      'slide-01-image1.png',
      'slide-01-image2.png',
    ]);
    await expect(run('3')).rejects.toThrow('Extract images found nothing');
    await expect(run('9')).rejects.toThrow("No slides in '9' (there are 3)");
    await expect(run('one')).rejects.toThrow('Invalid settings for Extract images');
  });

  it('extracts text as Markdown, with or without notes', async () => {
    const engine = await engineWith();
    const [md] = await engine.runAction('en-1', 'presentation', 'presentation.extractText', {});
    expect(md).toMatchObject({ mime: 'text/markdown', name: 'review.md' });
    expect(td.decode(md?.bytes)).toBe(
      [
        '# Quarterly review',
        '## Slide 1: Welcome',
        'Q3 results & plans\n\nLine one  \nLine two',
        '### Notes',
        'Say hello\n\nMention the weather',
        '## Slide 2: Numbers',
        'Revenue up 12%',
        '## Slide 3 (hidden)',
        'No title here',
      ].join('\n\n') + '\n',
    );
    const [plain] = await engine.runAction('en-1', 'presentation', 'presentation.extractText', {
      notes: false,
    });
    expect(td.decode(plain?.bytes)).not.toContain('Notes');
  });

  it('gives the slides as JSON', async () => {
    const engine = await engineWith();
    const [out] = await engine.runAction('en-1', 'presentation', 'presentation.slidesJson', {});
    expect(out).toMatchObject({ mime: 'application/json', name: 'review.json' });
    const json: unknown = JSON.parse(td.decode(out?.bytes));
    expect(json).toMatchObject({
      title: 'Quarterly review',
      author: 'Ada Lovelace',
      slideSize: { widthEmu: 12192000, heightEmu: 6858000 },
      slides: [
        {
          number: 1,
          title: 'Welcome',
          hidden: false,
          text: ['Q3 results & plans', 'Line one\nLine two'],
          notes: ['Say hello', 'Mention the weather'],
          media: ['ppt/media/image2.png', 'ppt/media/image1.png'],
        },
        { number: 2, title: 'Numbers' },
        { number: 3, title: null, hidden: true },
      ],
      unusedMedia: ['ppt/media/image5.png'],
    });
  });

  it('offers Extract images only when the deck has media', async () => {
    const engine = await engineWith(makePptx({ slides: [{ title: 'Plain' }] }));
    expect(await engine.actions('en-1', 'presentation')).toEqual(
      expect.not.arrayContaining(['presentation.extractImages']),
    );
    expect(await engine.actions('en-1', 'presentation')).toEqual(
      expect.arrayContaining(['presentation.extractText', 'presentation.slidesJson']),
    );
  });
});

describe('parseRange', () => {
  it('reads numbers, ranges and open ends within bounds', () => {
    expect(parseRange('', 5, 'page')).toBeNull();
    expect(parseRange(' 1-3, 7 ', 10, 'page')).toEqual([1, 2, 3, 7]);
    expect(parseRange('4-2,3', 10, 'page')).toEqual([2, 3, 4]);
    expect(parseRange('8-', 10, 'page')).toEqual([8, 9, 10]);
    expect(parseRange('2-99', 3, 'page')).toEqual([2, 3]);
    expect(() => parseRange('5', 3, 'page')).toThrow("No pages in '5' (there are 3)");
    expect(() => parseRange('1;2', 3, 'page')).toThrow('Invalid page range');
  });
});
