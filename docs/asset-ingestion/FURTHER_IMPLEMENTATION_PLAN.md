# Phase 20+ — Component Validation, Enhancements & Manual Integration Validation

> **Note (2026-07-30):** Consolidated into `IMPLEMENTATION_PLAN.md` Phase 2 — reference only. Use `IMPLEMENTATION_PLAN.md` as the single execution document and `COMPONENT_VALIDATION_REPORT.md` for validation tracking.

## Purpose

Before running the full asset-ingestion pipeline against the real image dataset, every infrastructure and application module must be independently testable.

The implementation process must follow this order:

```text
Existing Implementation
        ↓
Module-Level Testability
        ↓
Production Gaps / Enhancements / Bug Fixes
        ↓
Developer Verification
        ↓
Manual Component Validation
        ↓
Full Integration Validation
        ↓
Pilot Migration
        ↓
Production Migration
```

The objective of this phase is NOT to immediately process the full image dataset.

The objective is to ensure that each individual component can be independently exercised, observed, validated, and debugged before combining all components.

---

# Important Execution Rule

The coding agent must work on **one task at a time**.

For every task:

1. Inspect the current implementation.
2. Identify what already exists.
3. Make only the changes required for the current task.
4. Add/update automated tests where appropriate.
5. Add a dedicated manual validation procedure if the task interacts with real external infrastructure.
6. Update `IMPLEMENTATION_PLAN.md`.
7. Run relevant automated tests.
8. Run `npm run build`.
9. Report:

   * What changed.
   * Files changed.
   * Tests added/updated.
   * Automated test results.
   * Manual validation steps.
   * Known limitations.
   * Next task.

Do not automatically proceed to the next task.

Do not run expensive or destructive real-service operations unless explicitly instructed.

Do not process the complete Google Drive dataset during this phase.

---

# Phase 20 — Component Testability & Validation Harness

## Objective

Before validating individual modules, ensure every major module can be exercised independently without requiring the complete pipeline.

The system must provide a clear way to test each component independently.

The following components must have separate validation procedures:

```text
Google Drive
Image Processing
Duplicate Detection
S3 Storage
Gemini Vision
Metadata Persistence
OpenAI Embeddings
PGVector
Semantic Search
Metadata Filtering
Redis Cache
SQS
Retry
DLQ
DLQ Replay
State Management
Idempotency
Observability
```

## Requirements

Create a reusable validation/test structure.

Recommended structure:

```text
test/
├── unit/
│
├── component/
│   ├── drive/
│   ├── image/
│   ├── duplicate/
│   ├── s3/
│   ├── vision/
│   ├── metadata/
│   ├── embedding/
│   ├── vector/
│   ├── search/
│   ├── cache/
│   ├── sqs/
│   ├── retry/
│   ├── dlq/
│   └── observability/
│
├── integration/
│
└── support/
    ├── fixtures/
    ├── helpers/
    └── test-data/
```

The exact directory structure may follow existing repository conventions, but the separation between unit, component, and integration testing must remain clear.

---

# Component Validation Principles

Each component must be independently testable.

A component test should answer:

```text
Can this component communicate with its real dependency?

Does it produce the expected output?

Does it handle expected failures?

Can it be safely retried?

Can it be observed?

Can it be run without executing the complete asset pipeline?
```

For external services, distinguish clearly between:

### Automated tests

Use mocks/fakes where appropriate.

These should be safe to run repeatedly.

### Manual real-service validation

Use actual:

* Google Drive
* S3
* PostgreSQL/PGVector
* Redis
* Gemini
* OpenAI
* SQS

These tests must be explicitly documented and manually executed.

The application must never require real AI/API calls for the normal unit-test suite.

---

# Phase 21 — SQS Worker Runtime Enhancement

## Objective

Ensure SQS queues are actually consumed by long-running workers.

Current implementation contains:

```text
AssetPipelineService.processQueueMessage()
```

but the project currently does not have a complete long-running SQS consumer runtime.

Implement the missing worker infrastructure.

Expected flow:

```text
SQS Queue
    ↓
Worker Poller
    ↓
ReceiveMessage
    ↓
Validate Message
    ↓
processQueueMessage()
    ↓
Success
    ↓
DeleteMessage
```

Failure:

```text
Worker
   ↓
processQueueMessage()
   ↓
Failure
   ↓
Retry / visibility handling
   ↓
DLQ after maximum attempts
```

## Requirements

The worker system must:

