# AI Asset Ingestion & Semantic Image Retrieval System — Implementation Plan

## Executive Summary & Audit Findings (Phase 0 — Repository Discovery)

### 1. Repository Status
* **Framework**: NestJS 11 (`@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`)
* **ORMs & Database Drivers**: Prisma 7 (`prisma`, `@prisma/client`, `@prisma/adapter-pg`), PostgreSQL driver (`pg`)
* **Environment Management**: `dotenv` configured via `prisma.config.ts`.
* **Testing Setup**: Jest configured for unit tests (`src/**/*.spec.ts`) and e2e testing (`test/jest-e2e.json`).

### 2. Infrastructure Audit & Current State (Updated Phase 2)

| Component / Infrastructure | Current Status | Notes |
| :--- | :--- | :--- |
| **NestJS Structure** | **Implemented** | Feature modules: `AssetIngestionModule`, `StorageModule`, `QueueModule`, `AiModule`, `SearchModule`, `PipelineModule`, `ObservabilityModule` |
| **Prisma & Data Model** | **Implemented** | All models + PGVector migration; HNSW index deferred until measured |
| **AWS S3 Storage** | **Implemented** | `S3StorageService` with upload, download, signed URLs |
| **AWS SQS Queue** | **Implemented** | `SqsQueueService` (producer) + `SqsWorkerService` (consumer pollers) |
| **Redis Caching** | **Implemented** | `RedisCacheService` for search + asset metadata |
| **Google Drive Ingestion** | **Implemented** | `GoogleDriveAdapterService` with recursive folder scan |
| **Image Validation & Hash** | **Implemented** | `ImageProcessorService` (Sharp, SHA-256, AI resize) |
| **AI Vision Provider** | **Implemented** | `GeminiVisionProvider` + `VisionMetadataService` |
| **AI Embedding Provider** | **Implemented** | `OpenAiEmbeddingProvider` + `VectorStorageService` |
| **Logging & Metrics** | **Implemented** | Structured JSON logging + `GET /observability/metrics` |
| **Component Validation Scripts** | **Implemented** | `scripts/validate/*` + `npm run validate:*` |
| **Manual Real-Service Validation** | **PENDING** | See `COMPONENT_VALIDATION_REPORT.md` — user must confirm |

### 3. Potential Conflicts & Technical Decisions
* **Prisma 7 Compatibility**: Uses `@prisma/adapter-pg`. PGVector columns can be handled via raw queries or supported vector types.
* **SQS Payload Limits**: SQS payloads will be kept strictly to minimal JSON IDs (`assetId`, `ingestionFileId`). Binary payload transfers through SQS are forbidden.
* **Image Memory Management**: Large image files will be streamed directly to S3 and buffer-managed through Sharp to prevent node process OOM issues when handling 10,000+ files.

---

## Task Execution Breakdown & Implementation Roadmap

