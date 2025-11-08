import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { OpenAI } from "openai";
import { extractTextFromFile, splitIntoChunks } from "@/utils";

export const runtime = "nodejs";

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
    } else {
      throw new Error("We could not store the vectorized sections.");
    }

    const { error: errorUpdate } = await supabase
      .from("documents")
      .update({ status: "ready" })
      .eq("id", documentId);

    if (errorUpdate) {
      throw new Error("Can't update document status");
    }

    return NextResponse.json(
      { message: "Document stored successfully.", documentId },
      { status: 200 },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    console.log("error en ingest worker route", e);
    await supabase
      .from("documents")
      .update({ status: "error", error_message: String(e?.message ?? e) })
      .eq("id", documentId);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
