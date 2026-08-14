# AI Applications — Project Context

> **Last updated:** 2026-08-13  
> **Purpose:** Single entry-point overview of what this repo is, what modules exist, and how the major product flows fit together.  
> **Deeper refs:** See [Related docs](#related-docs) at the bottom.

---

## What this project is

NestJS 11 backend for educational AI tooling built around two product pillars:

1. **Asset ingestion & semantic search** — Pull images from Google Drive, store them in S3, enrich with Gemini vision metadata + OpenAI embeddings, and expose PGVector-backed search.
2. **Flashcard generation** — Turn a natural-language learning request into rendering-ready flashcards by selecting a declarative layout template, generating educational content with Gemini, and retrieving matching images from the asset library.

The asset library is the shared foundation: flashcards do **not** invent images or layouts; they reuse ingested assets and pre-defined templates.

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | NestJS 11 + Express |
| Language | TypeScript |
| ORM | Prisma 7 (`@prisma/adapter-pg`, client in `generated/prisma`) |
| Database | PostgreSQL + **pgvector** (1536-dim embeddings) |
| Object storage | AWS S3 |
| Queue | **BullMQ** on Redis (stage queues + DLQ) |
| Cache | Redis (`ioredis`) — search / metadata caching |
| Events | `@nestjs/event-emitter` (pipeline tracker / flashcard telemetry) |
| Drive | Google Drive API (`googleapis`) |
| Image processing | Sharp (validate, hash, resize for AI) |
| Vision / flashcard LLM | Google Gemini (`@google/genai`) |
| Embeddings | OpenAI `text-embedding-3-small` |
| Flashcard render | Playwright (HTML → WebP/PDF) |
| API docs | Swagger UI at `/api` |
| Static UI | `public/flashcards.html` |

Default listen port: `PORT` env, else **5000** (`src/main.ts`).

---

## High-level architecture

```text
┌──────────────────┐     ┌─────────────────────┐
│ Google Drive     │────▶│ Ingestion + Pipeline│
└──────────────────┘     │ (BullMQ workers)    │
                         └──────────┬──────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
         ┌────────┐          ┌──────────┐          ┌────────────┐
         │   S3   │          │ Postgres │          │   Redis    │
         │ assets │          │ +pgvector│          │ cache/queue│
         └────────┘          └────┬─────┘          └────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
             ┌────────────┐              ┌──────────────┐
             │ POST /search│              │  Flashcards  │
             │ semantic    │◀─────────────│  generate    │
             └────────────┘              └──────────────┘
```

---

## Repository layout

```text
src/
├── main.ts / app.module.ts
├── config/configuration.ts
├── common/                    # shared events + pipeline message types
└── modules/                   # feature modules (see below)

prisma/schema.prisma           # data model
public/flashcards.html         # flashcard demo UI
docs/                          # design & handoff docs
scripts/                       # validate:* and flashcard diagnostics
generated/prisma/              # Prisma client output
```

---

## Modules we have built

All Nest modules live under `src/modules/` and are wired in `AppModule`.

### Infrastructure & shared

| Module | Path | Responsibility |
|---|---|---|
| **database** | `modules/database` | Prisma client / DB connection (`PrismaService`) |
| **storage** | `modules/storage` | S3 upload, download, signed URLs |
| **cache** | `modules/cache` | Redis cache for search results and asset metadata |
| **queue** | `modules/queue` | BullMQ queues + processors (ingestion, AI metadata, embedding, S3 upload, DLQ) |
| **observability** | `modules/observability` | Structured logging, request interceptor, in-memory pipeline metrics (`GET /observability/metrics`) |
| **pipeline-tracker** | `modules/pipeline-tracker` | Persisted execution / stage / AI / image-search tracking for workflows (esp. flashcards) |

### Asset ingestion pillar

| Module | Path | Responsibility |
|---|---|---|
| **drive** | `modules/drive` | Google Drive adapter — folder scan, file download |
| **image** | `modules/image` | Sharp-based validation, dimensions, SHA-256 content hash, AI-safe resize |
| **ingestion** | `modules/ingestion` | Job lifecycle: create/list/get jobs, Drive discovery, enqueue processing |
| **ai** | `modules/ai` | Gemini vision metadata, OpenAI embeddings, rate limits, circuit breakers, usage / cost tracking |
| **pipeline** | `modules/pipeline` | `AssetPipelineService` stage orchestration, retries, DLQ replay (`POST /pipeline/dlq/replay`) |
| **search** | `modules/search` | Semantic asset search over embeddings + metadata filters; used by flashcards image retrieval |

### Flashcards pillar

| Module | Path | Responsibility |
|---|---|---|
| **flashcards** | `modules/flashcards` | End-to-end generate pipeline, templates CRUD, optional Playwright renderer, asset image proxy |

**Flashcards internals (not separate Nest modules):**

| Area | Role |
|---|---|
| `FlashcardOrchestratorService` | Stage orchestration + telemetry |
| `user-request.resolver` | Deterministic topic / age / grade / subject / difficulty / objective |
| `TemplateSelectionService` + `template-selection.engine` | Hard filter + ranking → one template |
| `TemplateSelectionAiService` + catalog cache | Optional LLM semantic rank among eligible templates |
| `TemplateRepository` / `FlashcardTemplateService` | Load/persist templates & selection rules |
| `FlashcardContentService` + prompt constants | Gemini structured content bound to template component IDs |
| `llm-content.validator` | Reject extras / missing required / layout inventing |
| `FlashcardImageRetrievalService` | Per-slot search cascade → top-1 asset |
| `flashcard-renderer/` | Browser pool + HTML/WebP/PDF render + S3/local storage |

---

## Product flow 1 — Asset ingestion

```text
Drive scan (metadata only)
  → BullMQ ingestion
  → DOWNLOAD → VALIDATE → HASH
  → Duplicate (SHA-256)? → link AssetSource → COMPLETED
  → else: create Asset → S3 → STORED_IN_S3
  → BullMQ aiMetadata (Gemini) → skip if metadata exists
  → BullMQ embedding (OpenAI) → skip if vector exists
  → COMPLETED
```

**Modes**

- `FULL` — full pipeline (requires Redis/BullMQ)
- `DRY_RUN` — hash / dedup / cost estimate only; no S3/AI path

**Resilience**

- App-managed retries via `PipelineRetryService` (BullMQ jobs use `attempts: 1`)
- Failed work lands in BullMQ `dlq` + DB `DEAD_LETTER` / `ProcessingAttempt`
- Replay: `POST /pipeline/dlq/replay` with `{ "ingestionFileId": "..." }`

**Known gap:** re-ingesting the same Drive content that already has an `Asset` short-circuits as duplicate without finishing incomplete S3 / metadata / embedding.

---

## Product flow 2 — Flashcard generation

```text
REQUEST_VALIDATION
  → REQUEST_ANALYSIS                    # deterministic
  → EDUCATIONAL_OBJECTIVE_DETERMINATION # keyword-based; never LLM
  → TEMPLATE_SELECTION                  # hard filter + rank (+ optional AI among eligibles)
  → LLM_CONTENT_GENERATION              # Gemini fills template component IDs only
  → IMAGE_RETRIEVAL                     # SearchService, limit=1 per slot
  → RESPONSE_ASSEMBLY / FINAL_VALIDATION
  → RESPONSE_RETURN                     # rendering-ready JSON
  → optional POST /flashcards/render    # HTML / WebP / PDF
```

**Design boundaries**

| Owns | Does **not** own |
|---|---|
| Request analysis, template eligibility | Inventing layouts / styling / positions |
| Educational text + image *search queries* | Image generation |
| Merge template + content + assets | Duplicating search/embedding logic |

New layouts = new `FlashcardTemplate` (+ optional `TemplateSelectionRule`), not orchestrator hardcoding.

Operational detail: `docs/flashcards/FLASHCARD_SELECTION_AND_GENERATION_CONTEXT.md`

---

## Data model (Prisma)

### Ingestion / assets

| Model | Purpose |
|---|---|
| `IngestionJob` | Job counters, mode (`FULL`/`DRY_RUN`), cost estimates |
| `IngestionFile` | Per-Drive-file row within a job |
| `Asset` | Canonical image (content hash unique → S3) |
| `AssetSource` | Link from ingestion file → asset (e.g. `SHA256_MATCH`) |
| `AssetMetadata` | Gemini caption / objects / keywords / `searchDescription` |
| `AssetEmbedding` | OpenAI vector (`pgvector`, 1536) |
| `ProcessingAttempt` | Per-stage attempt / error audit |
| `AiUsage` | Token / cost accounting for ingestion AI calls |

### Flashcards / observability

| Model | Purpose |
|---|---|
| `FlashcardTemplate` | Layout-only contract (`layoutDefinition` + pedagogy metadata) |
| `TemplateSelectionRule` | Configurable ranking / filters → template |
| `PipelineExecution` (+ stages / AI / image search) | Flashcard (and future) workflow tracking |

Asset states progress through `AssetState` (`DISCOVERED` … `COMPLETED` / `DEAD_LETTER`). Job states use `JobState`.

---

## HTTP API map

### Ingestion & search

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/asset-ingestion/jobs` | Create job (`FULL` \| `DRY_RUN`) |
| `GET` | `/asset-ingestion/jobs` | List jobs |
| `GET` | `/asset-ingestion/jobs/:id` | Get job |
| `GET` | `/asset-ingestion/jobs/:id/estimate` | Cost estimate |
| `POST` | `/search` | Semantic search |
| `POST` | `/search/cache/flush` | Flush Redis search/metadata caches |
| `POST` | `/pipeline/dlq/replay` | Replay dead-letter item |
| `GET` | `/observability/metrics` | In-memory metrics (reset on restart) |

### Pipeline tracker

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/observability/pipeline-tracker/metrics` | Tracker metrics |
| `GET` | `/pipeline-tracker/executions/recent` | Recent executions |
| `GET` | `/pipeline-tracker/executions` | List executions |
| `GET` | `/pipeline-tracker/executions/:id` | Execution detail |

### Flashcards

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/flashcards/generate` | Generate flashcards |
| `POST` | `/flashcards/render` | Render assembled cards (HTML/WebP/PDF) |
| `GET` | `/flashcards/templates` | List templates |
| `POST` | `/flashcards/templates` | Upload template(s) |
| `GET` | `/flashcards/assets/:assetId/image` | Same-origin image proxy for UI/renderer |

Swagger: `/api`  
Demo UI: `/flashcards.html`

---

## How the pillars connect

```text
Ingestion builds the Asset Library
        │
        ▼
Search exposes semantic retrieval
        │
        ▼
Flashcards:
  template (layout) + Gemini (text/queries) + Search (images)
        │
        ▼
Optional renderer → static assets / PDF
```

Without a healthy ingestion + embedding corpus, flashcard image slots degrade or miss. Template coverage (`FlashcardTemplate` + `TemplateSelectionRule`) controls which layouts can be chosen for a given age/objective.

---

## Key conventions

1. **Idempotent expensive stages** — metadata / embedding skip when already present.
2. **Drive discovery is metadata-only** — download happens in the processing pipeline.
3. **BullMQ payloads stay minimal** — IDs, not bulky blobs.
4. **Prisma 7 client** — import from `@generated/prisma/client`.
5. **Flashcards: LLM never invents layout or picks templates from the full catalog** — eligibility is deterministic; LLM may only rank among already-eligible candidates.
6. **Flashcards: image retrieval is top-1** (`FLASHCARD_IMAGE_SEARCH_LIMIT=1`), not random top-N rotation.
7. **QueueModule** re-exports BullMQ only (SQS removed from runtime).
8. **No commits** unless explicitly requested.

---

## Environment (essentials)

```text
DATABASE_URL, NODE_ENV, PORT
AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET_NAME
REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_ENABLED
QUEUE_WORKER_ENABLED, QUEUE_WORKER_CONCURRENCY, BULLMQ_PREFIX
GOOGLE_DRIVE_*
GEMINI_*, OPENAI_*, AI_COST_*, AI_CIRCUIT_*
PIPELINE_MAX_ATTEMPTS, PIPELINE_BACKOFF_*
PIPELINE_TRACKING_ENABLED, PIPELINE_STORE_AI_PAYLOAD
FLASHCARD_IMAGE_SEARCH_LIMIT, FLASHCARD_IMAGE_CONCURRENCY, FLASHCARD_SIGNED_URL_TTL_SECONDS
```

Redis is required for `FULL` ingestion (BullMQ).

---

## Useful commands

```bash
npm install
npm run build
npm run start:dev
npm test

# Component validators
npm run validate:drive
npm run validate:s3
npm run validate:vision
npm run validate:embedding
npm run validate:vector
npm run validate:search
npm run validate:cache
npm run validate:queue -- --queue ingestion

# Flashcard diagnostics
npm run flashcards:rule-coverage
npm run flashcards:emit-diagnostics
```

---

## Related docs

| Doc | When to use it |
|---|---|
| `docs/asset-ingestion/HANDOFF_CONTEXT.md` | Session handoff / status / next tasks |
| `docs/asset-ingestion/IMPLEMENTATION_PLAN.md` | Ingestion task plan history |
| `docs/asset-ingestion/ASSET_SEARCH.md` | Search request/response contract |
| `docs/asset-ingestion/MONITORING_PIPELINE.md` | Pipeline monitoring |
| `docs/optimization.md` | Token / cost optimization requirements |
| `docs/flashcards/FLASH_CARD_REVISED.md` | Revised flashcard product design |
| `docs/flashcards/FLASHCARD_GENERATION_ARCHITECTURE.md` | Architecture boundaries |
| `docs/flashcards/FLASHCARD_SELECTION_AND_GENERATION_CONTEXT.md` | **Primary** runtime selection / prompt / retrieval reference |
| `docs/flashcards/TEMPLATE_SELECTION.md` | Template selection design |
| `docs/flashcards/FLASHCARD_TITLE_FIX.md` | Title-related fix notes |

---

## Status snapshot (as of handoff)

| Area | State |
|---|---|
| Asset ingestion TASK-001..019 + Phase 2 TASK-021..025 | Completed |
| BullMQ migration (SQS removed) | Completed |
| Token-saving optimizations | Implemented |
| Flashcard template-driven engine | Implemented |
| Incomplete-asset resume on SHA256 duplicate | Known gap / next for ingestion |
| TemplateSelectionRule coverage seeding | Ongoing for flashcards |

For day-to-day continuation prompts and live notes, prefer `docs/asset-ingestion/HANDOFF_CONTEXT.md` plus the flashcard selection context doc above.
