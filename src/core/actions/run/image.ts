import { imageInterpreter } from '../../interpreters/image';
import { imageConvert, imagePagesAsPng } from '../catalog/image';
import { implement } from '../types';
import { withExtension } from './util';

/** Decodes and re-encodes in the worker; re-encoding also drops metadata (EXIF etc). */
export const imageImpls = [
  implement(imageConvert, {
    value: imageInterpreter.isValue,
    // Workers can't decode SVG (it needs a DOM)
    applies: ({ value }) => value.format !== 'svg',
    async run({ value, content }, { format, quality }) {
      const bitmap = await createImageBitmap(new Blob([value.bytes], { type: value.mime }));
      try {
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('No 2D canvas in this browser');
        if (format === 'jpeg') {
          // JPEG has no alpha: flatten onto white rather than black
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(bitmap, 0, 0);
        const mime = `image/${format}`;
        const blob = await canvas.convertToBlob({ type: mime, quality: quality / 100 });
        // Chromium falls back to PNG for types it can't encode
        if (blob.type !== mime)
          throw new Error(`This browser can't encode ${format.toUpperCase()}`);
        return {
          mime,
          name: withExtension(content.name, format === 'jpeg' ? 'jpg' : format, 'image'),
          bytes: new Uint8Array(await blob.arrayBuffer()),
        };
      } finally {
        bitmap.close();
      }
    },
  }),
  // Multi-page images (TIFF): every page, rendered by the imageformats module that decoded it
  implement(imagePagesAsPng, {
    value: imageInterpreter.isValue,
    applies: ({ value }) => (value.decoded?.pages.length ?? 1) > 1,
    async run({ value, content }) {
      const { decoded } = value;
      if (!decoded) throw new Error('This image has one page');
      const stem = withExtension(content.name, '', 'page').slice(0, -1);
      const pad = String(decoded.pages.length).length;
      const pages = [];
      for (let i = 0; i < decoded.pages.length; i++) {
        pages.push({
          mime: 'image/png',
          name: `${stem}-page${String(i + 1).padStart(Math.max(2, pad), '0')}.png`,
          bytes: i === 0 ? value.bytes : await decoded.renderPage(i),
        });
      }
      return pages;
    },
  }),
];