| Task ID | Task Name | Status | Dependencies | Description | Acceptance Criteria |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TASK-001** | Repository Discovery & Audit | **COMPLETED** | None | Audit repo structure, modules, packages, and establish `IMPLEMENTATION_PLAN.md`. | Complete audit documented in `IMPLEMENTATION_PLAN.md`. |
| **TASK-002** | System Architecture & Data Contract Design | **COMPLETED** | TASK-001 | Design detailed data structures, state machine transitions, and NestJS module boundaries. | Architecture document & interface definitions created. |
| **TASK-003** | Prisma Schema & PGVector Migration | **COMPLETED** | TASK-002 | Add Prisma models (`Asset`, `IngestionJob`, etc.) and PGVector SQL migration scripts. | Prisma client generated, migration runs cleanly on PostgreSQL. |
| **TASK-004** | Core Configuration & Environment Setup | **COMPLETED** | TASK-003 | Add `@nestjs/config` and type-safe environment variable schemas for S3, SQS, Redis, AI keys. | App validates environment variables on startup. |
| **TASK-005** | AWS S3 Storage Adapter Service | **COMPLETED** | TASK-004 | Implement `S3StorageService` for canonical image uploads, Key generation (`assets/{id}/original/{file}`), signed URLs. | S3 upload, check-exists, and download unit/integration tests pass. |
| **TASK-006** | Google Drive Source Adapter Service | **COMPLETED** | TASK-004 | Implement `GoogleDriveAdapter` to list folder items recursively, download streams, handle Drive auth/throttling. | Unit/mock tests pass for folder scanning and file retrieval. |
| **TASK-007** | Image Validation, Hashing & Processing | **COMPLETED** | TASK-005 | Implement `ImageProcessorService` using Sharp for file validation, SHA-256 calculation, and AI resizing. | SHA-256 hash verified, corrupt file handling tested. |
| **TASK-008** | Ingestion Job Management & File Discovery | **COMPLETED** | TASK-006, TASK-007 | Implement `IngestionJobService` to create jobs, scan Drive folders, and populate `IngestionFile` records. | Jobs track scanning, total discovered, and created records correctly. |
| **TASK-009** | Duplicate Detection Logic | **COMPLETED** | TASK-008 | Implement hash-based duplicate check logic. Associate duplicate Drive references with existing canonical S3 assets. | Identical SHA-256 files reuse existing S3 asset & skip AI calls. |
| **TASK-010** | AWS SQS Queue Service & Topology | **COMPLETED** | TASK-004 | Implement `SqsQueueService` for producer/consumer dispatch across stage queues. | Messages dispatched and received reliably with SQS mock/integration. |
| **TASK-011** | Vision AI Provider Abstraction (Gemini Flash) | **COMPLETED** | TASK-004 | Implement `VisionProvider` interface and `GeminiVisionProvider` for structured JSON metadata extraction. | Vision provider returns schema-compliant JSON with mock/live tests. |
| **TASK-012** | Vision Metadata Generation & Parsing | **COMPLETED** | TASK-011 | Implement metadata generation, search description synthesis, versioning (`metadata_version`, `prompt_version`). | Search descriptions generated deterministically and saved in DB. |
| **TASK-013** | Text Embedding AI Provider Abstraction (OpenAI) | **COMPLETED** | TASK-004 | Implement `EmbeddingProvider` interface and `OpenAiEmbeddingProvider` for 1536-dim text-embedding-3-small. | Embeddings generated correctly, text hash tracked for invalidate/recompute. |
| **TASK-014** | PGVector Vector Indexing & Similarity Search | **COMPLETED** | TASK-003, TASK-013 | Implement `VectorStorageService` storing 1536-dim vectors in PGVector, execute cosine similarity search queries. | Vector search returns top-k nearest assets by cosine distance. |
| **TASK-015** | Semantic Search API & Metadata Filtering | **COMPLETED** | TASK-014 | Implement `SearchController` & `SearchService` supporting text search + hybrid filters (category, orientation, color, etc.). | Combined semantic + metadata filtered search results returned correctly. |
| **TASK-016** | Redis Caching Layer for Search | **COMPLETED** | TASK-004, TASK-015 | Implement `RedisCacheService` for caching search results & hot asset metadata with TTL. | Search response cached in Redis, cache bypass on flush works seamlessly. |
| **TASK-017** | State Machine Pipeline, Retry Strategy & DLQ Handling | **COMPLETED** | TASK-010 | Implement complete asset state machine (`DISCOVERED` -> `COMPLETED`), exponential backoff, DLQ capture & replay. | Retry logic handles transient failures, non-retryable move to DLQ. |
| **TASK-018** | Observability, Structured Logging & Metrics | **COMPLETED** | TASK-017 | Implement logging interceptors, job progress metrics, latency metrics, and failure tracing. | Logs contain trace identifiers (`job_id`, `asset_id`, `stage`, `sqs_message_id`). |
| **TASK-019** | Integration & End-to-End Suite | **COMPLETED** | TASK-001..18 | Write unit, integration, and E2E pipeline tests from Drive discovery to Search API response. | Full E2E test passes in test environment. |
| **TASK-020** | Pilot Migration & Execution Protocol | **DEFERRED** | TASK-027 | Execute pilot migration in batches (10 → 100 → 1000 images), generate cost, performance & quality reports. | Pilot report generated with metrics before full 10,000+ run. |
| **TASK-021** | SQS Worker Runtime | **COMPLETED** | TASK-010, TASK-017 | Long-running SQS pollers invoke `AssetPipelineService.processQueueMessage()` with graceful shutdown. | Worker consumes messages; success/failure ack strategy correct; unit tests pass. |
| **TASK-022** | Pipeline Reliability Fixes | **COMPLETED** | TASK-017, TASK-021 | Fix nested double-DLQ, DLQ replay stage mapping, metrics latency recording. | Single DLQ per failure; VALIDATING replay works; stage latency metrics populated. |
| **TASK-023** | Component Validation Harness | **COMPLETED** | TASK-004 | `scripts/validate/*` + `npm run validate:*` for per-module real-service testing. | Each script bootstraps one module, exits non-zero on failure. |
| **TASK-024** | Manual Validation Playbook | **COMPLETED** | TASK-023 | Document 18 module validation procedures in this plan. | Playbook section below covers all modules with pass criteria. |
| **TASK-025** | Component Validation Report | **COMPLETED** | TASK-024 | Tracking table in `COMPONENT_VALIDATION_REPORT.md`. | All real-service rows PENDING until user confirms. |
| **TASK-026** | Full Real Integration Validation | **DOCUMENTED** | TASK-021..025 | Controlled Drive folder (3–5 images) through real SQS workers + full pipeline → search. | Procedure documented below; execution pending user validation. |
| **TASK-027** | Production Readiness Review | **DOCUMENTED** | TASK-026 | Pre-pilot checklist gate before TASK-020. | Checklist appended below; approval pending user sign-off. |

---

## Detailed Task Documentation

### TASK-001 — Repository Discovery & Existing Infrastructure Audit
* **Status**: `COMPLETED`
* **Files Changed**: `docs/asset-ingestion/IMPLEMENTATION_PLAN.md`
* **Notes**: Completed repository scan. Identified NestJS 11 + Prisma 7 stack. Documented missing infrastructure and package dependencies.

### TASK-002 — System Architecture & Data Contract Design
* **Status**: `COMPLETED`
* **Files Changed**:
  - `src/common/enums/asset-state.enum.ts`
  - `src/common/dto/vision-metadata.dto.ts`
  - `src/common/interfaces/vision-provider.interface.ts`
  - `src/common/interfaces/embedding-provider.interface.ts`
  - `src/common/interfaces/sqs-messages.interface.ts`
  - `src/common/interfaces/storage-provider.interface.ts`
* **Notes**: Defined state machine lifecycle enums, Vision/Embedding provider contracts, SQS stage message contracts, and S3 StorageProvider interfaces. Compilation verified clean.

### TASK-003 — Prisma Schema & PGVector Migration
* **Status**: `COMPLETED`
* **Files Changed**:
  - `prisma/schema.prisma`
  - `prisma/migrations/20260729_init_pgvector/migration.sql`
* **Notes**: Defined Prisma models (`IngestionJob`, `IngestionFile`, `Asset`, `AssetSource`, `AssetMetadata`, `AssetEmbedding`, `ProcessingAttempt`) with relations, indices, content hash uniqueness, and PGVector 1536-dim vector column configuration. Prisma 7 Client successfully generated and build verified.

### TASK-004 — Core Configuration & Environment Setup
* **Status**: `COMPLETED`
* **Files Changed**:
  - `src/config/configuration.ts`
  - `src/app.module.ts`
  - `.env.example`
* **Notes**: Installed `@nestjs/config`, created type-safe configuration schema (`AppConfig`), registered global `ConfigModule`, and created `.env.example`. Build verified clean.

