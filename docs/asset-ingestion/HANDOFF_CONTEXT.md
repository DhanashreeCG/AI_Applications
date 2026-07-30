# AI Asset Ingestion — Session Handoff Context

> **Last updated:** 2026-07-30  
> **Progress:** TASK-001 through TASK-019 **COMPLETED**; Phase 2 TASK-021..025 **COMPLETED**; TASK-026/027 **DOCUMENTED** (user execution pending)  
> **Next task:** Manual component validation → TASK-026 integration test → TASK-027 sign-off → **TASK-020 (DEFERRED)**  
> **Test status:** 78/78 unit + 6/6 E2E tests passing, production build clean

---

## Project Overview

NestJS 11 backend that ingests images from Google Drive, stores canonical copies in S3, generates structured AI metadata (Gemini Flash), creates text embeddings (OpenAI `text-embedding-3-small`), stores vectors in PostgreSQL/PGVector, and exposes semantic search with metadata filtering + Redis caching.

**Repo:** `D:/AI Team/AI_Applications`  
**Primary plan doc:** `docs/asset-ingestion/IMPLEMENTATION_PLAN.md` (single source of truth — includes Phase 2)  
**Validation report:** `docs/asset-ingestion/COMPONENT_VALIDATION_REPORT.md`  
**Legacy reference:** `docs/asset-ingestion/FURTHER_IMPLEMENTATION_PLAN.md` (consolidated into IMPLEMENTATION_PLAN Phase 2)  
**Full spec:** `docs/task.md`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | NestJS 11 |
| ORM | Prisma 7 + `@prisma/adapter-pg` |
| Database | PostgreSQL + pgvector (1536-dim) |
| Storage | AWS S3 (`@aws-sdk/client-s3`) |
| Queue | AWS SQS (`@aws-sdk/client-sqs`) — stage-specific queues + DLQ + **SqsWorkerService** |
| Cache | Redis (`ioredis`) |
| Drive | Google Drive (`googleapis`) |
| Image | Sharp (validation, SHA-256, AI resize) |
| Vision AI | `@google/genai` — Gemini Flash (`gemini-2.5-flash`) |
| Embeddings | `openai` — `text-embedding-3-small` (1536-dim) |
| Testing | Jest (unit + E2E), in-memory test harness in `test/support/`, component scripts in `scripts/validate/` |

---

## Module Map

```
src/
├── config/configuration.ts          # AppConfig (aws, redis, ai, pipeline, sqsWorker, database)
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
│   ├── queue/                       # SqsQueueService, SqsWorkerService, queue-topology.constants.ts
│   ├── ingestion/                   # IngestionJobService + IngestionController
│   ├── ai/                          # GeminiVisionProvider, OpenAiEmbeddingProvider, VisionMetadataService
│   ├── search/                      # VectorStorageService, SearchService, SearchController
│   ├── cache/                       # RedisCacheService
│   ├── pipeline/                    # AssetPipelineService, PipelineRetryService, PipelineController
│   └── observability/               # StructuredLoggerService, PipelineMetricsService, LoggingInterceptor
scripts/validate/                    # Per-module real-service validation scripts
```

---

## Pipeline Flow (Implemented)

