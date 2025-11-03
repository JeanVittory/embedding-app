import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { Client as QStash } from "@upstash/qstash";

export const runtime = "nodejs";

const DOCUMENTS_BUCKET = "documents";
const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

const metadataSchema = z.record(z.string(), z.unknown()).default({});

const slugify = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "document";

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
    const qstash = new QStash({ token: process.env.QSTASH_TOKEN! });

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
          status: "queued",
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
    console.log("paso por aqui");
    await qstash.publishJSON({
      url: `${process.env.NEXT_PUBLIC_BASE_URL}/api/ingest-worker`,
      body: { documentId, storagePath, mimetype: fileField.type },
    });

    console.log("pase por aqui 2");

    return NextResponse.json({ documentId, status: "queued" }, { status: 202 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    const message =
      error instanceof Error ? error.message : "We could not process the uploaded document.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
