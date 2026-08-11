Here’s a practical local testing guide tailored to your setup: **Supabase (Postgres/pgvector), Google Drive, local Redis, OpenAI, Gemini** — **skipping SQS and S3**.

---

## One-time setup (do this first)

### 1. Supabase (database + pgvector)

**Requirements**
- Supabase project with PostgreSQL
- `pgvector` extension enabled
- Prisma schema migrated

**Steps**
1. In Supabase → **SQL Editor**, run:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
2. Copy your **connection string** (Settings → Database). Use the **direct** connection for migrations if pooling causes issues.
3. In `.env`:
   ```env
   DATABASE_URL="postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true"
   ```
   For `prisma migrate`, you may need the **direct** URL (port 5432) instead of the pooler.
4. From project root:
   ```powershell
   $env:Path = "C:\Program Files\nodejs;" + $env:Path
   cd "d:\AI Team\AI_Applications"
   npm install
   npx prisma migrate deploy
   ```
5. Verify in Supabase Table Editor: tables like `Asset`, `AssetMetadata`, `AssetEmbedding` exist.

---

### 2. Local Redis

**Requirements**
- Redis running on `localhost:6379`

**Steps**
```powershell
# Example with Docker
docker run -d --name redis-local -p 6379:6379 redis:7
```

In `.env`:
```env
REDIS_ENABLED=true
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
```

---

### 3. Google Drive

**Requirements**
- Google Cloud **service account** with Drive API enabled
- A test folder shared with the service account email (`GOOGLE_DRIVE_CLIENT_EMAIL`)
- Folder ID from the Drive URL

In `.env`:
```env
GOOGLE_DRIVE_CLIENT_EMAIL="your-sa@project.iam.gserviceaccount.com"
GOOGLE_DRIVE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

**Note:** The private key must keep `\n` line breaks (as in `.env.example`).

---

### 4. AI providers

```env
GEMINI_API_KEY="..."
GEMINI_MODEL="gemini-2.5-flash"
GEMINI_PROMPT_VERSION="v1"

OPENAI_API_KEY="..."
OPENAI_EMBEDDING_MODEL="text-embedding-3-small"
```

---

### 5. Skip SQS/S3 (but app still boots)

Validation scripts auto-disable workers. For local testing:

```env
SQS_WORKER_ENABLED=false
```

AWS vars can be **dummy placeholders** (app won’t call S3/SQS if you don’t run those scripts):

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=dummy
AWS_SECRET_ACCESS_KEY=dummy
AWS_S3_BUCKET_NAME=dummy
AWS_SQS_INGESTION_QUEUE_URL=https://example.com/ingestion
AWS_SQS_S3_UPLOAD_QUEUE_URL=https://example.com/s3
AWS_SQS_AI_METADATA_QUEUE_URL=https://example.com/ai
AWS_SQS_EMBEDDING_QUEUE_URL=https://example.com/embedding
AWS_SQS_DLQ_URL=https://example.com/dlq
```

---

### 6. Test image

Put a sample PNG/JPEG somewhere, e.g. `d:\AI Team\AI_Applications\sample.png`.

---

## Recommended test order

Test in this sequence — later steps depend on earlier ones.

```
Drive → Image → Vision → Embedding → (seed DB) → Vector → Search → Cache → Observability
```

**Skip for now:** S3, SQS Worker, Retry, DLQ, DLQ Replay, full State Machine, Duplicate Detection, full integration.

---

## Module-by-module steps

### 1. Google Drive — folder discovery

**What it tests:** Service account auth + recursive file listing (no pipeline).

**Requirements:** Drive creds, shared test folder.

```powershell
npm run validate:drive -- --folder-id YOUR_FOLDER_ID
```

**Pass criteria:** JSON with `"status": "success"`, `totalDiscovered > 0`, files have `id`, `name`, `mimeType`.

**If it fails:** 403 → share folder with service account; empty list → wrong folder ID.

---

### 2. Image processing — Sharp validation + hash

