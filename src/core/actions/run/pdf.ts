// Only the module's light types: pdf.js itself stays in the module's chunks
import {
  isPdfImageService,
  isPdfMetadataService,
  isPdfValueInfo,
} from '../../../modules/pdf/types';
import { pdfExtractImages, pdfMetadata } from '../catalog/pdf';
import { MAX_EXTRACTED, parseRange, truncatedNote } from '../extract';
import { implement } from '../types';
import { textResult, withExtension } from './util';

export const pdfImpls = [
  implement(pdfExtractImages, {
    value: isPdfValueInfo,
    applies: ({ value }) => value.info.error === null && value.info.pageCount > 0,
    async run({ value }, { pages, minSize }, ctx) {
      const picked = parseRange(pages, value.info.pageCount, 'page');
      const service = await ctx.service('pdf', isPdfImageService);
      if (!service) throw new Error("The PDF module isn't available");
      const { images, truncated } = await service.extractImages(value, {
        pages: picked,
        minSize,
        max: MAX_EXTRACTED,
      });
      return truncated ? [...images, truncatedNote('page')] : images;
    },
  }),
  implement(pdfMetadata, {
    value: isPdfValueInfo,
    async run({ value, content }, _params, ctx) {
      const service = await ctx.service('pdf', isPdfMetadataService);
      if (!service) throw new Error("The PDF module isn't available");
      const meta = await service.metadata(value);
      const stem = (content.name ?? '').replace(/\.pdf$/i, '') || 'document';
      return textResult(
        `${JSON.stringify(meta, null, 2)}\n`,
        'application/json',
        withExtension(`${stem}-metadata`, 'json', 'metadata'),
      );
    },
  }),
];
