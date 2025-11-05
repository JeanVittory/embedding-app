// app/api/enqueue-ingest/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { Client as QStash } from "@upstash/qstash";

const qstash = new QStash({ token: process.env.QSTASH_TOKEN! });

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { title, storagePath, mimetype, bytes, metadata } = await req.json();

    if (!title || !storagePath || !mimetype || !bytes) {
      return NextResponse.json({ error: "Missing fields." }, { status: 400 });
    }

    const supabase = await createClient();

    const { data: doc, error: docErr } = await supabase
      .from("documents")
      .insert([
        {
          title,
          filename: storagePath.split("/").pop() ?? "file",
          mimetype,
          storage_path: storagePath,
          bytes,
          source: "upload",
          metadata: metadata ?? {},
          status: "queued",
        },
      ])
      .select("id, storage_path, mimetype")
      .single();

    if (docErr) {
      return NextResponse.json({ error: docErr.message }, { status: 500 });
    }

    const BASE_URL =
      process.env.NEXT_PUBLIC_BASE_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

    await qstash.publishJSON({
      url: `${BASE_URL}/api/ingest-worker`,
      body: { documentId: doc.id, storagePath: doc.storage_path, mimetype: doc.mimetype },
    });

    return NextResponse.json({ documentId: doc.id, status: "queued" }, { status: 202 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Failed to enqueue" }, { status: 500 });
  }
}