* Poll SQS continuously.
* Support long polling.
* Process messages asynchronously.
* Support configurable concurrency.
* Delete messages only after successful processing.
* Never delete a failed message prematurely.
* Handle malformed messages safely.
* Respect SQS visibility timeout.
* Support graceful shutdown.
* Stop polling during shutdown.
* Finish/invalidate active work according to the configured shutdown strategy.
* Log message processing.
* Include `jobId`, `assetId`, `ingestionFileId`, stage, and message ID in logs where available.

Worker concurrency must be configurable through environment/configuration.

Do not hard-code worker counts.

## Acceptance Criteria

```text
Worker starts successfully.
Worker consumes a real SQS message.
Successful processing deletes the message.
Failed processing does not incorrectly acknowledge the message.
Multiple messages can be processed.
Worker can shut down gracefully.
Worker can restart without corrupting pipeline state.
```

---

# Phase 22 — Google Drive Component Validation

## Objective

Provide an isolated way to validate Google Drive collection without executing the downstream asset pipeline.

Validation flow:

```text
Google Drive Folder
       ↓
GoogleDriveAdapterService
       ↓
File Discovery Result
```

Test manually with a controlled Drive folder.

Validate:

* Authentication.
* Folder access.
* File listing.
* Pagination.
* Nested folders if supported.
* Image filtering.
* Unsupported file filtering.
* Empty folders.
* Permission failures.
* Missing/deleted files.
* Duplicate Drive file IDs.
* File metadata extraction.

The test must not automatically upload images to S3 or call AI services.

Produce a clear discovery result containing:

```text
folder ID
files discovered
image files
ignored files
failed files
nested folders
pagination information
```

---

# Phase 23 — Image Processing Component Validation

## Objective

Validate `ImageProcessorService` independently.

Input:

```text
Local test image
```

Expected flow:

```text
Image
 ↓
Validation
 ↓
Metadata extraction
 ↓
SHA-256
 ↓
AI-compatible resize/optimization
```

Validate:

* Valid image.
* Invalid image.
* Corrupted image.
* Unsupported format.
* Oversized image.
* Very small image.
* Large dimensions.
* SHA-256 consistency.
* Resized output.
* Original image preservation.

The component must not require S3, Gemini, OpenAI, or SQS for this validation.

---

# Phase 24 — Duplicate Detection Component Validation

## Objective

Validate content-based duplicate detection independently.

Test:

```text
Same image
Different filename
Different Drive folder
Different source reference
```

Expected:

```text
Same SHA-256
      ↓
Same canonical Asset
```

Verify that duplicate assets do not cause:

* Additional S3 objects.
* Additional Gemini calls.
* Additional embedding calls.

The system must still preserve the separate source references where appropriate.

---

# Phase 25 — S3 Component Validation

## Objective

Validate `S3StorageService` independently.

Test:

```text
Local image
    ↓
S3StorageService
    ↓
S3
```

Validate:

* Upload.
* Object existence.
* Object metadata.
* Content type.
* Object key generation.
* Download.
* Head/exists operation.
* Idempotent behavior.
* Upload failure handling.
* Permission failure handling.

The manual test must use a controlled test object/prefix.

Do not allow component validation to accidentally overwrite production assets.

---

# Phase 26 — Gemini Vision Component Validation

## Objective

Validate `GeminiVisionProvider` independently using real images.

Input:

```text
Known test image
```

Output:

```text
Structured metadata
```

Validate:

* Authentication.
* Correct model.
* Prompt version.
* Structured response.
* DTO/schema validation.
* Invalid response handling.
* Empty response.
* Provider timeout.
* Rate limiting.
* Provider errors.

Record:

```text
model
prompt version
latency
input usage where available
output usage where available
estimated cost
metadata result
```

Manual validation should include a small curated set of representative images.

Do not process the complete asset library.

---

# Phase 27 — Metadata Persistence Component Validation

## Objective

Validate that generated metadata can be persisted independently.

Test:

```text
Known Asset
+
Known Metadata
      ↓
AssetMetadata
      ↓
PostgreSQL
```

Validate:

* Correct Asset relationship.
* Provider.
* Model.
* Prompt version.
* Metadata version.
* JSON persistence.
* Timestamps.
* Reprocessing behavior.
* Duplicate/version handling.

---

# Phase 28 — OpenAI Embedding Component Validation

## Objective

Validate `OpenAiEmbeddingProvider` independently.

Input:

```text
"Cute cartoon elephant holding a red balloon"
```

Expected:

```text
1536-dimensional vector
```

Validate:

* Authentication.
* Correct model.
* Correct dimensions.
* Empty input behavior.
* API failures.
* Rate limits.
* Timeout.
* Token usage.
* Model information.

