import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { OpenAI } from "openai";

export const runtime = "nodejs";

const splitIntoChunks = (text: string, maxChunkSize = 300): string[] => {
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

const bufferToArrayBuffer = (buffer: Buffer): ArrayBuffer =>
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

const extractTextFromFile = async (buffer: Buffer, mimeType: string): Promise<string> => {
  if (mimeType === "application/pdf") {
    const pdfParseModule = await import("pdf-parse");
    const pdfParse = pdfParseModule.default ?? pdfParseModule;
    const { text } = await pdfParse(buffer);
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

export async function POST(req: Request) {
  const { documentId, storagePath, mimetype } = await req.json();
  const supabase = await createClient();

  try {
    const { data: file } = await supabase.storage.from("documents").download(storagePath);
    const buffer = Buffer.from(await file!.arrayBuffer());
    let extractedText = "";
    try {
      extractedText = await extractTextFromFile(buffer, mimetype);
    } catch (error) {
      console.error("Error extracting text from document:", error);
      extractedText = "";
    }

    if (extractedText.trim().length) {
      const chunks = splitIntoChunks(extractedText);
      const openai = new OpenAI();

      for (let index = 0; index < chunks.length; index++) {
        const chunk = chunks[index];
        const { data } = await openai.embeddings.create({
          model: "text-embedding-3-small",
          input: chunk,
        });

        const embedding = data[0]?.embedding;

        if (!embedding) {
          // Skip section if embedding is not available
          continue;
        }

        const { error: sectionError } = await supabase.from("document_sections").insert([
          {
            document_id: documentId,
            section_order: index + 1,
            section_content: chunk,
            embedding,
            meta: { source: "upload" },
          },
        ]);

        if (sectionError) {
          throw new Error(sectionError.message || "We could not store the vectorized sections.");
        }
      }
    }

    return NextResponse.json(
      { message: "Document stored successfully.", documentId },
      { status: 200 },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    await supabase
      .from("documents")
      .update({ status: "error", error_message: String(e?.message ?? e) })
      .eq("id", documentId);
    // QStash reintentará según su política
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