**What it tests:** Image validation, SHA-256, AI resize (local only).

**Requirements:** Sample image file.

```powershell
npm run validate:image -- --file "d:\AI Team\AI_Applications\sample.png"
```

**Pass criteria:** `validation.isValid: true`, `contentHash` present, `optimizedBytes > 0`.

**Optional negative test:** Run with a corrupt/non-image file → `isValid: false`.

---

### 3. Gemini Vision — metadata generation

**What it tests:** Real Gemini call on an optimized image.

**Requirements:** `GEMINI_API_KEY`, sample image.

```powershell
npm run validate:vision -- --file "d:\AI Team\AI_Applications\sample.png"
```

**Pass criteria:** Non-empty `caption`, `searchDescription`, structured `metadata` (objects, colors, orientation, etc.).

**Note:** This does **not** write to the database — save the output; you’ll need it for search testing.

---

### 4. OpenAI Embedding — vector generation

**What it tests:** Real OpenAI embedding API.

**Requirements:** `OPENAI_API_KEY`.

```powershell
npm run validate:embedding -- --text "A playful orange cat on a sunny windowsill"
```

**Pass criteria:** `dimensions: 1536`, non-zero `sample` values, reasonable `latencyMs`.

---

### 5. PGVector — store + similarity search (Supabase)

**What it tests:** Writing a 1536-dim vector to Supabase and cosine search.

**Requirements:** Supabase migrated, OpenAI key, **an `Asset` row** (foreign key required).

Because you’re skipping S3/S3 pipeline, **manually seed one asset** in Supabase SQL Editor (use hash from step 2):

```sql
INSERT INTO "Asset" (
  id, "contentHash", "mimeType", "fileSize",
  "s3Bucket", "s3ObjectKey", status
) VALUES (
  'test-asset-001',
  'YOUR_SHA256_FROM_VALIDATE_IMAGE',
  'image/png',
  12345,
  'local-test',
  'local-test/sample.png',
  'COMPLETED'
);
```

Then store + search:

```powershell
npm run validate:vector -- --asset-id test-asset-001 --text "orange cat on windowsill" --top-k 5
```

**Pass criteria:** `stored` object returned, `searched` includes your asset with similarity score.

**Without `--asset-id`:** Only runs search against existing embeddings (empty if DB has none).

---

### 6. Metadata persistence (manual, no S3 pipeline)

**What it tests:** Metadata saved in Supabase with versioning.

**Requirements:** Asset row from step 5, metadata JSON from step 3.

In Supabase SQL Editor, insert metadata (adjust fields from your `validate:vision` output):

```sql
INSERT INTO "AssetMetadata" (
  id, "assetId", caption, objects, actions, styles, colors,
  orientation, "ageGroups", "educationalUses", "searchKeywords",
  "searchDescription", "searchDescriptionHash",
  provider, model, "promptVersion", "metadataVersion"
) VALUES (
  'test-metadata-001',
  'test-asset-001',
  'Orange cat on windowsill',
  ARRAY['cat','windowsill'],
  ARRAY['sitting'],
  ARRAY['natural'],
  ARRAY['orange','warm'],
  'landscape',
  ARRAY['all ages'],
  ARRAY[]::text[],
  ARRAY['cat','orange','windowsill'],
  'A playful orange cat sitting on a sunny windowsill with warm natural light',
  'hash-placeholder',
  'gemini',
  'gemini-2.5-flash',
  'v1',
  1
);
```

**Pass criteria:** Row visible in Supabase; `metadataVersion = 1`.

---

### 7. Semantic search

**What it tests:** OpenAI embed query → PGVector search → metadata join.

**Requirements:** Asset + metadata + embedding from steps 5–6.

```powershell
npm run validate:search -- --query "orange cat" --limit 5
```

Or with the API running:

```powershell
npm run start:dev
```

```powershell
curl -X POST http://localhost:3000/search `
  -H "Content-Type: application/json" `
  -d '{"query":"orange cat","limit":5,"bypassCache":true}'
```

