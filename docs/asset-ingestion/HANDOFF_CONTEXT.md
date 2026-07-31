# AI Asset Ingestion — Session Handoff Context

> **Last updated:** 2026-07-31  
> **Progress:** TASK-001 through TASK-019 **COMPLETED**; Phase 2 TASK-021..025 **COMPLETED**; TASK-026/027 **DOCUMENTED** (user execution pending); **Token-saving optimizations (Priority 0–2) IMPLEMENTED**  
> **Next task:** Automated + manual testing of token-saving changes → TASK-026 integration test → TASK-027 sign-off → **TASK-020 (DEFERRED)**  
> **Test status:** Unit suite green after optimization changes; full validation / E2E re-run pending

---

## Project Overview

NestJS 11 backend that ingests images from Google Drive, stores canonical copies in S3, generates structured AI metadata (Gemini Flash), creates text embeddings (OpenAI `text-embedding-3-small`), stores vectors in PostgreSQL/PGVector, and exposes semantic search with metadata filtering + Redis caching.

**Repo:** `D:/AI Team/AI_Applications`  
**Primary plan doc:** `docs/asset-ingestion/IMPLEMENTATION_PLAN.md`  
**Optimization requirements:** `docs/optimization.md` (Priority 0–2 implemented)  
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
| Queue | AWS SQS (`@aws-sdk/client-sqs`) — stage-specific queues + DLQ + **SqsWorkerService** |
| Cache | Redis (`ioredis`) |
| Drive | Google Drive (`googleapis`) |
| Image | Sharp (validation, SHA-256, AI resize) |
| Vision AI | `@google/genai` — Gemini Flash (`gemini-2.5-flash`) + rate limit + circuit breaker |
| Embeddings | `openai` — `text-embedding-3-small` (1536-dim) + rate limit + circuit breaker |
| Testing | Jest (unit + E2E), in-memory test harness in `test/support/`, component scripts in `scripts/validate/` |

---

## Module Map

```
src/
├── config/configuration.ts          # AppConfig (aws, redis, ai costs/limits, pipeline, sqsWorker, database)
├── app.module.ts
├── common/
│   ├── enums/asset-state.enum.ts
│   ├── dto/vision-metadata.dto.ts
│   └── interfaces/
├── modules/
│   ├── database/
│   ├── storage/
│   ├── drive/
│   ├── image/
│   ├── queue/                       # SqsQueueService, SqsWorkerService (+ visibility extend)
│   ├── ingestion/                   # IngestionJobService, CostEstimatorService, dry-run mode
│   ├── ai/                          # Gemini/OpenAI + AiUsageService + rate limiter/circuit breaker
│   ├── search/
│   ├── cache/
│   ├── pipeline/                    # AssetPipelineService (idempotent stages), PipelineRetryService
│   └── observability/
prisma/migrations/.../token_saving_optimizations/  # AiUsage, AssetSource.linkReason, job estimate fields
```

---

## Pipeline Flow (Token-Saving)

```
Google Drive Scan (metadata-only enumeration)
    ↓
Enqueue IngestionFile (no download at discovery)
    ↓
SQS: ingestion queue
    ↓  SqsWorkerService → AssetPipelineService.processIngestionStage
DOWNLOAD once → VALIDATING → HASHING
    ↓
Duplicate (SHA-256)? → AssetSource(linkReason=SHA256_MATCH) → STOP (no S3/AI)
    ↓ new
Create Asset → UPLOADING_TO_S3 → STORED_IN_S3
    ↓
SQS: aiMetadata
    ↓  Metadata exists? SKIP Gemini : call Gemini → persist → AiUsage row
METADATA_GENERATED
    ↓
SQS: embedding
    ↓  Embedding exists for text hash? SKIP OpenAI : call OpenAI → persist → AiUsage row
COMPLETED
```

**Idempotency rule:** Every expensive stage checks persisted results before calling providers. Replays/DLQ never rebill completed stages.

**Dry-run:** `POST /asset-ingestion/jobs` with `{ "mode": "DRY_RUN", "rootFolderId": "..." }` — enumerate, download+hash once, dedup, stop before S3/AI; stores cost estimate on the job.

**Retry/DLQ:** `PipelineRetryService` — HTTP-status-aware classifier, exponential backoff + jitter, max 3 attempts, DLQ replay. Stage→queue map includes `STORED_IN_S3`→`s3Upload`, `METADATA_GENERATED`→`embedding`.

---

## API Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/asset-ingestion/jobs` | Create job (`mode`: `FULL` \| `DRY_RUN`) + start discovery |
| GET | `/asset-ingestion/jobs` | List jobs |
| GET | `/asset-ingestion/jobs/:id` | Get job status (+ dry-run estimate fields when present) |
| GET | `/asset-ingestion/jobs/:id/estimate` | Cost estimate from asset stage results |
| POST | `/search` | Semantic search + metadata filters |
| POST | `/search/cache/flush` | Flush Redis search/metadata cache |
| POST | `/pipeline/dlq/replay` | Replay a DLQ message to original stage queue |
| GET | `/observability/metrics` | Pipeline counters and stage latency snapshot |