```
Google Drive Scan (IngestionJobService)
    ↓
Duplicate check (SHA-256) → skip AI if hash exists
    ↓
SQS: ingestion queue
    ↓  SqsWorkerService → AssetPipelineService.processIngestionStage
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

**Retry/DLQ:** `PipelineRetryService` — classifies errors, exponential backoff + jitter, max 3 attempts (configurable), DLQ dispatch, replay via `POST /pipeline/dlq/replay`. Single failure handling per message (no nested double-DLQ).

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

## Key Environment Variables (.env.example)

```
DATABASE_URL, NODE_ENV, PORT
AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET_NAME
AWS_SQS_INGESTION_QUEUE_URL, AWS_SQS_S3_UPLOAD_QUEUE_URL, AWS_SQS_AI_METADATA_QUEUE_URL, AWS_SQS_EMBEDDING_QUEUE_URL, AWS_SQS_DLQ_URL
SQS_WORKER_ENABLED, SQS_WORKER_POLL_WAIT_SECONDS, SQS_WORKER_CONCURRENCY, SQS_WORKER_SHUTDOWN_TIMEOUT_MS
REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_ENABLED, REDIS_SEARCH_CACHE_TTL_SECONDS, REDIS_ASSET_METADATA_CACHE_TTL_SECONDS
GOOGLE_DRIVE_CLIENT_EMAIL, GOOGLE_DRIVE_PRIVATE_KEY
GEMINI_API_KEY, GEMINI_MODEL, GEMINI_PROMPT_VERSION
OPENAI_API_KEY, OPENAI_EMBEDDING_MODEL
PIPELINE_MAX_ATTEMPTS, PIPELINE_BACKOFF_BASE_SECONDS, PIPELINE_BACKOFF_MAX_SECONDS
```

---

## Phase 2 Status (021–027)

| Task | Status | Summary |
|---|---|---|
| 021 | COMPLETED | SqsWorkerService — long-poll, concurrency, graceful shutdown, ack strategy |
| 022 | COMPLETED | Single failure handling, DLQ replay fix, stage latency metrics |
| 023 | COMPLETED | `scripts/validate/*` + `npm run validate:*` |
| 024 | COMPLETED | Manual validation playbook in IMPLEMENTATION_PLAN.md (18 modules) |
| 025 | COMPLETED | COMPONENT_VALIDATION_REPORT.md (all PENDING until user validates) |
| 026 | DOCUMENTED | Full real integration procedure (user execution pending) |
| 027 | DOCUMENTED | Production readiness checklist (user sign-off pending) |
| 020 | **DEFERRED** | Pilot migration — blocked until 026/027 approved |

---

## Known Gaps / Deferred

1. **Manual real-service validation** — all rows PENDING in `COMPONENT_VALIDATION_REPORT.md`
2. **HNSW vector index** — commented out in migration SQL; cosine search works but may need index at scale
3. **DLQ replay auth** — endpoint unauthenticated; restrict in production (documented only)
4. **TASK-020 pilot migration** — deferred until manual validation + integration test + readiness checklist

---

## Commands

```bash
npm install          # also runs prisma generate via postinstall
npm run build
npm test             # 78 unit tests
npm run test:e2e     # 6 e2e tests
npm run start:dev    # SQS workers auto-start if SQS_WORKER_ENABLED=true

# Component validation (one module at a time, real .env required)
npm run validate:help
npm run validate:drive -- --folder-id <ID>
npm run validate:image -- --file ./test-data/sample.png
npm run validate:s3 -- --file ./test-data/sample.png
npm run validate:vision -- --file ./test-data/sample.png
npm run validate:embedding -- --text "sample text"
npm run validate:vector -- --text "sample" --top-k 5
npm run validate:search -- --query "orange cat"
npm run validate:cache -- --query "orange cat"
npm run validate:sqs -- --queue ingestion
```

On Windows PowerShell, Node may need: `$env:Path = "C:\Program Files\nodejs;" + $env:Path`

---

## Conventions for Continuing

1. **IMPLEMENTATION_PLAN.md is the sole execution doc** — Phase 2 consolidated from FURTHER_IMPLEMENTATION_PLAN.md
2. **Manual validation before pilot** — update COMPONENT_VALIDATION_REPORT.md as you test
3. **Minimize scope** — match existing module patterns, don't over-engineer
4. **Tests required** — run full suite + build before marking done
5. **SQS payloads** — minimal JSON IDs only, never binary image data
6. **Prisma 7** — client output at `generated/prisma/`, import via `@generated/prisma/client`
7. **No commits** unless explicitly requested by user

---

## Prompt to Start Next Chat

```
Continue the AI Asset Ingestion project in D:/AI Team/AI_Applications.

Read docs/asset-ingestion/HANDOFF_CONTEXT.md and docs/asset-ingestion/IMPLEMENTATION_PLAN.md.

Phase 2 implementation (TASK-021..025) is complete. Execute manual component validation
using the playbook and npm run validate:* commands. Update COMPONENT_VALIDATION_REPORT.md.
Then run TASK-026 integration test and approve TASK-027 checklist before TASK-020 pilot.
```