### TASK-005 — AWS S3 Storage Adapter Service
* **Status**: `COMPLETED`
* **Files Changed**:
  - `src/modules/storage/s3-storage.service.ts`
  - `src/modules/storage/storage.module.ts`
  - `src/modules/storage/s3-storage.service.spec.ts`
  - `src/app.module.ts`
* **Notes**: Installed `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner`. Implemented `S3StorageService` implementing `StorageProvider` for buffer & stream uploads, file verification, canonical object key formatting (`assets/{assetId}/original/{filename}`), and signed URL generation. Tests and build passed cleanly.

### TASK-006 — Google Drive Source Adapter Service
* **Status**: `COMPLETED`
* **Files Changed**:
  - `src/modules/drive/interfaces/drive-file.interface.ts`
  - `src/modules/drive/google-drive-adapter.service.ts`
  - `src/modules/drive/drive.module.ts`
  - `src/modules/drive/google-drive-adapter.service.spec.ts`
  - `src/app.module.ts`
* **Notes**: Installed `googleapis`. Implemented `GoogleDriveAdapterService` for recursive folder scanning, relative path hierarchy construction, streaming downloads, and exponential backoff retries on rate limits (429/5xx). Unit tests and build verified clean.

### TASK-007 — Image Validation, Hashing & Processing
* **Status**: `COMPLETED`
* **Files Changed**:
  - `src/modules/image/interfaces/image-validation.interface.ts`
  - `src/modules/image/image-processor.service.ts`
  - `src/modules/image/image.module.ts`
  - `src/modules/image/image-processor.service.spec.ts`
  - `src/app.module.ts`
* **Notes**: Installed `sharp` & `@types/sharp`. Implemented `ImageProcessorService` for SHA-256 hashing from buffers/streams, image validation (format, dimensions, corruption detection, size limits, orientation), and AI-optimized JPEG conversion for vision model input. All 10 Jest tests and build verified clean.

### TASK-008 — Ingestion Job Management & File Discovery
* **Status**: `COMPLETED`
* **Files Changed**:
  - `src/common/utils/error-message.ts`
  - `src/modules/database/database.module.ts`
  - `src/modules/database/prisma.service.ts`
  - `src/modules/queue/queue.module.ts`
  - `src/modules/queue/sqs-queue.service.ts`
  - `src/modules/ingestion/dto/create-ingestion-job.dto.ts`
  - `src/modules/ingestion/ingestion-job.service.ts`
  - `src/modules/ingestion/ingestion.controller.ts`
  - `src/modules/ingestion/ingestion.module.ts`
  - `src/modules/ingestion/ingestion-job.service.spec.ts`
  - `src/app.module.ts`
  - `prisma/schema.prisma`
  - `package.json`
  - `package-lock.json`
  - `tsconfig.json`
* **Notes**: Implemented job creation and status APIs, recursive Drive discovery, idempotent `IngestionFile` upserts, downstream SQS dispatch, failure-state persistence, and Prisma 7 PostgreSQL adapter wiring. Added Prisma client generation to installation scripts. All 16 unit tests and the production build pass. `AssetSource` creation remains deferred until TASK-009 resolves each file to a canonical asset.

### TASK-009 — Duplicate Detection Logic
* **Status**: `COMPLETED`
* **Files Changed**:
  - `src/modules/ingestion/ingestion-job.service.ts`
  - `src/modules/ingestion/ingestion-job.service.spec.ts`
  - `src/modules/storage/s3-storage.service.ts`
* **Notes**: Added hash-based duplicate detection during ingestion, downloaded Drive files for validation and SHA-256 hashing, reused existing canonical assets when the content hash matched, created `AssetSource` links for duplicate Drive references, and enqueued downstream processing only for new assets. Focused ingestion tests and the full Jest suite passed, along with the production build.

### TASK-010 — AWS SQS Queue Service & Topology
* **Status**: `COMPLETED`
* **Files Changed**:
  - `src/modules/queue/queue-topology.constants.ts`
  - `src/modules/queue/sqs-queue.service.ts`
  - `src/modules/queue/sqs-queue.service.spec.ts`
* **Notes**: Defined stage-to-queue topology mapping (`ingestion` → `s3Upload` → `aiMetadata` → `embedding` + `dlq`). Enhanced `SqsQueueService` with typed stage dispatch helpers, typed receive/delete/visibility APIs, queue depth inspection, and configured-queue discovery. Added 10 unit tests with mocked AWS SDK client. All 27 Jest tests and the production build pass.

### TASK-011 — Vision AI Provider Abstraction (Gemini Flash)
* **Status**: `COMPLETED`
* **Files Changed**:
  - `src/modules/ai/ai.module.ts`
  - `src/modules/ai/constants/vision-prompt.constants.ts`
  - `src/modules/ai/providers/gemini-vision.provider.ts`
  - `src/modules/ai/providers/gemini-vision.provider.spec.ts`
  - `src/modules/ai/utils/search-description.builder.ts`
  - `src/modules/ai/utils/vision-metadata.parser.ts`
  - `src/modules/ai/utils/vision-metadata.utils.spec.ts`
  - `src/config/configuration.ts`
  - `src/app.module.ts`
  - `.env.example`
  - `package.json`
  - `package-lock.json`
* **Notes**: Installed `@google/genai`. Implemented `GeminiVisionProvider` with structured JSON output via Gemini Flash (`gemini-2.5-flash`), prompt/schema constants, metadata parsing/normalization, deterministic search-description synthesis, and `VISION_PROVIDER` injection token. Added Gemini model/prompt-version config. All 34 Jest tests and the production build pass.

### TASK-012 — Vision Metadata Generation & Parsing
* **Status**: `COMPLETED`
* **Files Changed**:
  - `src/modules/ai/services/vision-metadata.service.ts`
  - `src/modules/ai/services/vision-metadata.service.spec.ts`
  - `src/modules/ai/utils/vision-metadata.mapper.ts`
  - `src/modules/ai/utils/vision-metadata.mapper.spec.ts`
  - `src/modules/ai/ai.module.ts`
