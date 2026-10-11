import { z } from 'zod';

/** Display data for a PDF; shared by the worker interpreter and the core PdfView preview. */

/** Page size in points (1/72 in), after rotation. */
export interface PageSize {
  width: number;
  height: number;
}

/** What the preview needs to lay out its page list: the `json` slice of a pdf value. */
export interface PdfLayout {
  pages: PageSize[];
  /** Why the document can't be shown (encrypted, damaged), if so. */
  error: string | null;
}

export const pdfLayoutSchema: z.ZodType<PdfLayout> = z.object({
  pages: z.array(z.object({ width: z.number(), height: z.number() })),
  error: z.string().nullable(),
});
