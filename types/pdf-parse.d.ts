declare module "pdf-parse" {
  export interface PDFParseResult {
    text?: string;
    info?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    version?: string;
  }

  export interface PDFParseOptions {
    pagerender?: (pageData: Record<string, unknown>) => string | Promise<string>;
    max?: number;
    version?: string;
  }

  function pdfParse(
    data: Uint8Array | ArrayBuffer | Buffer,
    options?: PDFParseOptions,
  ): Promise<PDFParseResult>;

  export { pdfParse };
  export default pdfParse;
}
