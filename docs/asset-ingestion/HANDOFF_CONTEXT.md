# AI Asset Ingestion — Session Handoff Context

> **Last updated:** 2026-07-30  
> **Progress:** TASK-001 through TASK-019 **COMPLETED** (19/20)  
> **Next task:** TASK-020 — Pilot Migration & Execution Protocol  
> **Test status:** 72/72 unit + 6/6 E2E tests passing, production build clean

---

## Project Overview

NestJS 11 backend that ingests images from Google Drive, stores canonical copies in S3, generates structured AI metadata (Gemini Flash), creates text embeddings (OpenAI `text-embedding-3-small`), stores vectors in PostgreSQL/PGVector, and exposes semantic search with metadata filtering + Redis caching.

**Repo:** `D:/AI Team/AI_Applications`  
**Primary plan doc:** `docs/asset-ingestion/IMPLEMENTATION_PLAN.md`  
**Full spec:** `docs/task.md`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | NestJS 11 |
| ORM | Prisma 7 + `@prisma/adapter-pg` |
| Database | PostgreSQL + pgvector (1536-dim) |
| Storage | AWS S3 (`@aws-sdk/client-s3`) |
| Queue | AWS SQS (`@aws-sdk/client-sqs`) — stage-specific queues + DLQ |
| Cache | Redis (`ioredis`) |
| Drive | Google Drive (`googleapis`) |
| Image | Sharp (validation, SHA-256, AI resize) |
| Vision AI | `@google/genai` — Gemini Flash (`gemini-2.5-flash`) |
| Embeddings | `openai` — `text-embedding-3-small` (1536-dim) |
| Testing | Jest (unit + E2E), in-memory test harness in `test/support/` |

---

## Module Map

```
src/
├── config/configuration.ts          # AppConfig (aws, redis, ai, pipeline, database)
├── app.module.ts                    # Root module wiring
├── common/
│   ├── enums/asset-state.enum.ts    # AssetState, JobState
│   ├── dto/vision-metadata.dto.ts
│   └── interfaces/                  # VisionProvider, EmbeddingProvider, SQS messages, StorageProvider
├── modules/
│   ├── database/                    # PrismaService (Prisma 7 + pg adapter)
│   ├── storage/                     # S3StorageService
│   ├── drive/                       # GoogleDriveAdapterService
│   ├── image/                       # ImageProcessorService (Sharp)
│   ├── queue/                       # SqsQueueService + queue-topology.constants.ts
│   ├── ingestion/                   # IngestionJobService + IngestionController
│   ├── ai/                          # GeminiVisionProvider, OpenAiEmbeddingProvider, VisionMetadataService
│   ├── search/                      # VectorStorageService, SearchService, SearchController
│   ├── cache/                       # RedisCacheService
│   ├── pipeline/                    # AssetPipelineService, PipelineRetryService, PipelineController
│   └── observability/               # StructuredLoggerService, PipelineMetricsService, LoggingInterceptor
```

---

## Pipeline Flow (Implemented)

```
Google Drive Scan (IngestionJobService)
    ↓
Duplicate check (SHA-256) → skip AI if hash exists
    ↓
SQS: ingestion queue
    ↓  AssetPipelineService.processIngestionStage
DOWNLOADING → VALIDATING → HASHING → UPLOADING_TO_S3 → STORED_IN_S3
    ↓
SQS: aiMetadata queue
    ↓  VisionMetadataService (GeminiVisionProvider)
GENERATING_METADATA → METADATA_GENERATED
    ↓
SQS: embedding queue
    ↓  OpenAiEmbeddingProvider + VectorStorageService
GENERATING_EMBEDDING → COMPLETED
```

**Retry/DLQ:** `PipelineRetryService` — classifies errors, exponential backoff + jitter, max 3 attempts (configurable), DLQ dispatch, replay via `POST /pipeline/dlq/replay`.

**SQS topology:** `ingestion` → `s3Upload` → `aiMetadata` → `embedding` + `dlq`

---

## API Endpoints (Implemented)

| Method | Path | Purpose |
|---|---|---|
| POST | `/asset-ingestion/jobs` | Create ingestion job + start Drive discovery |
| GET | `/asset-ingestion/jobs` | List jobs |
| GET | `/asset-ingestion/jobs/:id` | Get job status |
| POST | `/search` | Semantic search + metadata filters |
| POST | `/search/cache/flush` | Flush Redis search/metadata cache |
| POST | `/pipeline/dlq/replay` | Replay a DLQ message to original stage queue |
| GET | `/observability/metrics` | Pipeline counters and stage latency snapshot |

---

## Prisma Models

