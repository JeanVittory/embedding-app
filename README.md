# Vector Restaurant

Next.js application that lets you upload PDF/DOCX manuals, vectorize them with OpenAI, store embeddings inside Supabase, and answer natural-language questions backed by those documents. Uploads are processed asynchronously through Upstash QStash so the UI stays responsive even when large files need to be parsed.

## How It Works

1. **Upload & metadata** – The UI (`/`) lets you drag-and-drop a PDF or Word file, add a title and optional metadata, and uploads it to the Supabase storage bucket `documents`. A record is created in the `documents` table with status `queued`.
2. **Background ingestion** – The API route `/api/send-file` enqueues a job in Upstash QStash that targets `/api/ingest-worker`. QStash then calls this worker from the public `NEXT_PUBLIC_BASE_URL`.
3. **Text extraction & chunking** – The ingest worker downloads the file from Supabase storage, extracts text (`pdf-parse` for PDF, `mammoth` for DOCX), sanitizes it, and splits it into ~300-character chunks.
4. **Embedding & storage** – Each chunk is embedded with `text-embedding-3-small`, then written into the `document_sections` table together with metadata and the original ordering. Once every chunk is saved the `documents` record flips to `ready` (or `error` if anything fails).
5. **Question answering** – The `/ask-question` page posts to `/api/ask-question`, which embeds the question, retrieves the most similar sections via the Supabase RPC functions `match_document_sections_topk` / `match_filtered_document_sections`, and feeds that context plus the question into `gpt-4o-mini`.

> **Supabase schema expectations**
>
> - Storage bucket named `documents`.
> - Tables `documents` and `document_sections` with the columns referenced in the API routes.
> - RPC helpers `match_document_sections_topk` and `match_filtered_document_sections` (see pgvector recipes in the Supabase docs).

## Development Setup

Prerequisites:

- Node.js 18+ and npm.
- Supabase project with the schema described above.
- OpenAI account with an API key enabled for `text-embedding-3-small` and `gpt-4o-mini`.
- Upstash QStash queue and API token.
- `cloudflared` CLI (for tunneling localhost so QStash can reach your ingest worker).

Steps:

```bash
git clone <this-repo>
cd vector-restaurant
npm install
touch .env.local # create the file if it does not exist
# add the variables listed below
npm run dev
```

The app runs on <http://localhost:3000>. `/` is the uploader/dashboard and `/ask-question` is the chat-style Q&A surface. Useful npm scripts:

| Script          | Description                                |
| --------------- | ------------------------------------------ |
| `npm run dev`   | Run Next.js with Turbopack in development. |
| `npm run build` | Production build.                          |
| `npm start`     | Start the compiled build.                  |
| `npm run lint`  | ESLint across the project.                 |

## Exposing localhost to Upstash with Cloudflared

Upstash must be able to POST to `/api/ingest-worker`. When you run locally there is no public URL, so you can tunnel your dev server with `cloudflared`.

1. Install `cloudflared` (<https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation>).
2. Start your Next.js dev server on port 3000.
3. Run:

   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```

   Cloudflared prints a public `https://<random>.trycloudflare.com` URL.

4. Set `NEXT_PUBLIC_BASE_URL` to that URL inside `.env.local` and restart `npm run dev`. This is the base that `/api/send-file` uses when publishing QStash jobs.
5. Keep the tunnel running while testing uploads so QStash can call your ingest worker. For a stable hostname you can create a named tunnel and map it to a Cloudflare-managed subdomain, but the ephemeral tunnel above is usually enough for development.

## Environment Variables

Create a `.env.local` file and define the following variables (all strings unless noted). The OpenAI SDK automatically reads `OPENAI_API_KEY`.

| Variable                               | Required              | Description                                                                                                                                                                                                                              |
| -------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | ✅                    | Supabase project URL (e.g. `https://xyzcompany.supabase.co`). Used by both client and server helpers.                                                                                                                                    |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ✅                    | Supabase anon/public API key with access to the `documents` tables, storage bucket, and RPCs.                                                                                                                                            |
| `OPENAI_API_KEY`                       | ✅                    | OpenAI key used by both embedding creation and chat completions inside `/api/ingest-worker` and `/api/ask-question`.                                                                                                                     |
| `QSTASH_TOKEN`                         | ✅                    | Upstash QStash token with permission to `publishJSON`, allowing `/api/send-file` to enqueue ingestion jobs.                                                                                                                              |
| `NEXT_PUBLIC_BASE_URL`                 | ✅ in dev/self-hosted | Absolute base URL that QStash should call (e.g. your `cloudflared` tunnel or production domain). Defaults to `https://$VERCEL_URL` on Vercel, falls back to `http://localhost:3000` but that only works when QStash can reach localhost. |
| `VERCEL_URL`                           | ℹ️ auto               | Injected by Vercel at runtime; only mentioned for completeness.                                                                                                                                                                          |

> Tip: restart `npm run dev` every time you change `.env.local`, otherwise Next.js will not pick up the new values.

## Operational Notes

- The uploader only accepts `application/pdf` and `.docx` files. Validation happens client-side before Upstash gets involved.
- Document status flow: `queued` → `ready` or `error`. Errors include a message stored in the `documents` row for quick debugging.
- When running locally, keep an eye on the Cloudflared console and the Next.js logs; failed ingestion jobs will mark the document as `error` and can be retried by re-uploading.
- The question endpoint currently allows up to 2,000 characters. Tune the prompts, token limits, or models in `app/api/ask-question/route.tsx` if you need different behavior.

With these steps you can run the full ingestion + retrieval pipeline locally, test end-to-end with Upstash, and deploy to production using the same configuration.
