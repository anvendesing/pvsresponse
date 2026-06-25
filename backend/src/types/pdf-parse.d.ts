// The public `pdf-parse` package ships @types/pdf-parse, but we import
// the internal entrypoint `pdf-parse/lib/pdf-parse.js` to skip the
// package's top-level self-test which expects a test fixture on disk.
// That deeper path has no typings, so re-declare it here with the
// same runtime shape as the public default export.
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PDFInfo {
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    text: string;
    version: string;
  }
  function pdfParse(
    data: Buffer | Uint8Array,
    options?: Record<string, unknown>
  ): Promise<PDFInfo>;
  export default pdfParse;
}