**Pass criteria:** `total > 0`, results include `test-asset-001` with similarity score and metadata fields.

**If empty:** Usually missing metadata row, missing embedding, or query doesn’t match `searchDescription`.

---

### 8. Metadata filtering

**What it tests:** Hybrid vector + filter (category/orientation/colors).

**Requirements:** Same seeded asset; app running.

```powershell
curl -X POST http://localhost:3000/search `
  -H "Content-Type: application/json" `
  -d '{"query":"cat","limit":5,"bypassCache":true,"filters":{"orientation":"landscape"}}'
```

**Pass criteria:** Results match filters. Wrong filter (e.g. `"orientation":"portrait"`) should return fewer or zero results.

---

### 9. Redis cache

**What it tests:** Miss → hit → flush cycle.

**Requirements:** Redis running, seeded data for search (step 7).

```powershell
npm run validate:cache -- --query "orange cat"
```

**Pass criteria:**
- `firstFromCache: false`
- `secondFromCache: true`
- After flush: `thirdFromCache: false`

---

### 10. Observability (partial, no SQS pipeline)

**What it tests:** Metrics endpoint + structured logging.

**Requirements:** App running.

```powershell
npm run start:dev
curl http://localhost:3000/observability/metrics
```

**Pass criteria:** JSON counters returned. Full asset trace across pipeline stages needs SQS workers — **defer until you test SQS**.

---

## What to skip (mark BLOCKED in report)

| Module | Why skip now |
|--------|----------------|
| **S3** | You chose not to test |
| **SQS Worker** | Needs real AWS SQS queues |
| **Retry / DLQ / DLQ Replay** | SQS-dependent |
| **State machine (full)** | Needs worker + queues |
| **Idempotency** | SQS message redelivery |
| **Duplicate detection** | Needs ingestion pipeline (Drive → SQS → …) |
| **Full integration (TASK-026)** | Needs SQS + S3 for end-to-end |

In `COMPONENT_VALIDATION_REPORT.md`, mark these **BLOCKED** with note: *“Deferred — SQS/S3 not configured locally.”*

---

## Quick reference: env vars by module

| Module | Required env vars |
|--------|-------------------|
| Drive | `GOOGLE_DRIVE_CLIENT_EMAIL`, `GOOGLE_DRIVE_PRIVATE_KEY` |
| Image | None (local file only) |
| Vision | `GEMINI_API_KEY`, `GEMINI_MODEL` |
| Embedding | `OPENAI_API_KEY`, `OPENAI_EMBEDDING_MODEL` |
| Vector / Search | `DATABASE_URL` (Supabase), OpenAI key |
| Metadata DB | Supabase + manual SQL seed |
| Redis cache | `REDIS_ENABLED=true`, Redis running |
| Observability | App running (`PORT`) |

---

## Minimal “happy path” without S3/SQS

```text
1. validate:drive     → confirm Drive access
2. validate:image     → get contentHash
3. validate:vision    → get metadata JSON (save it)
4. validate:embedding → confirm OpenAI works
5. Seed Asset + AssetMetadata in Supabase SQL
6. validate:vector --asset-id ... → store embedding in pgvector
7. validate:search --query "..." → end-to-end search (minus S3/Drive download)
8. validate:cache   → Redis hit/miss
9. GET /observability/metrics → metrics smoke test
```

---

## When you’re ready for SQS/S3 later

1. Set real AWS credentials and queue URLs.
2. Set `SQS_WORKER_ENABLED=true`.
3. Run `npm run start:dev` → `POST /asset-ingestion/jobs` with a small Drive folder.
4. Then test SQS Worker, retry, DLQ, state transitions, and full integration.

---

Track results in [`docs/asset-ingestion/COMPONENT_VALIDATION_REPORT.md`](docs/asset-ingestion/COMPONENT_VALIDATION_REPORT.md). If you want, switch to **Agent mode** and I can add a small `scripts/validate/seed-test-asset.sql` or a `validate:seed` script to automate the Supabase seeding step.