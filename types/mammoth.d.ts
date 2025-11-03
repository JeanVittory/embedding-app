declare module "mammoth" {
  export interface ExtractRawTextOptions {
    arrayBuffer: ArrayBuffer;
  }

  export interface ExtractRawTextResult {
    value?: string;
    messages?: Array<{
      type: string;
      message: string;
    }>;
  }

  export function extractRawText(
    options: ExtractRawTextOptions,
  ): Promise<ExtractRawTextResult>;

  const mammoth: {
    extractRawText: typeof extractRawText;
  };

  export default mammoth;
}