The embedding component must not depend on LangChain.

Do not implement chunking.

For this system:

```text
One asset
    ↓
One canonical searchable description
    ↓
One embedding
```

User query:

```text
One query
    ↓
One query embedding
```

The same embedding model must be used for asset descriptions and search queries.

---

# Phase 29 — PGVector Component Validation

## Objective

Validate vector storage independently.

Test:

```text
Known Asset
+
Known Embedding
      ↓
PostgreSQL / PGVector
```

Validate:

* Insert.
* Correct vector dimensions.
* Asset relationship.
* Model.
* Source text.
* Source text hash.
* Similarity query.
* Ordering by similarity.
* Invalid vector dimensions.

Also benchmark basic vector search latency.

Do not prematurely optimize based only on assumptions.

HNSW should be introduced after measuring actual search performance and dataset size requirements.

---

# Phase 30 — Semantic Search Component Validation

## Objective

Validate the complete search module without executing image ingestion.

Prepare a small known dataset.

Example:

```text
Asset A:
"cartoon elephant holding a red balloon"

Asset B:
"cartoon dog playing with a ball"

Asset C:
"red apple illustration"

Asset D:
"elephant standing in a jungle"
```

Test queries such as:

```text
"elephant with balloon"
"cartoon animal"
"red fruit"
"elephant"
```

Validate:

* Query embedding.
* PGVector similarity.
* Ranking.
* Top K.
* Similarity score.
* Empty results.
* Natural-language queries.
* Different wording.

Document manually whether the returned results are semantically relevant.

---

# Phase 31 — Metadata Filtering Validation

Validate:

```text
Semantic Query
+
Metadata Filters
```

Test filters such as:

```text
object
style
age group
color
orientation
background
educational use
```

Verify that:

1. Semantic similarity still works.
2. Filters are actually applied.
3. Results outside the filters are not returned.
4. Empty filtered results are handled correctly.

---

# Phase 32 — Redis Cache Component Validation

## Objective

Validate cache behavior independently.

First request:

```text
Search
 ↓
Redis MISS
 ↓
Database / PGVector
 ↓
Result
 ↓
Redis SET
```

Second identical request:

```text
Search
 ↓
Redis HIT
 ↓
Result
```

Validate:

* Cache key generation.
* Cache miss.
* Cache hit.
* TTL.
* Serialization/deserialization.
* Cache invalidation.
* Cache flush.
* Redis unavailable behavior.

Important requirement:

Redis must never be the source of truth.

If Redis is unavailable:

```text
Redis failure
     ↓
Continue using PostgreSQL / PGVector
```

wherever the existing architecture permits.

---

# Phase 33 — SQS Retry Validation

Use controlled failures.

Test:

```text
Retryable error
    ↓
Attempt 1
    ↓
Backoff
    ↓
Attempt 2
    ↓
Backoff
    ↓
Attempt 3
```

Validate:

* Retry classification.
* Attempt count.
* Exponential backoff.
* Jitter.
* Maximum attempts.
* State transition.
* Logging.
* Metrics.

Do not rely only on unit tests. Provide a manual procedure using a controlled test message.

---

# Phase 34 — DLQ Validation

## Objective

Validate that permanently failing messages eventually reach the DLQ.

Test:

```text
Queue
 ↓
Worker
 ↓
Permanent failure
 ↓
Retry
 ↓
Retry
 ↓
Retry
 ↓
DLQ
```

Validate DLQ message contents include sufficient information to identify:

```text
message ID
job ID
asset ID
ingestion file ID
processing stage
attempt count
error code
error message
timestamp
```

The DLQ must prevent one bad asset from blocking the rest of the pipeline.

---

# Phase 35 — DLQ Replay Validation

Validate:

```text
DLQ
 ↓
POST /pipeline/dlq/replay
 ↓
Original Stage Queue
 ↓
Worker
 ↓
Successful processing
```

Verify that replay:

* Sends the message to the correct original queue.
* Does not lose the original asset/job identifiers.
* Preserves required processing context.
* Does not create duplicate assets.
* Does not unnecessarily regenerate already completed stages.
* Is properly logged.

The replay endpoint must eventually be protected by authentication/authorization and treated as an administrative operation.

Do not expose unrestricted DLQ replay to normal users.

---

# Phase 36 — State Transition Validation

Validate every pipeline state independently.

Expected lifecycle:

```text
DISCOVERED
    ↓
DOWNLOADING
    ↓
VALIDATING
    ↓
HASHING
    ↓
UPLOADING_TO_S3
    ↓
STORED_IN_S3
    ↓
GENERATING_METADATA
    ↓
METADATA_GENERATED
    ↓
GENERATING_EMBEDDING
    ↓
COMPLETED
```

