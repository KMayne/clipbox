// pdfjs-dist ships no typings for its worker entry; we only hand its exports to pdf.js itself.
declare module 'pdfjs-dist/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
