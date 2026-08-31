# AI Applications — Session Handoff Context

> **Last updated:** 2026-08-05  
> **Scope:** Asset ingestion (Drive → S3 → AI → search) **and** Flashcard generation (template selection → Gemini content → image retrieval)  
> **Asset ingestion progress:** TASK-001 through TASK-019 **COMPLETED**; Phase 2 TASK-021..025 **COMPLETED**; TASK-026/027 **DOCUMENTED**; Token-saving optimizations **IMPLEMENTED**; **SQS replaced with BullMQ**; DLQ replay hardened  
> **Flashcards progress:** Revised template-driven engine **IMPLEMENTED** (selection, prompt contract, validation, top-1 image retrieval, pipeline stages)  
> **Next (ingestion):** Complete incomplete assets (S3 + AI) after duplicate short-circuit → TASK-026 integration → TASK-027 → **TASK-020 (DEFERRED)**  
> **Next (flashcards):** Seed / configure `TemplateSelectionRule` rows for objective+age coverage; validate live compare/vocabulary cases; optional stage-replay persistence  
> **Test status:** Ingestion unit suite previously green; flashcard focused suites green (selection / prompt / validator / image retrieval / request resolver)

---

## Project Overview

NestJS 11 backend that:

1. **Ingests images** from Google Drive → S3 → Gemini metadata → OpenAI embeddings → PGVector → semantic search
2. **Generates flashcards** by selecting a declarative template, prompting Gemini for template-bound content + image search queries, then retrieving top-1 assets from Search

**Repo:** `D:/AI Team/AI_Applications`

### Core docs

| Area | Doc |
|---|---|
| Ingestion plan | `docs/asset-ingestion/IMPLEMENTATION_PLAN.md` |
| Search / asset API | `docs/asset-ingestion/ASSET_SEARCH.md` |
| Pipeline monitoring | `docs/asset-ingestion/MONITORING_PIPELINE.md` |
| Optimization requirements | `docs/optimization.md` |
| Flashcard design (revised) | `docs/flashcards/FLASH_CARD_REVISED.md` |
| **Flashcard runtime context (use this)** | **`docs/flashcards/FLASHCARD_SELECTION_AND_GENERATION_CONTEXT.md`** |
| Flashcard local computer image | `docs/flashcards/FLASHCARD_LOCAL_IMAGE_UPLOAD.md` |
| Original flashcard design | `docs/flashcards/FLASH_CARD.md` |

**Use `FLASHCARD_SELECTION_AND_GENERATION_CONTEXT.md` as the primary continuation context for flashcard work.** It documents actual selection ranking, the live Gemini prompt, validation, and image retrieval cascade.

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
| Events | `@nestjs/event-emitter` — flashcard / pipeline tracker emits |
| Drive | Google Drive (`googleapis`) |
| Image | Sharp (validation, SHA-256, AI resize) |
| Vision AI | `@google/genai` — Gemini Flash + rate limit + circuit breaker |
| Flashcard content AI | `@google/genai` — Gemini (structured JSON) for educational content only |
| Embeddings | `openai` — `text-embedding-3-small` + rate limit + circuit breaker |
| API docs | Swagger UI at `/api` |
| Testing | Jest (unit + E2E), in-memory harness in `test/support/` |
| Flashcard UI | `public/flashcards.html` |

---

## Module Map

```
src/
├── config/configuration.ts
├── common/
│   ├── events/pipeline-tracker.events.ts   # shared stage/event names
│   └── interfaces/pipeline-messages.interface.ts
├── modules/
│   ├── queue/ … bullmq/                    # ingestion stage queues
│   ├── ingestion/
│   ├── ai/                                 # vision, embedding, usage, rate/circuit
│   ├── search/                             # semantic asset search (used by flashcards)
│   ├── cache/
│   ├── storage/
│   ├── pipeline/                           # AssetPipelineService, DLQ replay
│   ├── observability/
│   ├── pipeline-tracker/                   # flashcard pipeline execution tracker
│   └── flashcards/
│       ├── flashcards.controller.ts        # generate + template upload
│       ├── services/
│       │   ├── flashcard-orchestrator.service.ts
│       │   ├── template-selection.service.ts
│       │   ├── template.repository.ts
│       │   ├── flashcard-content.service.ts
│       │   └── flashcard-image-retrieval.service.ts
│       ├── utils/
│       │   ├── user-request.resolver.ts
│       │   ├── template-selection.engine.ts
│       │   ├── llm-content.validator.ts
│       │   └── template-layout.util.ts
│       └── constants/flashcard-prompt.constants.ts
```