Validate failure states and retries.

Important:

If embedding generation fails after metadata succeeds:

```text
METADATA_GENERATED
       ↓
Embedding failure
       ↓
Retry embedding
```

Do not regenerate metadata unnecessarily.

The state machine must allow processing to resume from the appropriate stage.

---

# Phase 37 — Idempotency Validation

Explicitly test duplicate execution.

Send the same message more than once.

Expected:

```text
Same message
Same asset
Same processing state
No duplicate side effects
```

Verify:

```text
1 canonical Asset
1 canonical S3 object
1 valid metadata version
1 valid embedding
```

where the existing versioning/idempotency rules require it.

Also test worker interruption scenarios:

```text
S3 upload succeeds
 ↓
worker crashes
 ↓
message is delivered again
```

The second attempt must detect the existing state and continue safely.

---

# Phase 38 — Failure Recovery Validation

Validate failure behavior for every external dependency.

## Google Drive

* Timeout.
* Permission error.
* Missing file.

## S3

* Timeout.
* Access denied.
* Upload failure.

## Gemini

* 429.
* 5xx.
* Timeout.
* Invalid response.

## OpenAI

* 429.
* 5xx.
* Timeout.

## PostgreSQL

* Temporary connection failure.

## Redis

* Connection failure.

## SQS

* Receive failure.
* Send failure.
* Delete failure.

The goal is to verify that a temporary dependency failure does not corrupt the asset state or permanently stop the entire pipeline.

---

# Phase 39 — Observability Validation

Validate that a single asset can be traced across the complete system.

Logs should make it possible to follow:

```text
jobId
    ↓
ingestionFileId
    ↓
assetId
    ↓
SQS message
    ↓
S3
    ↓
Gemini
    ↓
Metadata
    ↓
OpenAI
    ↓
Embedding
    ↓
PGVector
```

Validate:

* Structured logs.
* Error logs.
* Processing stage.
* Attempt number.
* Provider/model.
* Duration.
* Success/failure.
* Pipeline metrics.
* DLQ metrics.

The objective is:

> Given an `assetId`, an engineer should be able to determine what happened to that asset without manually inspecting unrelated systems.

---

# Phase 40 — Component Validation Report

Create:

```text
docs/asset-ingestion/COMPONENT_VALIDATION_REPORT.md
```

Record the manual validation status of every component.

Recommended format:

| Component           | Validation            | Result  | Notes |
| ------------------- | --------------------- | ------- | ----- |
| Google Drive        | Real folder discovery | PENDING |       |
| Image Processing    | Real image            | PENDING |       |
| Duplicate Detection | Duplicate files       | PENDING |       |
| S3                  | Upload/download       | PENDING |       |
| Gemini              | Real image metadata   | PENDING |       |
| Metadata DB         | Persistence           | PENDING |       |
| OpenAI              | Real embedding        | PENDING |       |
| PGVector            | Similarity search     | PENDING |       |
| Semantic Search     | Real queries          | PENDING |       |
| Metadata Filter     | Filtered search       | PENDING |       |
| Redis               | Miss/hit              | PENDING |       |
| SQS Worker          | Real message          | PENDING |       |
| Retry               | Controlled failure    | PENDING |       |
| DLQ                 | Permanent failure     | PENDING |       |
| DLQ Replay          | Replay                | PENDING |       |
| State Machine       | Transitions           | PENDING |       |
| Idempotency         | Duplicate message     | PENDING |       |
| Observability       | Trace asset           | PENDING |       |

Possible statuses:

```text
PENDING
PASS
PASS_WITH_NOTES
FAIL
BLOCKED
```

The coding agent must not mark real-service validation as `PASS` unless the user has actually performed the validation.

---

# Phase 41 — Manual Validation Execution

After all implementation/enhancement tasks are complete, the user will manually execute the component validation.

The coding agent must provide clear instructions for each test, including:

```text
Purpose
Prerequisites
Required environment variables
Input
Command/API call
Expected result
Where to inspect result
Failure symptoms
Cleanup
```

The user will:

* Provide test assets.
* Provide Drive folders.
* Monitor AWS.
* Monitor PostgreSQL.
* Monitor Redis.
* Monitor Gemini/OpenAI usage.
* Review generated metadata.
* Review search results.
* Review SQS/DLQ behavior.
* Record actual costs and timings.

The coding agent must not assume these manual tests have passed.

---

# Phase 42 — Full Integration Validation

