# AI Asset Ingestion & Semantic Image Retrieval System — Implementation Plan

## Executive Summary & Audit Findings (Phase 0 — Repository Discovery)

### 1. Repository Status
* **Framework**: NestJS 11 (`@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`)
* **ORMs & Database Drivers**: Prisma 7 (`prisma`, `@prisma/client`, `@prisma/adapter-pg`), PostgreSQL driver (`pg`)
* **Environment Management**: `dotenv` configured via `prisma.config.ts`.
* **Testing Setup**: Jest configured for unit tests (`src/**/*.spec.ts`) and e2e testing (`test/jest-e2e.json`).

### 2. Infrastructure Audit & Gaps Analysis

| Component / Infrastructure | Current Status | Required Packages / Dependencies | Missing Implementation |
| :--- | :--- | :--- | :--- |
| **NestJS Structure** | Basic boilerplate (`AppModule`) | `@nestjs/config` | Feature modules: `AssetIngestionModule`, `StorageModule`, `QueueModule`, `AiModule`, `SearchModule` |
| **Prisma & Data Model** | Minimal schema without models | Prisma v7 (`@prisma/client`) | Models: `IngestionJob`, `IngestionFile`, `Asset`, `AssetSource`, `AssetMetadata`, `AssetEmbedding`, `ProcessingAttempt` |
| **PGVector Extension** | Not configured | `pgvector` / native SQL migrations | Migration script for `CREATE EXTENSION IF NOT EXISTS vector;` and vector index creation |
| **AWS S3 Storage** | Not present | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` | `S3StorageService` with bucket management, key generation, signed URLs, and stream uploads |
| **AWS SQS Queue** | Not present | `@aws-sdk/client-sqs` | `SqsQueueService` & consumer workers for stage-specific message queues & DLQ handling |
| **Redis Caching** | Not present | `ioredis` | `RedisService` for hot search query caching & asset lookup |
| **Google Drive Ingestion** | Not present | `googleapis` | `GoogleDriveAdapter` for folder scanning, file discovery, metadata reading, and streaming file downloads |
| **Image Validation & Hash** | Not present | `sharp`, `@types/sharp` | `ImageProcessorService` for SHA-256 calculation, image validation, format conversion, resizing for AI |
| **AI Vision Provider** | Not present | `@google/genai` (Gemini Flash class) | `VisionProvider` interface + `GeminiVisionProvider` implementation |
| **AI Embedding Provider** | Not present | `openai` (`text-embedding-3-small`) | `EmbeddingProvider` interface + `OpenAiEmbeddingProvider` implementation |
| **Logging & Metrics** | Default NestJS Logger | Custom structured logging decorator/interceptor | Structured JSON logging with `job_id`, `asset_id`, `stage`, `sqs_message_id`, latency, retry tracking |

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
| **TASK-014** | PGVector Vector Indexing & Similarity Search | **TODO** | TASK-003, TASK-013 | Implement `VectorStorageService` storing 1536-dim vectors in PGVector, execute cosine similarity search queries. | Vector search returns top-k nearest assets by cosine distance. |
| **TASK-015** | Semantic Search API & Metadata Filtering | **TODO** | TASK-014 | Implement `SearchController` & `SearchService` supporting text search + hybrid filters (category, orientation, color, etc.). | Combined semantic + metadata filtered search results returned correctly. |
| **TASK-016** | Redis Caching Layer for Search | **TODO** | TASK-004, TASK-015 | Implement `RedisCacheService` for caching search results & hot asset metadata with TTL. | Search response cached in Redis, cache bypass on flush works seamlessly. |
| **TASK-017** | State Machine Pipeline, Retry Strategy & DLQ Handling | **TODO** | TASK-010 | Implement complete asset state machine (`DISCOVERED` -> `COMPLETED`), exponential backoff, DLQ capture & replay. | Retry logic handles transient failures, non-retryable move to DLQ. |
| **TASK-018** | Observability, Structured Logging & Metrics | **TODO** | TASK-017 | Implement logging interceptors, job progress metrics, latency metrics, and failure tracing. | Logs contain trace identifiers (`job_id`, `asset_id`, `stage`, `sqs_message_id`). |
| **TASK-019** | Integration & End-to-End Suite | **TODO** | TASK-001..18 | Write unit, integration, and E2E pipeline tests from Drive discovery to Search API response. | Full E2E test passes in test environment. |
| **TASK-020** | Pilot Migration & Execution Protocol | **TODO** | TASK-019 | Execute pilot migration in batches (10 -> 100 -> 1000 images), generate cost, performance & quality reports. | Pilot report generated with metrics before full 10,000+ run. |

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

### Next Immediate Task: TASK-014 — PGVector Vector Indexing & Similarity Search
* **Dependencies**: `TASK-003`, `TASK-013`
* **Goal**: Implement `VectorStorageService` storing 1536-dim vectors in PGVector and execute cosine similarity search queries.