---

## Asset Ingestion Pipeline (BullMQ)

```
Google Drive Scan (metadata-only enumeration)
    ↓
BullMQ: ingestion queue
    ↓  IngestionProcessor → AssetPipelineService
DOWNLOAD once → VALIDATING → HASHING
    ↓
Duplicate (SHA-256)? → AssetSource(linkReason=SHA256_MATCH) → COMPLETED (stops here)
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

**DLQ:** BullMQ `dlq` queue (no processor). Jobs live in Redis (survive Nest restart). DB marks `IngestionFile` / `Asset` as `DEAD_LETTER` and records `ProcessingAttempt`.

**DLQ replay:** `POST /pipeline/dlq/replay`  
Body only needs `{ "ingestionFileId": "..." }`. Service derives `jobId`, `assetId`, and `failedStage` from DB. Optional explicit `failedStage` supported.

**Known gap:** re-ingesting the same Drive folder hashes to an existing `Asset` and short-circuits as duplicate **without** checking whether S3 / metadata / embedding are incomplete.

**Dry-run:** `mode: "DRY_RUN"` — hash/dedup/estimate only; no S3/AI/BullMQ AI path.

---

## Flashcard Generation Pipeline

```
REQUEST_VALIDATION
  → REQUEST_ANALYSIS                  # topic, age, grade, subject, difficulty, language
  → EDUCATIONAL_OBJECTIVE_DETERMINATION  # deterministic keywords (never LLM)
  → TEMPLATE_SELECTION                # age hard-filter + objective ranking
  → LLM_CONTENT_GENERATION
      → PROMPT_GENERATION
      → LLM_REQUEST                    # Gemini structured JSON
      → CONTENT_VALIDATION             # template component IDs only
  → IMAGE_QUERY_GENERATION
  → IMAGE_RETRIEVAL                   # Search Service, limit=1, top similarity
  → RESPONSE_ASSEMBLY
  → FINAL_VALIDATION
  → RESPONSE_RETURN
```

### Selection summary

1. Load active `TemplateSelectionRule`s + active templates without rules (synthetic candidates)
2. Hard-filter by template `supportedAgeGroups` overlapping requested age
3. Rank learning objectives: exact → related → generic fallback
4. Then exact age / grade / subject / difficulty / newer version / rule priority
5. Topic does **not** select templates (content only)

### AI → image retrieval summary

1. Selected template `layoutDefinition` defines exact text + image component IDs
2. Gemini fills only those IDs (`textComponents` + per-slot `imageComponents` search queries)
3. Validator rejects extras / missing required / layout fields
4. Each image component runs independent semantic search with cascade fallbacks
5. Keep **one** top similarity hit (`FLASHCARD_IMAGE_SEARCH_LIMIT=1`)
6. Assemble template-shaped rendering-ready JSON

**Full details (prompts, ranking tables, response shapes):**  
→ `docs/flashcards/FLASHCARD_SELECTION_AND_GENERATION_CONTEXT.md`

### Key flashcard models

- `FlashcardTemplate` — layout + `supportedAgeGroups` + `learningObjectives` + `layoutDefinition`
- `TemplateSelectionRule` — optional ranking/hard filters pointing at a template
- Pipeline tracker tables — observability only (execution / stages / AI / image search)

---

## API Endpoints

### Asset ingestion / search

| Method | Path | Purpose |
|---|---|---|
| POST | `/asset-ingestion/jobs` | Create job (`FULL` \| `DRY_RUN`) |
| GET | `/asset-ingestion/jobs` | List jobs |
| GET | `/asset-ingestion/jobs/:id` | Get job |
| GET | `/asset-ingestion/jobs/:id/estimate` | Cost estimate |
| POST | `/search` | Semantic search |
| POST | `/search/cache/flush` | Flush cache |
| POST | `/pipeline/dlq/replay` | Replay DLQ (`ingestionFileId` required) |
| GET | `/observability/metrics` | In-memory metrics (reset on restart) |
| GET | `/api` | Swagger UI |

### Flashcards

| Method | Path | Purpose |
|---|---|---|
| POST | `/flashcards/generate` | Generate flashcards (`query`, optional `ageGroup`/`grade`/`subject`/`difficulty`/`language`/`count`) |
| POST | `/flashcards/templates` | Upload template(s) |
| GET | `/flashcards/assets/:assetId/image` | Same-origin image proxy for renderer |

UI: `http://localhost:3000/flashcards.html` (served from `public/`)