Only after all component-level validations pass should the full real pipeline be tested.

Use a controlled Drive folder containing a small number of real images.

Expected flow:

```text
Google Drive
     ↓
Discovery
     ↓
SQS
     ↓
Worker
     ↓
Download
     ↓
Image Processing
     ↓
Hash
     ↓
Duplicate Detection
     ↓
S3
     ↓
Gemini
     ↓
Metadata
     ↓
OpenAI
     ↓
Embedding
     ↓
PGVector
     ↓
Redis
     ↓
Search
```

Validate the complete lifecycle of each asset.

Do not use the complete 10K+ dataset during this stage.

---

# Phase 43 — Production Readiness Review

Before beginning pilot migration, verify:

## Infrastructure

* [ ] PostgreSQL ready
* [ ] pgvector ready
* [ ] S3 ready
* [ ] SQS queues ready
* [ ] DLQ ready
* [ ] SQS workers ready
* [ ] Redis ready
* [ ] Google Drive credentials ready
* [ ] Gemini credentials ready
* [ ] OpenAI credentials ready

## Pipeline

* [ ] Drive discovery works
* [ ] Image processing works
* [ ] Hashing works
* [ ] Duplicate detection works
* [ ] S3 upload works
* [ ] Metadata generation works
* [ ] Metadata persistence works
* [ ] Embedding generation works
* [ ] PGVector storage works
* [ ] Search works
* [ ] Metadata filtering works
* [ ] Redis cache works

## Reliability

* [ ] Retry works
* [ ] DLQ works
* [ ] DLQ replay works
* [ ] Idempotency works
* [ ] State transitions work
* [ ] Failure recovery works
* [ ] Graceful worker shutdown works

## Observability

* [ ] Structured logs work
* [ ] Metrics work
* [ ] Asset traceability works
* [ ] Failure investigation is possible

## AI Quality

* [ ] Metadata quality manually reviewed
* [ ] Search descriptions are useful
* [ ] Embeddings are generated correctly
* [ ] Semantic search results are relevant
* [ ] AI token usage is measurable
* [ ] AI cost is measurable

Only after this checklist is approved should the project proceed to pilot migration.

---

# Phase 44 — Pilot Migration

Pilot migration is a separate phase and must not begin until the previous component and integration validations have passed.

The pilot will be executed progressively:

```text
10 images
    ↓
100 images
    ↓
1,000 images
    ↓
10,000+ images
```

Each stage must produce:

```text
Success rate
Failure rate
Duplicate rate
Processing throughput
P50/P95 latency
Gemini usage
Gemini cost
OpenAI usage
OpenAI cost
S3 storage
Database growth
Queue behavior
DLQ count
Search quality
```

Do not automatically proceed from one stage to the next.

Review the results before increasing the dataset size.

---

# Task Status Rules

Tasks in this phase must use:

```text
TODO
IN_PROGRESS
BLOCKED
COMPLETED
SKIPPED
```

A task involving implementation can be marked `COMPLETED` only when:

* Code is implemented.
* Automated tests pass.
* Build passes.
* Documentation is updated.
* Manual validation instructions exist where required.

A task involving real external-service validation must NOT be marked `PASS` by the coding agent unless the user explicitly reports that the manual validation succeeded.

---

# Scope Control

During these tasks:

* Do not introduce LangChain.
* Do not introduce another vector database.
* Do not introduce another queue system.
* Do not introduce microservices unless explicitly requested.
* Do not replace PostgreSQL/PGVector.
* Do not redesign working modules without evidence.
* Do not optimize prematurely.
* Do not process the full dataset.
* Do not make unrelated refactors.
* Do not commit changes unless explicitly requested.

The objective is to validate and harden the existing architecture, not continuously redesign it.

---

# Definition of the Validation Architecture

The final testing strategy must remain:

```text
                    ┌─────────────────┐
                    │   Unit Tests    │
                    │ mocked/isolated │
                    └────────┬────────┘
                             ↓
                    ┌─────────────────┐
                    │ Component Tests │
                    │ one module at a │
                    │     time        │
                    └────────┬────────┘
                             ↓
                    ┌─────────────────┐
                    │ Integration     │
                    │ Full real flow  │
                    └────────┬────────┘
                             ↓
                    ┌─────────────────┐
                    │ Pilot Migration │
                    │ 10 → 100 → 1K   │
                    └────────┬────────┘
                             ↓
                    ┌─────────────────┐
                    │ Production      │
                    │ 10K+ Assets     │
                    └─────────────────┘
```

This sequence is mandatory unless a specific technical reason requires changing it.
