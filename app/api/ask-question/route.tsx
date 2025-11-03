import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { OpenAI } from "openai";
import { SupabaseClient } from "@supabase/supabase-js";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";

export type DocumentSectionMatch = {
  id: number;
  document_id: number;
  section_content: string;
  similarity: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: Record<string, any>;
};

type TryCfg = { topK: number; threshold: number | null };

const DEFAULT_TRIES: TryCfg[] = [
  { topK: 8, threshold: null },
  { topK: 12, threshold: 0.3 },
  { topK: 20, threshold: 0.2 },
];

export async function retrieveWithFallback(
  queryEmbedding: number[],
  supabase: SupabaseClient,
  tries: TryCfg[] = DEFAULT_TRIES,
): Promise<DocumentSectionMatch[]> {
  for (const t of tries) {
    const rpc =
      t.threshold == null ? "match_document_sections_topk" : "match_filtered_document_sections";

    const args =
      t.threshold == null
        ? { query_embedding: queryEmbedding, top_k: t.topK }
        : { query_embedding: queryEmbedding, match_threshold: t.threshold, match_count: t.topK };

    const { data, error } = (await supabase.rpc(rpc, args)) as PostgrestSingleResponse<
      DocumentSectionMatch[]
    >;

    if (error) throw new Error(`RPC error (${rpc}): ${error.message}`);
    if (data?.length) return data;
  }
  return [];
}

export async function POST(request: NextRequest) {
  try {
    const { message } = await request.json();

    const supabase = await createClient();
    const openai = new OpenAI();

    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: message,
    });

    const questionEmbedding = embeddingResponse.data[0].embedding;

    const matchingSections = await retrieveWithFallback(questionEmbedding, supabase);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const context = matchingSections.map((section: any) => section.section_content).join("\n\n");

    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 1,
      max_completion_tokens: 100,
      messages: [
        {
          role: "system",
          content: "Please use the context to improve your ability to answer the question",
        },
        {
          role: "user",
          content: `
                Using the following informtion please answer the question: 
                Context: ${context}
                Question: ${message}
            `,
        },
      ],
    });

    const answer = aiResponse.choices[0].message.content;
    return NextResponse.json({ message: answer }, { status: 200 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    NextResponse.json({ error: error.message || "Failed to store message" }, { status: 500 });
  }
}
