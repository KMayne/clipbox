import { imageInterpreter } from '../../interpreters/image';
import { imageConvert } from '../catalog/image';
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
];