* **Notes**: Implemented `VisionMetadataService` to download S3 assets, generate AI-optimized vision input, call `GeminiVisionProvider`, synthesize deterministic search descriptions, hash them for dedupe/invalidation, and upsert `AssetMetadata` with `metadataVersion`/`promptVersion` tracking. Updates asset status to `METADATA_GENERATED`. All 38 Jest tests and the production build pass.

### TASK-013 — Text Embedding AI Provider Abstraction (OpenAI)
* **Status**: `COMPLETED`
* **Files Changed**:
  - `src/modules/ai/constants/embedding.constants.ts`
  - `src/modules/ai/providers/openai-embedding.provider.ts`
  - `src/modules/ai/providers/openai-embedding.provider.spec.ts`
  - `src/modules/ai/utils/source-text-hash.util.ts`
  - `src/modules/ai/utils/source-text-hash.util.spec.ts`
  - `src/modules/ai/ai.module.ts`
  - `src/config/configuration.ts`
  - `.env.example`
  - `package.json`
  - `package-lock.json`
* **Notes**: Installed `openai`. Implemented `OpenAiEmbeddingProvider` for `text-embedding-3-small` (1536-dim) with SHA-256 `sourceTextHash` tracking for invalidate/recompute, dimension validation, and `EMBEDDING_PROVIDER` injection token. Added `OPENAI_EMBEDDING_MODEL` config. All 44 Jest tests and the production build pass.

### TASK-014 — PGVector Vector Indexing & Similarity Search
* **Status**: `COMPLETED`
* **Files Changed**:
  - `src/modules/search/search.module.ts`
  - `src/modules/search/vector-storage.service.ts`
  - `src/modules/search/vector-storage.service.spec.ts`
  - `src/modules/search/interfaces/vector-search.interface.ts`
  - `src/app.module.ts`
* **Notes**: Implemented `VectorStorageService` with raw PGVector SQL to write 1536-dim vectors into `AssetEmbedding.vector`, idempotent storage keyed by `sourceTextHash`, version increments on text changes, and top-k cosine similarity search (`<=>`) over latest embeddings per asset. Added `SearchModule` and registered it in `AppModule`. All 50 Jest tests and the production build pass.

### TASK-015 — Semantic Search API & Metadata Filtering
* **Status**: `COMPLETED`
* **Files Changed**:
  - `src/modules/search/search.controller.ts`
  - `src/modules/search/search.service.ts`
  - `src/modules/search/search.service.spec.ts`
  - `src/modules/search/dto/search-assets.dto.ts`
  - `src/modules/search/interfaces/search-result.interface.ts`
  - `src/modules/search/utils/metadata-filter.util.ts`
  - `src/modules/search/utils/metadata-filter.util.spec.ts`
  - `src/modules/search/search.module.ts`
* **Notes**: Implemented `POST /search` with query embedding via `OpenAiEmbeddingProvider`, PGVector candidate retrieval, hybrid metadata filtering (orientation, colors, styles, objects, actions, age groups, educational uses, background), and similarity-ranked asset results. All 57 Jest tests and the production build pass.

### TASK-016 — Redis Caching Layer for Search
* **Status**: `COMPLETED`
* **Files Changed**:
  - `src/modules/cache/cache.module.ts`
  - `src/modules/cache/redis-cache.service.ts`
  - `src/modules/cache/redis-cache.service.spec.ts`
  - `src/modules/cache/utils/cache-key.util.ts`
  - `src/modules/search/search.service.ts`
  - `src/modules/search/search.service.spec.ts`
  - `src/modules/search/search.controller.ts`
  - `src/modules/search/search.module.ts`
  - `src/modules/search/dto/search-assets.dto.ts`
  - `src/modules/search/interfaces/search-result.interface.ts`
  - `src/config/configuration.ts`
  - `src/app.module.ts`
  - `.env.example`
  - `package.json`
  - `package-lock.json`
* **Notes**: Installed `ioredis`. Implemented `RedisCacheService` with TTL-backed JSON caching, pattern-based flush for search and asset-metadata keys, graceful fallback when Redis is unavailable, search cache integration with `bypassCache` support, hot asset metadata caching after DB loads, and `POST /search/cache/flush`. Added Redis TTL/enabled config. All 61 Jest tests and the production build pass.

### TASK-017 — State Machine Pipeline, Retry Strategy & DLQ Handling
* **Status**: `COMPLETED`
* **Files Changed**:
  - `src/modules/pipeline/pipeline.module.ts`
  - `src/modules/pipeline/pipeline.controller.ts`
  - `src/modules/pipeline/constants/pipeline.constants.ts`
  - `src/modules/pipeline/services/asset-pipeline.service.ts`
  - `src/modules/pipeline/services/pipeline-retry.service.ts`
  - `src/modules/pipeline/services/pipeline-retry.service.spec.ts`
  - `src/modules/pipeline/utils/error-classifier.util.ts`
  - `src/modules/pipeline/utils/error-classifier.util.spec.ts`
  - `src/modules/pipeline/utils/retry-backoff.util.ts`
  - `src/modules/pipeline/utils/retry-backoff.util.spec.ts`
  - `src/config/configuration.ts`
  - `src/app.module.ts`
  - `.env.example`
* **Notes**: Implemented `AssetPipelineService` orchestrating the full asset lifecycle across ingestion, S3 upload, Gemini vision metadata, and OpenAI embedding stages. Added `PipelineRetryService` with retryable/non-retryable error classification, exponential backoff with jitter, `ProcessingAttempt` recording, DLQ dispatch, and stage-aware DLQ replay via `POST /pipeline/dlq/replay`. Registered `PipelineModule` with `AiModule` integration. All 67 Jest tests and the production build pass.