---

## Recent Live Notes

### Ingestion

- S3 `AccessDenied` on `s3:PutObject` → file went to DLQ on attempt 1.
- After Asset rows exist, re-running the same folder yields `SHA256_MATCH` / `COMPLETED` without finishing missing metadata/embedding.
- `/observability/metrics` `dlqCount` is in-memory only; Redis DLQ + DB `DEAD_LETTER` persist across Nest restarts.

### Flashcards

- Template selection is DB-driven via `FlashcardTemplate` + `TemplateSelectionRule` (plus synthetic candidates for templates without rules).
- Objective inference is keyword-based (`compare` → `comparison`); LLM never chooses templates or intent.
- Hard age filter uses template `supportedAgeGroups`; rule `ageMin`/`ageMax` mainly boost exact-age ranking.
- Prompt version `v4-template-components` binds Gemini output to selected template component IDs.
- Image retrieval uses top-1 semantic match only (no random rotation among top-N).
- Example pitfall fixed earlier: difficulty labels like `easy` vs request `beginner` must alias; selection no longer hard-fails on that mismatch.

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
PIPELINE_TRACKING_ENABLED, PIPELINE_STORE_AI_PAYLOAD, PIPELINE_TRACKING_WORKFLOW_DEFAULT
FLASHCARD_IMAGE_SEARCH_LIMIT=1
FLASHCARD_IMAGE_CONCURRENCY=3
FLASHCARD_SIGNED_URL_TTL_SECONDS
```

**Redis is required** for FULL ingestion (BullMQ). Legacy `SQS_WORKER_*` env names still accepted as fallbacks.

---

## Commands

```bash
npm install
npm run build
npm test
npm run start:dev

# Focused flashcard suites
npx jest --testPathPatterns="flashcard-prompt.constants|llm-content.validator|flashcard-image-retrieval|template-selection.engine|user-request.resolver" --no-coverage

# Queue depth check (Redis required)
npm run validate:queue -- --queue ingestion
```

Swagger: http://localhost:3000/api  
Flashcards UI: http://localhost:3000/flashcards.html  
Compiled entrypoint: `dist/src/main.js`

---

## Conventions

1. Expensive stages stay independently idempotent
2. Discovery remains metadata-only (ingestion)
3. BullMQ payloads — minimal JSON IDs only
4. Prisma 7 — `@generated/prisma/client`
5. `QueueModule` re-exports `BullmqQueueModule` only
6. Flashcards: LLM never selects templates / layout / filenames
7. Flashcards: new layouts should be template + selection-rule config, not orchestrator hardcoding
8. No commits unless explicitly requested

---

## Prompt to Start Next Chat

### Continue flashcards (preferred when working on generate/selection)

```
Continue flashcard work in D:/AI Team/AI_Applications.

Primary context:
- docs/asset-ingestion/HANDOFF_CONTEXT.md
- docs/flashcards/FLASHCARD_SELECTION_AND_GENERATION_CONTEXT.md
- docs/flashcards/FLASH_CARD_REVISED.md

Template selection is age hard-filter + objective ranking (exact → related → generic),
driven by FlashcardTemplate + TemplateSelectionRule (templates without rules still selectable).
Gemini prompt v4 binds to selected template component IDs; image retrieval is top-1 similarity.

Next: configure/seed TemplateSelectionRule coverage for comparison/vocabulary/etc,
validate live requests like "Compare fruits" + age 3-4, then optional stage-replay.
```

### Continue asset ingestion

```
Continue AI Asset Ingestion in D:/AI Team/AI_Applications.

Queue backend is BullMQ (Redis). SQS removed from runtime.
Handoff: docs/asset-ingestion/HANDOFF_CONTEXT.md

Known gap: SHA256 duplicate path marks COMPLETED without finishing
missing S3/metadata/embedding on incomplete assets.

Next: fix incomplete-asset resume on duplicate, then TASK-026/027.
```
