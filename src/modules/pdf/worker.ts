import { register } from '../../core/interpreter';
import { extractPdfImages } from './images';
import { pdfInterpreter } from './pdf';
import type { PdfImageService } from './types';

export const interpreters = [register(pdfInterpreter)];

/** Used by the core "Extract images" action through `ctx.service('pdf', isPdfImageService)`. */
export const service: PdfImageService = {
  async extractImages(value, options) {
    if (!pdfInterpreter.isValue(value)) throw new Error('Not a PDF value');
    if (!value.doc) throw new Error(value.info.error ?? 'The PDF is not open');
    return extractPdfImages(value.doc, options);
  },
};