### TASK-018 — Observability, Structured Logging & Metrics
* **Status**: `COMPLETED`
* **Files Changed**:
  - `src/modules/observability/observability.module.ts`
  - `src/modules/observability/structured-logger.service.ts`
  - `src/modules/observability/pipeline-metrics.service.ts`
  - `src/modules/observability/metrics.controller.ts`
  - `src/modules/observability/interceptors/logging.interceptor.ts`
  - `src/modules/observability/interfaces/structured-log.interface.ts`
  - `src/modules/observability/utils/pipeline-log-fields.util.ts`
  - `src/modules/pipeline/services/asset-pipeline.service.ts`
  - `src/modules/pipeline/services/pipeline-retry.service.ts`
  - `src/modules/ingestion/ingestion-job.service.ts`
  - `src/app.module.ts`
  - `src/main.ts`
* **Notes**: Added global `ObservabilityModule` with JSON structured logging (`job_id`, `asset_id`, `processing_stage`, `sqs_message_id`, `duration_ms`, retry/DLQ fields), HTTP `LoggingInterceptor`, in-memory `PipelineMetricsService` with stage latency tracking, and `GET /observability/metrics`. Integrated structured logs and metrics into pipeline, retry, and ingestion flows. Added `traceId` to ingestion SQS payloads. All 72 Jest tests and the production build pass.

### TASK-019 — Integration & End-to-End Suite
* **Status**: `COMPLETED`
* **Files Changed**:
  - `test/support/in-memory-database.ts`
  - `test/support/test-prisma.service.ts`
  - `test/support/mock-sqs-queue.service.ts`
  - `test/support/mock-external-services.ts`
  - `test/support/in-memory-vector-storage.service.ts`
  - `test/support/pipeline-test-harness.ts`
  - `test/support/fixtures/sample-image.fixture.ts`
  - `test/support/fixtures/pipeline-data.fixture.ts`
  - `test/support/fixtures/embedding.fixture.ts`
  - `test/asset-ingestion-pipeline.e2e-spec.ts`
  - `test/pipeline-retry.integration.e2e-spec.ts`
  - `test/app.e2e-spec.ts`
  - `test/jest-e2e.json`
* **Notes**: Built in-memory test infrastructure (Prisma, SQS, S3, Drive, Redis, AI, PGVector) and a `PipelineTestHarness` wiring real NestJS modules with mocked externals. Added full pipeline E2E (Drive discovery → ingestion → metadata → embedding → semantic search), DLQ replay integration test, search cache E2E, and observability metrics verification. All 78 unit + 6 E2E tests and the production build pass.

---

## Phase 2 Overview — Hardening & Manual Validation

Phase 1 (TASK-001..019) delivered the full pipeline with in-memory E2E tests. Phase 2 closes production gaps, adds per-module validation harnesses, and gates pilot migration behind manual real-service confirmation.

```text
TASK-021  SQS Worker Runtime          COMPLETED
TASK-022  Pipeline Reliability Fixes  COMPLETED
TASK-023  Validation Harness          COMPLETED
TASK-024  Manual Validation Playbook   COMPLETED (documented below)
TASK-025  Component Validation Report COMPLETED (COMPONENT_VALIDATION_REPORT.md)
TASK-026  Full Real Integration Test  DOCUMENTED (user execution pending)
TASK-027  Production Readiness Review DOCUMENTED (user sign-off pending)
TASK-020  Pilot Migration             DEFERRED until TASK-026/027 approved
```

### Testing Layers

```text
Unit tests (src/**/*.spec.ts, mocks)
    ↓
E2E harness (test/support, in-memory mocks)
    ↓
Component scripts (scripts/validate/*, real single module)
    ↓
Manual playbook (this document)
    ↓
Full real integration (small Drive folder)
    ↓
Pilot migration (TASK-020, deferred)
```

### Known Gaps Resolved in Phase 2

| Issue | Resolution |
| :--- | :--- |
| No SQS consumer runtime | `SqsWorkerService` polls all processing queues on app start |
| Worker ack vs retry conflict | Original message deleted after failure (retry/DLQ dispatch new messages) |
| Double DLQ on nested stages | `runStage` only calls `handleFailure` at outer stage entry |
| DLQ replay missing VALIDATING/HASHING | `replayFromDlq` uses `resolveRetryQueue()` |
| Metrics latency mis-mapping | Latency recorded in `runStage` success path against active stage |

### TASK-021 — SQS Worker Runtime
* **Status**: `COMPLETED`
* **Files Changed**:
  - `src/modules/queue/sqs-worker.service.ts`
  - `src/modules/queue/sqs-worker.service.spec.ts`
  - `src/modules/queue/utils/sqs-message-validator.util.ts`
  - `src/modules/queue/utils/sqs-message-validator.util.spec.ts`
  - `src/modules/pipeline/pipeline.module.ts`
  - `src/config/configuration.ts`
  - `.env.example`
* **Config**: `SQS_WORKER_ENABLED`, `SQS_WORKER_POLL_WAIT_SECONDS`, `SQS_WORKER_CONCURRENCY`, `SQS_WORKER_SHUTDOWN_TIMEOUT_MS`
* **Notes**: Long-polling worker per processing queue; validates message shape; calls `AssetPipelineService.processQueueMessage()`; deletes on success and after failure handling; graceful shutdown via `OnModuleDestroy`. Validation scripts disable workers via `SQS_WORKER_ENABLED=false`.

### TASK-022 — Pipeline Reliability Fixes
* **Status**: `COMPLETED`
* **Files Changed**:
  - `src/modules/pipeline/services/asset-pipeline.service.ts`
  - `src/modules/pipeline/services/pipeline-retry.service.ts`
  - `src/modules/pipeline/services/pipeline-retry.service.spec.ts`
  - `test/pipeline-retry.integration.e2e-spec.ts`
* **Notes**: Nested stages pass `{ handleFailure: false }` to prevent duplicate DLQ entries. `replayFromDlq` uses `resolveRetryQueue()` (VALIDATING/HASHING → ingestion queue). Stage latency recorded in `runStage` against active processing stage.

