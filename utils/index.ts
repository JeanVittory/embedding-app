import pdfParse from "pdf-parse";

const sanitizeText = (input: string): string => {
  if (!input) return "";

  const cleaned = Array.from(input)
    .map((char) => {
      const codePoint = char.codePointAt(0);

      if (codePoint === undefined) {
        return "";
      }

      if (
        (codePoint <= 31 && codePoint !== 9 && codePoint !== 10 && codePoint !== 13) ||
        (codePoint >= 0x7f && codePoint <= 0x9f)
      ) {
        return " ";
      }

      return char;
    })
    .join("")
    .replace(/\uFFFD/g, " ");

  return cleaned.trim();
};

export const splitIntoChunks = (text: string, maxChunkSize = 300): string[] => {
  const paragraphs = text.replace(/\r\n?/g, "\n").split(/\n+/);

  const sentences = paragraphs.flatMap((p) =>
    p
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );

  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (!current.length) {
      current = sentence;
      continue;
    }
    if (current.length + 1 + sentence.length <= maxChunkSize) {
      current += " " + sentence;
    } else {
      chunks.push(current);
      current = sentence;
    }
  }
  if (current.trim().length) chunks.push(current);

  return chunks;
};

const bufferToArrayBuffer = (buffer: Buffer): ArrayBuffer =>
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

export type TextItem = { str: string; transform: number[] };

type PdfParsePage = {
  getTextContent: () => Promise<{ items: TextItem[] }>;
};

const extractPdfTextInReadingOrder = async (buffer: Buffer): Promise<string> => {
  const { text } = await pdfParse(buffer, {
    pagerender: async (pageData) => {
      try {
        const content = await (pageData as PdfParsePage).getTextContent();
        const rows = content.items.map((item) => {
          const [, , , , x, y] = item.transform;
          return { x, y, text: item.str.trim() };
        });

        rows.sort((a, b) => b.y - a.y || a.x - b.x);

        const lineTol = 2.5;
        const lines: { y: number; parts: { x: number; text: string }[] }[] = [];

        for (const row of rows) {
          const line = lines.find((candidate) => Math.abs(candidate.y - row.y) <= lineTol);
          if (line) {
            line.parts.push({ x: row.x, text: row.text });
          } else {
            lines.push({ y: row.y, parts: [{ x: row.x, text: row.text }] });
          }
        }
        return lines
          .map((line) =>
            line.parts
              .sort((a, b) => a.x - b.x)
              .map((part) => part.text)
              .join(" "),
          )
          .join("\n");
      } catch (error) {
        console.log("ERROR extractPdfTextInReadingOrder", error);
        return "";
      }
    },
  });
  return text ?? "";
};

export const extractTextFromFile = async (buffer: Buffer, mimeType: string): Promise<string> => {
  if (mimeType === "application/pdf") {
    const text = await extractPdfTextInReadingOrder(buffer);
    return sanitizeText(text ?? "");
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const mammothModule = await import("mammoth");
    const extract = mammothModule.extractRawText ?? mammothModule.default?.extractRawText;

    if (!extract) {
      return "";
    }

    const { value } = await extract({
      arrayBuffer: bufferToArrayBuffer(buffer),
    });
    return sanitizeText(value ?? "");
  }

  return "";
};