---

## Key Environment Variables (.env.example)

```
DATABASE_URL, NODE_ENV, PORT
AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET_NAME
AWS_SQS_*_QUEUE_URL, AWS_SQS_DLQ_URL
SQS_WORKER_ENABLED, SQS_WORKER_POLL_WAIT_SECONDS, SQS_WORKER_CONCURRENCY,
SQS_WORKER_SHUTDOWN_TIMEOUT_MS, SQS_VISIBILITY_TIMEOUT_SECONDS
REDIS_*
GOOGLE_DRIVE_*
GEMINI_API_KEY, GEMINI_MODEL, GEMINI_PROMPT_VERSION, GEMINI_MAX_RPS
OPENAI_API_KEY, OPENAI_EMBEDDING_MODEL, OPENAI_MAX_RPS
AI_COST_GEMINI_PER_IMAGE, AI_COST_OPENAI_EMBEDDING_PER_CALL
AI_CIRCUIT_FAILURE_THRESHOLD, AI_CIRCUIT_COOLDOWN_MS
PIPELINE_MAX_ATTEMPTS, PIPELINE_BACKOFF_BASE_SECONDS, PIPELINE_BACKOFF_MAX_SECONDS
```

**AWS note:** Queue visibility timeout should be ≥ `SQS_VISIBILITY_TIMEOUT_SECONDS` (default 900) and longer than max stage time (download + Gemini + embedding + margin). Worker extends visibility on each message start.

---

## Phase 2 Status (021–027)

| Task | Status | Summary |
|---|---|---|
| 021 | COMPLETED | SqsWorkerService — long-poll, concurrency, graceful shutdown, ack strategy |
| 022 | COMPLETED | Single failure handling, DLQ replay fix, stage latency metrics |
| 023 | COMPLETED | `scripts/validate/*` + `npm run validate:*` |
| 024 | COMPLETED | Manual validation playbook |
| 025 | COMPLETED | COMPONENT_VALIDATION_REPORT.md |
| 026 | DOCUMENTED | Full real integration procedure (user execution pending) |
| 027 | DOCUMENTED | Production readiness checklist (user sign-off pending) |
| 020 | **DEFERRED** | Pilot migration — blocked until 026/027 approved |

---

## Token-Saving Optimizations (2026-07-31)

| Item | Status |
|---|---|
| Stage-level idempotency (skip Gemini/OpenAI if result exists) | DONE |
| Resume from last completed stage | DONE |
| Single Drive download (discovery metadata-only) | DONE |
| Prevent AI rebilling (persist before dispatch + skip guards) | DONE |
| Dry-run mode + cost estimator | DONE |
| Duplicate audit (`linkReason=SHA256_MATCH`) | DONE |
| AiUsage logging table + provider wiring | DONE |
| Provider rate limiting + circuit breakers | DONE |
| Visibility timeout extend | DONE |
| Stronger retry classification | DONE |
| Priority 3 metadata/search QA | **Deferred to testing phase** |
| Priority 4 full ops dashboard | **Deferred** |

**Apply migration:** `npx prisma migrate deploy` (or `migrate dev`) for `20260731120000_token_saving_optimizations`.

---

## Known Gaps / Deferred

1. Manual real-service validation of token-saving path + dry-run
2. Automated test expansion specifically for idempotency/resume/dry-run (basic unit suite updated)
3. HNSW vector index — still commented out in init migration
4. DLQ replay auth — endpoint unauthenticated
5. TASK-020 pilot migration — deferred until validation + readiness

---

## Commands

```bash
npm install
npm run build
npm test
npm run test:e2e
npm run start:dev

# Dry-run example
# POST /asset-ingestion/jobs { "rootFolderId": "<id>", "mode": "DRY_RUN" }
# GET  /asset-ingestion/jobs/:id/estimate
```

On Windows PowerShell: `$env:Path = "C:\Program Files\nodejs;" + $env:Path`

---

## Conventions for Continuing

1. **Every expensive stage must stay independently idempotent and resumable**
2. Discovery must remain metadata-only (download only in worker or dry-run)
3. SQS payloads — minimal JSON IDs only
4. Prisma 7 — client at `generated/prisma/`, import via `@generated/prisma/client`
5. **No commits** unless explicitly requested
6. Next phase: test dry-run, replay without rebilling, rate limiter/circuit behavior, then TASK-026

---

## Prompt to Start Next Chat

```
Continue the AI Asset Ingestion project in D:/AI Team/AI_Applications.

Read docs/asset-ingestion/HANDOFF_CONTEXT.md and docs/optimization.md.

Token-saving Priority 0–2 is implemented. Run/expand tests for:
- metadata-only discovery + single download
- Gemini/OpenAI skip-on-existing
- dry-run + cost estimate
- AiUsage rows
- DLQ replay without rebilling

Then execute TASK-026 integration test and TASK-027 checklist before TASK-020 pilot.
```