### TASK-023 — Component Validation Harness
* **Status**: `COMPLETED`
* **Files Changed**:
  - `scripts/validate/shared/bootstrap.ts`
  - `scripts/validate/validate-*.ts` (drive, image, s3, vision, embedding, vector, search, cache, sqs, help)
  - `package.json` (`validate:*` scripts)
* **Notes**: Each script bootstraps minimal Nest context for one service, accepts CLI args, prints JSON to stdout, exits non-zero on failure. Run `npm run validate:help` for command list.

### TASK-024 — Manual Validation Playbook
* **Status**: `COMPLETED` (procedures below)
* **Files Changed**: This section of `IMPLEMENTATION_PLAN.md`

### TASK-025 — Component Validation Report
* **Status**: `COMPLETED`
* **Files Changed**: `docs/asset-ingestion/COMPONENT_VALIDATION_REPORT.md`
* **Notes**: All real-service rows remain **PENDING** until user manually confirms.

### TASK-026 — Full Real Integration Validation
* **Status**: `DOCUMENTED` (procedure below; execution pending user)
* **Dependencies**: TASK-021..025 manual validations pass

### TASK-027 — Production Readiness Review
* **Status**: `DOCUMENTED` (checklist below; approval pending user)
* **Dependencies**: TASK-026

### TASK-020 — Pilot Migration & Execution Protocol
* **Status**: `DEFERRED`
* **Dependencies**: TASK-027 checklist approved
* **Goal**: Execute pilot migration in batches (10 → 100 → 1000 images) and generate cost, performance, and quality reports.

---

## Manual Component Validation Playbook

Run validations one module at a time against real infrastructure. Record results in `COMPONENT_VALIDATION_REPORT.md`.

**Common prerequisites**: Configured `.env`, PostgreSQL running, `npm run build` clean. Validation scripts auto-set `SQS_WORKER_ENABLED=false`.

---

### 1. Google Drive

| Field | Content |
| :--- | :--- |
| **Purpose** | Verify Drive auth and recursive folder discovery without triggering pipeline |
| **Prerequisites** | `GOOGLE_DRIVE_CLIENT_EMAIL`, `GOOGLE_DRIVE_PRIVATE_KEY`; test folder with known image count |
| **Automated shortcut** | `npm run validate:drive -- --folder-id <FOLDER_ID>` |
| **Manual steps** | Run command; inspect JSON output for file list, mime types, sizes |
| **Expected result** | `totalDiscovered` matches expected count; all entries have `id`, `name`, `mimeType` |
| **Failure symptoms** | 403/401 in logs → credential/scope issue; empty list → wrong folder ID or permissions |
| **Cleanup** | None (read-only) |

---

### 2. Image Processing

| Field | Content |
| :--- | :--- |
| **Purpose** | Validate Sharp image validation, SHA-256 hashing, AI-optimized resize |
| **Prerequisites** | Valid PNG/JPEG test file; corrupt file for negative test |
| **Automated shortcut** | `npm run validate:image -- --file ./test-data/sample.png` |
| **Manual steps** | Run with valid image; repeat with corrupt/non-image file |
| **Expected result** | Valid: `validation.isValid=true`, `contentHash` present, `optimizedBytes > 0`. Invalid: `isValid=false` |
| **Failure symptoms** | Sharp errors in stdout; hash null on valid image |
| **Cleanup** | None |

---

### 3. Duplicate Detection

| Field | Content |
| :--- | :--- |
| **Purpose** | Verify hash-based duplicate skips AI stages and reuses canonical asset |
| **Prerequisites** | Two identical images in test Drive folder OR pre-seeded asset with known SHA-256 |
| **Automated shortcut** | E2E: `npm run test:e2e -- pipeline-retry` (mocked); real: create job with duplicate files |
| **Manual steps** | 1) Ingest one image fully. 2) Create job with same image again. 3) Query `Asset` table — second file should link to same `assetId`, state `COMPLETED` without new S3/AI calls |
| **Expected result** | Single canonical asset; duplicate `IngestionFile` references existing asset; no duplicate S3 keys |
| **Failure symptoms** | Two assets with same `contentHash`; duplicate AI API calls in logs |
| **Cleanup** | Remove test ingestion job records if desired |

---

### 4. S3 Storage

| Field | Content |
| :--- | :--- |
| **Purpose** | Upload, existence check, download round-trip |
| **Prerequisites** | `AWS_*` credentials, `AWS_S3_BUCKET_NAME` |
| **Automated shortcut** | `npm run validate:s3 -- --file ./test-data/sample.png` |
| **Manual steps** | Run command; verify object in AWS Console under `validation/` prefix |
| **Expected result** | `exists=true`, `sha256Match=true`, matching byte counts |
| **Failure symptoms** | AccessDenied, NoSuchBucket; downloaded bytes mismatch |
| **Cleanup** | Delete test object from S3 (`validation/` prefix) |

---

### 5. Gemini Vision (Metadata Generation)

| Field | Content |
| :--- | :--- |
| **Purpose** | Generate structured metadata from a real image |
| **Prerequisites** | `GEMINI_API_KEY`, `GEMINI_MODEL`; sample image file |
| **Automated shortcut** | `npm run validate:vision -- --file ./test-data/sample.png` |
| **Manual steps** | Run command; review JSON metadata fields (category, colors, description, etc.) |
| **Expected result** | Schema-compliant metadata JSON; non-empty `searchDescription` |
| **Failure symptoms** | API key errors, empty/malformed JSON, rate limit 429 |
| **Cleanup** | None (no persistence in validate script) |

---

### 6. Metadata Persistence

| Field | Content |
| :--- | :--- |
| **Purpose** | Verify metadata saved to PostgreSQL with versioning |
| **Prerequisites** | Completed asset through metadata stage OR run full job for one image |
| **Automated shortcut** | Unit tests in `vision-metadata.service.spec.ts` |
| **Manual steps** | After metadata stage: `SELECT * FROM "AssetMetadata" WHERE "assetId" = '<ID>'`; verify `metadataVersion`, `promptVersion`, JSON payload |
| **Expected result** | Row exists with populated JSON; versions match config |
| **Failure symptoms** | Missing row; null fields; Prisma constraint errors in logs |
| **Cleanup** | Delete test asset records if desired |