`IngestionJob`, `IngestionFile`, `Asset`, `AssetSource`, `AssetMetadata`, `AssetEmbedding` (vector column via raw SQL), `ProcessingAttempt`

Schema: `prisma/schema.prisma`  
Migration: `prisma/migrations/20260729_init_pgvector/migration.sql`

---

## Key Environment Variables (.env.example)

```
DATABASE_URL, NODE_ENV, PORT
AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET_NAME
AWS_SQS_INGESTION_QUEUE_URL, AWS_SQS_S3_UPLOAD_QUEUE_URL, AWS_SQS_AI_METADATA_QUEUE_URL, AWS_SQS_EMBEDDING_QUEUE_URL, AWS_SQS_DLQ_URL
REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_ENABLED, REDIS_SEARCH_CACHE_TTL_SECONDS, REDIS_ASSET_METADATA_CACHE_TTL_SECONDS
GOOGLE_DRIVE_CLIENT_EMAIL, GOOGLE_DRIVE_PRIVATE_KEY
GEMINI_API_KEY, GEMINI_MODEL, GEMINI_PROMPT_VERSION
OPENAI_API_KEY, OPENAI_EMBEDDING_MODEL
PIPELINE_MAX_ATTEMPTS, PIPELINE_BACKOFF_BASE_SECONDS, PIPELINE_BACKOFF_MAX_SECONDS
```

---

## Completed Tasks (001–017)

| Task | Summary |
|---|---|
| 001 | Repo audit + IMPLEMENTATION_PLAN.md |
| 002 | Architecture contracts (enums, interfaces, DTOs) |
| 003 | Prisma schema + PGVector migration |
| 004 | ConfigModule + AppConfig + .env.example |
| 005 | S3StorageService |
| 006 | GoogleDriveAdapterService |
| 007 | ImageProcessorService (Sharp) |
| 008 | IngestionJobService + APIs + Drive discovery |
| 009 | Hash-based duplicate detection |
| 010 | SqsQueueService + queue topology |
| 011 | GeminiVisionProvider |
| 012 | VisionMetadataService + DB persistence |
| 013 | OpenAiEmbeddingProvider |
| 014 | VectorStorageService (PGVector cosine search) |
| 015 | SearchService + SearchController |
| 016 | RedisCacheService + search cache integration |
| 017 | AssetPipelineService + retry/DLQ/replay |
| 018 | Structured JSON logging, HTTP interceptor, pipeline metrics |
| 019 | E2E pipeline suite with in-memory test harness |

---

## Remaining Tasks (020)

### TASK-020 — Pilot Migration & Execution Protocol (NEXT)
- Batch pilot runs (10 → 100 → 1000 images)
- Cost, performance, quality reports before 10,000+ run

---

## Known Gaps / Not Yet Built

1. **SQS consumer workers** — `AssetPipelineService.processQueueMessage()` exists but no long-running poller/worker is wired to consume SQS messages automatically
2. **HNSW vector index** — commented out in migration SQL; cosine search works but may need index at scale
3. **Audit table in IMPLEMENTATION_PLAN.md §2** — outdated (shows components as "Not present" that are now implemented); roadmap table (§Task Breakdown) is accurate

---

## Commands

```bash
npm install          # also runs prisma generate via postinstall
npm run build
npm test             # 72 unit tests
npm run test:e2e     # 6 e2e tests
npm run start:dev
```

On Windows PowerShell, Node may need: `$env:Path = "C:\Program Files\nodejs;" + $env:Path`

---

## Conventions for Continuing

1. **One task at a time** — follow `docs/asset-ingestion/IMPLEMENTATION_PLAN.md` task order
2. **Update IMPLEMENTATION_PLAN.md** after each task — mark COMPLETED + set next task
3. **Minimize scope** — match existing module patterns, don't over-engineer
4. **Tests required** — mock AWS/AI/Redis/Prisma in unit tests; run full suite + build before marking done
5. **SQS payloads** — minimal JSON IDs only, never binary image data
6. **Prisma 7** — client output at `generated/prisma/`, import via `@generated/prisma/client`
7. **No commits** unless explicitly requested by user

---

## Prompt to Start Next Chat

```
Continue the AI Asset Ingestion project in D:/AI Team/AI_Applications.

Read docs/asset-ingestion/HANDOFF_CONTEXT.md and docs/asset-ingestion/IMPLEMENTATION_PLAN.md.

Implement TASK-020 (Pilot Migration & Execution Protocol).
Update IMPLEMENTATION_PLAN.md when done. Do not review unnecessary files.
Run npm test and npm run build to verify.
```
