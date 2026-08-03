# AI Asset Ingestion — Session Handoff Context

> **Last updated:** 2026-08-03  
> **Progress:** TASK-001 through TASK-019 **COMPLETED**; Phase 2 TASK-021..025 **COMPLETED**; TASK-026/027 **DOCUMENTED**; Token-saving optimizations **IMPLEMENTED**; **SQS replaced with BullMQ**  
> **Next task:** Test FULL ingestion with Redis + BullMQ workers → TASK-026 integration → TASK-027 → **TASK-020 (DEFERRED)**  
> **Test status:** Unit suite updated for BullMQ; Redis required for FULL mode workers

---

## Project Overview

NestJS 11 backend that ingests images from Google Drive, stores canonical copies in S3, generates structured AI metadata (Gemini Flash), creates text embeddings (OpenAI `text-embedding-3-small`), stores vectors in PostgreSQL/PGVector, and exposes semantic search with metadata filtering + Redis caching.

**Repo:** `D:/AI Team/AI_Applications`  
**Primary plan doc:** `docs/asset-ingestion/IMPLEMENTATION_PLAN.md`  
**Optimization requirements:** `docs/optimization.md`  
**Validation report:** `docs/asset-ingestion/COMPONENT_VALIDATION_REPORT.md`  
**Full spec:** `docs/task.md`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | NestJS 11 |
| ORM | Prisma 7 + `@prisma/adapter-pg` |
| Database | PostgreSQL + pgvector (1536-dim) |
| Storage | AWS S3 (`@aws-sdk/client-s3`) |
| Queue | **BullMQ** (`bullmq` + `@nestjs/bullmq`) on Redis — stage queues + DLQ + processors |
| Cache | Redis (`ioredis`) — same Redis host as BullMQ (separate connections) |
| Drive | Google Drive (`googleapis`) |
| Image | Sharp (validation, SHA-256, AI resize) |
| Vision AI | `@google/genai` — Gemini Flash + rate limit + circuit breaker |
| Embeddings | `openai` — `text-embedding-3-small` + rate limit + circuit breaker |
| API docs | Swagger UI at `/api` |
| Testing | Jest (unit + E2E), in-memory harness in `test/support/` |

---

## Module Map

```
src/
├── config/configuration.ts          # AppConfig (aws S3, redis, ai, pipeline, queueWorker)
├── common/interfaces/pipeline-messages.interface.ts
├── modules/
│   ├── queue/
│   │   ├── queue.module.ts          # exports BullMQ producer
│   │   ├── queue-topology.constants.ts
│   │   └── bullmq/
│   │       ├── bullmq-queue.module.ts
│   │       ├── bullmq-queue.service.ts
│   │       └── processors/          # ingestion, s3Upload, aiMetadata, embedding
│   ├── ingestion/
│   ├── ai/
│   ├── search/
│   ├── cache/
│   ├── pipeline/                    # AssetPipelineService + processors registered here
│   └── observability/
```

---

## Pipeline Flow (BullMQ)

```
Google Drive Scan (metadata-only enumeration)
    ↓
BullMQ: ingestion queue
    ↓  IngestionProcessor → AssetPipelineService
DOWNLOAD once → VALIDATING → HASHING
    ↓
Duplicate (SHA-256)? → AssetSource(linkReason=SHA256_MATCH) → STOP
    ↓ new
Create Asset → S3 → STORED_IN_S3
    ↓
BullMQ: aiMetadata → (skip Gemini if metadata exists)
    ↓
BullMQ: embedding → (skip OpenAI if vector exists)
    ↓
COMPLETED
```

**Retries:** app-managed via `PipelineRetryService` (delayed BullMQ jobs). Jobs use `attempts: 1` so BullMQ does not double-retry.

**DLQ:** BullMQ `dlq` queue (no processor). Replay via `POST /pipeline/dlq/replay`.

**Dry-run:** `mode: "DRY_RUN"` — no BullMQ enqueue for AI/S3; Redis not required for dry-run path itself.

---

## API Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/asset-ingestion/jobs` | Create job (`FULL` \| `DRY_RUN`) |
| GET | `/asset-ingestion/jobs` | List jobs |
| GET | `/asset-ingestion/jobs/:id` | Get job |
| GET | `/asset-ingestion/jobs/:id/estimate` | Cost estimate |
| POST | `/search` | Semantic search |
| POST | `/search/cache/flush` | Flush cache |
| POST | `/pipeline/dlq/replay` | Replay DLQ message |
| GET | `/observability/metrics` | Metrics snapshot |
| GET | `/api` | Swagger UI |

---

## Key Environment Variables

```
DATABASE_URL, NODE_ENV, PORT
AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET_NAME
REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_ENABLED
QUEUE_WORKER_ENABLED, QUEUE_WORKER_CONCURRENCY
QUEUE_WORKER_LOCK_DURATION_MS, QUEUE_WORKER_SHUTDOWN_TIMEOUT_MS
BULLMQ_PREFIX
GOOGLE_DRIVE_*
GEMINI_*, OPENAI_*, AI_COST_*, AI_CIRCUIT_*
PIPELINE_MAX_ATTEMPTS, PIPELINE_BACKOFF_*
```

**Redis is required** for FULL ingestion (BullMQ). Legacy `SQS_WORKER_*` env names still accepted as fallbacks.

---

## Commands

```bash
npm install
npm run build
npm test
npm run start:dev

# Queue depth check (Redis required)
npm run validate:queue -- --queue ingestion
```

Swagger: http://localhost:3000/api

---

## Conventions

1. Expensive stages stay independently idempotent
2. Discovery remains metadata-only
3. BullMQ payloads — minimal JSON IDs only (same shapes as former SQS messages)
4. Prisma 7 — `@generated/prisma/client`
5. No commits unless explicitly requested

---

## Prompt to Start Next Chat

```
Continue AI Asset Ingestion in D:/AI Team/AI_Applications.

Queue backend is BullMQ (Redis). SQS has been removed from the runtime path.

Test FULL ingestion with QUEUE_WORKER_ENABLED=true and Redis running,
then dry-run, skip-on-replay, and TASK-026/027.
```