---

### 7. OpenAI Embedding

| Field | Content |
| :--- | :--- |
| **Purpose** | Generate 1536-dim embedding from text |
| **Prerequisites** | `OPENAI_API_KEY`, `OPENAI_EMBEDDING_MODEL` |
| **Automated shortcut** | `npm run validate:embedding -- --text "orange cat on windowsill"` |
| **Manual steps** | Run command; verify `dimensions: 1536`, non-zero vector values |
| **Expected result** | Embedding array length 1536; consistent hash for same text |
| **Failure symptoms** | 401 auth error; wrong dimensions; timeout |
| **Cleanup** | None |

---

### 8. PGVector (Similarity Search)

| Field | Content |
| :--- | :--- |
| **Purpose** | Store and query vectors via cosine similarity |
| **Prerequisites** | PostgreSQL with pgvector; at least one embedded asset OR script seeds query |
| **Automated shortcut** | `npm run validate:vector -- --text "sample query" --top-k 5` |
| **Manual steps** | Run with `--asset-id` of known embedded asset; verify ranked results |
| **Expected result** | Results ordered by similarity; known asset appears in top-k |
| **Failure symptoms** | Empty results; SQL errors on vector column; dimension mismatch |
| **Cleanup** | None |

---

### 9. Semantic Search

| Field | Content |
| :--- | :--- |
| **Purpose** | End-to-end search API against real embedded assets |
| **Prerequisites** | App running (`npm run start:dev`); seeded/completed assets in DB |
| **Automated shortcut** | `npm run validate:search -- --query "orange cat"` |
| **Manual steps** | `curl -X POST http://localhost:3000/search -H "Content-Type: application/json" -d '{"query":"orange cat","limit":5,"bypassCache":true}'` |
| **Expected result** | JSON results with `assets[]`, similarity scores, metadata |
| **Failure symptoms** | Empty results; 500 errors; embedding API failures in logs |
| **Cleanup** | None |

---

### 10. Metadata Filtering

| Field | Content |
| :--- | :--- |
| **Purpose** | Hybrid semantic search + metadata filters |
| **Prerequisites** | Assets with known category/orientation/color metadata |
| **Automated shortcut** | `npm run validate:search -- --query "cat"` then add filters via API |
| **Manual steps** | `POST /search` with `filters: { category: "photograph", orientation: "landscape" }` |
| **Expected result** | All returned assets match filter criteria |
| **Failure symptoms** | Filtered-out assets appear; SQL/Prisma filter errors |
| **Cleanup** | None |

---

### 11. Redis Cache

| Field | Content |
| :--- | :--- |
| **Purpose** | Verify cache miss → hit → flush cycle |
| **Prerequisites** | `REDIS_ENABLED=true`, Redis running |
| **Automated shortcut** | `npm run validate:cache -- --query "orange cat"` |
| **Manual steps** | Run script; confirm `firstFromCache=false`, `secondFromCache=true`, after flush `thirdFromCache=false` |
| **Expected result** | Cache hit on second identical query; flush resets |
| **Failure symptoms** | Both requests miss cache; Redis connection errors |
| **Cleanup** | `POST /search/cache/flush` or script handles flush |

---

### 12. SQS Worker

| Field | Content |
| :--- | :--- |
| **Purpose** | Verify worker polls queues and processes messages end-to-end |
| **Prerequisites** | SQS queues configured; `SQS_WORKER_ENABLED=true`; app running |
| **Automated shortcut** | `npm run validate:sqs -- --queue ingestion` (connectivity/depth only) |
| **Manual steps** | 1) Start app with workers enabled. 2) `POST /asset-ingestion/jobs` with test folder. 3) Monitor queue depth decreasing. 4) Verify assets reach `COMPLETED` |
| **Expected result** | Queue depth drops; structured logs show `processQueueMessage`; assets progress through states |
| **Failure symptoms** | Messages accumulate; worker not starting; duplicate processing |
| **Cleanup** | Purge test queues if needed; delete test assets |

---

### 13. Retry (Transient Failures)

| Field | Content |
| :--- | :--- |
| **Purpose** | Verify exponential backoff retry on transient errors |
| **Prerequisites** | Ability to simulate transient failure (e.g., temporary S3 deny) |
| **Automated shortcut** | E2E: `test/pipeline-retry.integration.e2e-spec.ts` |
| **Manual steps** | Induce transient failure; check `ProcessingAttempt` records; verify delayed retry message in SQS |
| **Expected result** | Attempt count increments; retry scheduled with backoff; succeeds on recovery |
| **Failure symptoms** | Immediate DLQ without retries; duplicate processing |
| **Cleanup** | Restore normal permissions; purge retry messages |

---

### 14. DLQ (Permanent Failures)

| Field | Content |
| :--- | :--- |
| **Purpose** | Verify non-retryable errors move to DLQ after max attempts |
| **Prerequisites** | DLQ queue URL configured |
| **Automated shortcut** | E2E retry spec covers DLQ path |
| **Manual steps** | Induce permanent failure (corrupt image); wait for max attempts; check DLQ queue in AWS Console |
| **Expected result** | Single DLQ message per failed asset; `totalFailed` incremented once |
| **Failure symptoms** | Multiple DLQ entries for same asset; message stuck in processing queue |
| **Cleanup** | Purge DLQ test messages |

---

### 15. DLQ Replay

