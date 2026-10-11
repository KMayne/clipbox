import { register } from '../../core/interpreter';
import { extractPdfImages } from './images';
import { pdfMetadata } from './metadata';
import { pdfInterpreter } from './pdf';
import type { PdfImageService, PdfMetadataService } from './types';

export const interpreters = [register(pdfInterpreter)];

/**
 * Used by the core PDF actions through `ctx.service('pdf', guard)`: "Extract images"
 * (`isPdfImageService`) and "Metadata as JSON" (`isPdfMetadataService`).
 */
export const service: PdfImageService & PdfMetadataService = {
  async extractImages(value, options) {
    if (!pdfInterpreter.isValue(value)) throw new Error('Not a PDF value');
    if (!value.doc) throw new Error(value.info.error ?? 'The PDF is not open');
    return extractPdfImages(value.doc, options);
  },
  async metadata(value) {
    if (!pdfInterpreter.isValue(value)) throw new Error('Not a PDF value');
    return pdfMetadata(value);
  },
};
