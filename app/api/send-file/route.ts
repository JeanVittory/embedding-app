import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { OpenAI } from "openai";

export const runtime = "nodejs";

const DOCUMENTS_BUCKET = "documents";
const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

const metadataSchema = z.record(z.string(), z.unknown()).default({});

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

const slugify = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "document";

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

const buildStoragePath = (filename: string) => {
  const dotIndex = filename.lastIndexOf(".");
  const extension = dotIndex >= 0 ? filename.slice(dotIndex).toLowerCase() : "";
  const baseName = dotIndex >= 0 ? filename.slice(0, dotIndex) : filename;
  const safeName = slugify(baseName);
  return `uploads/${randomUUID()}-${safeName}${extension}`;
};

const parseMetadata = (value: FormDataEntryValue | null) => {
  if (!value || typeof value !== "string" || !value.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return metadataSchema.parse(parsed);
  } catch {
    throw new Error("Metadata must be a valid JSON object.");
  }
};

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const titleField = formData.get("title");
    const fileField = formData.get("file");

    if (typeof titleField !== "string" || !titleField.trim()) {
      return NextResponse.json({ error: "The document title is required." }, { status: 400 });
    }

    if (!(fileField instanceof File)) {
      return NextResponse.json({ error: "You must attach a file." }, { status: 400 });
    }

    if (fileField.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: "The file exceeds the 15 MB limit." }, { status: 400 });
    }

    if (!SUPPORTED_MIME_TYPES.has(fileField.type)) {
      return NextResponse.json(
        { error: "Unsupported file type. Use PDF or Word (.docx)." },
        { status: 400 },
      );
    }

    let metadata: Record<string, unknown> = {};
    try {
      metadata = parseMetadata(formData.get("metadata"));
    } catch (metadataError) {
      const message =
        metadataError instanceof Error
          ? metadataError.message
          : "Metadata must be a valid JSON object.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const fileBuffer = Buffer.from(await fileField.arrayBuffer());

    const supabase = await createClient();
    const storagePath = buildStoragePath(fileField.name);

    const { error: uploadError } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .upload(storagePath, fileBuffer, {
        contentType: fileField.type,
        upsert: false,
      });

    if (uploadError) {
      throw new Error(uploadError.message || "We could not store the file in Supabase storage.");
    }

    const { data: document, error: documentError } = await supabase
      .from("documents")
      .insert([
        {
          title: titleField.trim(),
          filename: fileField.name,
          mimetype: fileField.type,
          storage_path: storagePath,
          bytes: fileField.size,
          source: "upload",
          metadata,
        },
      ])
      .select("id")
      .single();

    if (documentError) {
      throw new Error(
        documentError.message || "We could not register the document in the database.",
      );
    }

    const documentId: number = document.id;
    let extractedText = "";

    try {
      extractedText = await extractTextFromFile(fileBuffer, fileField.type);
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
  } catch (error: any) {
    const message =
      error instanceof Error ? error.message : "We could not process the uploaded document.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