| Field | Content |
| :--- | :--- |
| **Purpose** | Replay DLQ message back to correct stage queue |
| **Prerequisites** | Message in DLQ; underlying issue resolved |
| **Automated shortcut** | E2E: `test/pipeline-retry.integration.e2e-spec.ts` |
| **Manual steps** | `POST /pipeline/dlq/replay` with DLQ receipt handle / message body; verify reprocessing |
| **Expected result** | Message removed from DLQ; dispatched to correct queue (VALIDATING → ingestion); asset progresses |
| **Failure symptoms** | Replay to wrong queue; VALIDATING/HASHING replay fails |
| **Cleanup** | None after successful replay |
| **Security note** | DLQ replay endpoint has no auth — restrict in production (document only) |

---

### 16. State Transitions

| Field | Content |
| :--- | :--- |
| **Purpose** | Verify asset progresses through full state machine |
| **Prerequisites** | Single-image ingestion job with workers enabled |
| **Automated shortcut** | E2E: `test/asset-ingestion-pipeline.e2e-spec.ts` |
| **Manual steps** | Create job; poll `GET /asset-ingestion/jobs/:id`; track asset states in DB |
| **Expected result** | `DISCOVERED → DOWNLOADING → VALIDATING → HASHING → UPLOADING_TO_S3 → STORED_IN_S3 → GENERATING_METADATA → METADATA_GENERATED → GENERATING_EMBEDDING → COMPLETED` |
| **Failure symptoms** | Stuck state; skipped stages; regression |
| **Cleanup** | Delete test job/asset records |

---

### 17. Idempotency

| Field | Content |
| :--- | :--- |
| **Purpose** | Duplicate SQS messages do not corrupt state or create duplicates |
| **Prerequisites** | Ability to observe SQS message handling |
| **Automated shortcut** | E2E pipeline tests cover idempotent stages |
| **Manual steps** | Re-deliver same message (or replay); verify asset state unchanged, no duplicate S3/AI work |
| **Expected result** | Second processing is no-op or safely skipped |
| **Failure symptoms** | Duplicate S3 uploads; double metadata rows; inflated metrics |
| **Cleanup** | None |

---

### 18. Observability Trace

| Field | Content |
| :--- | :--- |
| **Purpose** | Trace single asset through logs and metrics |
| **Prerequisites** | App running with structured logging |
| **Automated shortcut** | E2E observability assertions; `GET /observability/metrics` |
| **Manual steps** | Process one asset; grep logs for `job_id`, `asset_id`, `processing_stage`, `sqs_message_id`; check metrics counters and latency |
| **Expected result** | Correlated log fields across stages; non-zero stage latency in metrics |
| **Failure symptoms** | Missing trace fields; latency counters at 0 for active stages |
| **Cleanup** | None |

---

## TASK-026 — Full Real Integration Validation Procedure

Execute only after all component validations in `COMPONENT_VALIDATION_REPORT.md` are **PASS** or **PASS_WITH_NOTES**.

1. **Prepare** a Google Drive folder with 3–5 diverse real images (PNG/JPEG, different subjects).
2. **Configure** `.env` with all real credentials; set `SQS_WORKER_ENABLED=true`.
3. **Start** app: `npm run start:dev`.
4. **Create job**: `POST /asset-ingestion/jobs` with `{ "driveFolderId": "<FOLDER_ID>", "name": "integration-test-<date>" }`.
5. **Monitor**:
   - SQS queue depths (AWS Console or `npm run validate:sqs`)
   - Structured logs for each asset
   - `GET /asset-ingestion/jobs/:id` until job completes
6. **Verify DB**: All assets `COMPLETED`; metadata and embeddings present.
7. **Search**: Run 3–5 queries relevant to test images; confirm relevant results.
8. **Cache**: Repeat search; verify cache hit; flush and confirm miss.
9. **Record** timings, AI token usage, S3 object count, and any failures in `COMPONENT_VALIDATION_REPORT.md`.
10. **Do not** use the full 10K+ dataset at this stage.

---

## TASK-027 — Production Readiness Checklist

Gate before TASK-020 pilot migration. All items must be checked by the user.

### Infrastructure

- [ ] PostgreSQL ready
- [ ] pgvector extension enabled
- [ ] S3 bucket ready
- [ ] SQS queues + DLQ configured
- [ ] SQS workers running (`SQS_WORKER_ENABLED=true`)
- [ ] Redis ready
- [ ] Google Drive service account credentials ready
- [ ] Gemini API key ready
- [ ] OpenAI API key ready

### Pipeline

- [ ] Drive discovery works (Playbook §1)
- [ ] Image processing works (§2)
- [ ] Hashing works (§2)
- [ ] Duplicate detection works (§3)
- [ ] S3 upload works (§4)
- [ ] Metadata generation works (§5)
- [ ] Metadata persistence works (§6)
- [ ] Embedding generation works (§7)
- [ ] PGVector storage works (§8)
- [ ] Search works (§9)
- [ ] Metadata filtering works (§10)
- [ ] Redis cache works (§11)

### Reliability

- [ ] Retry works (§13)
- [ ] DLQ works (§14)
- [ ] DLQ replay works (§15)
- [ ] Idempotency works (§17)
- [ ] State transitions work (§16)
- [ ] Failure recovery works
- [ ] Graceful worker shutdown works

### Observability

- [ ] Structured logs work (§18)
- [ ] Metrics endpoint works (§18)
- [ ] Asset traceability works (§18)
- [ ] Failure investigation is possible

### AI Quality

- [ ] Metadata quality manually reviewed
- [ ] Search descriptions are useful
- [ ] Embeddings generated correctly
- [ ] Semantic search results are relevant
- [ ] AI token usage is measurable
- [ ] AI cost is measurable

**Approval**: Only proceed to TASK-020 after this checklist and TASK-026 integration test are signed off.

---

### Next Immediate Task: Manual Validation (User)

* **Dependencies**: TASK-021..025 implementation complete
* **Goal**: Execute Manual Component Validation Playbook; update `COMPONENT_VALIDATION_REPORT.md`; run TASK-026 integration test; approve TASK-027 checklist
* **Then**: TASK-020 Pilot Migration (DEFERRED until above complete)
