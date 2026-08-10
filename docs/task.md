# AI Asset Ingestion & Semantic Image Retrieval System

## Master Implementation Prompt — NestJS Backend

You are the lead backend engineer responsible for implementing an **AI-powered image asset ingestion and semantic retrieval system** inside an existing NestJS backend.

The system will ingest image assets from Google Drive folders, process and analyze them, store canonical copies in S3, generate structured AI metadata, generate text embeddings from searchable descriptions, store everything in PostgreSQL using Prisma and PGVector, and expose semantic search capabilities.

The system must be designed to support:

1. A one-time migration of an initial library of 10,000+ images.
2. Future ingestion of additional Google Drive folders.
3. Safe retries and resumability.
4. Idempotent processing.
5. Duplicate detection.
6. Failure handling and dead-letter processing.
7. AI provider failures and rate limits.
8. S3 upload failures.
9. Google Drive API failures.
10. PostgreSQL transaction failures.
11. Embedding generation failures.
12. Future scaling to significantly larger asset libraries.
13. Future support for additional asset sources beyond Google Drive.
14. Semantic text-to-image retrieval.
15. Hybrid retrieval using semantic similarity plus metadata filtering.
16. Future reranking capabilities.

---

# 1. Existing Technology Stack

The backend is built with:

* NestJS
* TypeScript
* PostgreSQL
* Prisma ORM

Assume that these technologies are already configured or available in the existing project.

Do NOT introduce another queue system such as BullMQ unless explicitly requested.

Do NOT introduce another database unless explicitly requested.

Do NOT introduce a dedicated vector database such as Qdrant or Pinecone at this stage.

Will Using:
* PGVector
* Redis
* Amazon SQS
* Amazon S3

Use:

* SQS for asynchronous job processing.
* Redis for caching and short-lived state where appropriate.
* PostgreSQL as the source of truth.
* Prisma for relational database access.
* PGVector for vector similarity search.
* S3 as canonical image storage.

---

# 2. Core Architectural Principle

The system must separate:

```text
Source Asset
    ↓
Canonical Storage
    ↓
AI Processing
    ↓
Search Indexing
    ↓
Retrieval
```

Google Drive is an ingestion source.

S3 is the canonical storage location.

PostgreSQL is the system of record.

PGVector stores semantic embeddings.

Redis is used for caching and performance optimization.

SQS manages asynchronous processing.

The system must never depend on Google Drive being available after an asset has been successfully copied to S3.

Once an asset is successfully stored in S3, all future processing should use the S3 object.

---

# 3. High-Level Architecture

Implement the system conceptually as:

```text
Google Drive
     │
     ▼
Drive Ingestion
     │
     ▼
Ingestion Job
     │
     ▼
Asset Discovery
     │
     ▼
PostgreSQL
     │
     ▼
SQS
     │
     ▼
Asset Processing
     │
     ├── Download
     ├── Validate
     ├── Hash
     ├── Duplicate Detection
     │
     ▼
S3 Upload
     │
     ▼
AI Vision Processing
     │
     ▼
Structured Metadata
     │
     ▼
Search Description
     │
     ▼
Text Embedding
     │
     ▼
PGVector
     │
     ▼
PostgreSQL
     │
     ▼
Asset Available for Search
```

Search flow:

```text
User Query
    │
    ▼
Query Normalization
    │
    ▼
Query Embedding
    │
    ▼
PGVector Similarity Search
    │
    ▼
Metadata Filtering
    │
    ▼
Candidate Ranking
    │
    ▼
Redis Cache
    │
    ▼
Results
```

---

# 4. AI Provider Architecture

Do not tightly couple the ingestion pipeline to a specific AI provider.

Implement provider abstractions/interfaces.

For vision metadata generation, support a provider interface conceptually equivalent to:

```typescript
VisionProvider
```

For embeddings:

```typescript
EmbeddingProvider
```

The initial implementations will use:

* Gemini Flash-class multimodal model for image metadata generation.
* OpenAI text-embedding-3-small for text embeddings.

Do not hard-code the AI provider logic throughout the application.

The application should be able to replace:

```text
Gemini
```

with:

```text
Another Vision Provider
```

without rewriting the ingestion pipeline.

Likewise, embedding generation must be replaceable without rewriting asset ingestion.

Store provider and model information with AI-generated records.

Example:

```text
provider
model
model_version
prompt_version
```

This is required for future reprocessing and model migrations.

---

# 5. Asset Processing Pipeline

The processing pipeline must be stateful and resumable.

Recommended lifecycle:

```text
DISCOVERED
    ↓
DOWNLOADING
    ↓
VALIDATING
    ↓
HASHING
    ↓
DUPLICATE_CHECK
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
EMBEDDING_GENERATED
    ↓
COMPLETED
```

Failure states must be represented separately.

For example:

```text
FAILED
RETRY_PENDING
DEAD_LETTER
```

Do not use one generic status without tracking the processing stage.

The system must always know:

```text
What was the last successful step?
What step failed?
How many attempts were made?
Why did it fail?
Can it be retried?
```

---

# 6. Idempotency Requirements

Every processing stage must be idempotent.

The system must safely handle:

```text
Same SQS message delivered twice
Worker crashes after S3 upload
Worker crashes after metadata generation
Worker crashes after embedding generation
Database transaction succeeds but acknowledgement fails
S3 upload succeeds but database update fails
```

SQS messages may be delivered more than once.

Therefore, assume at-least-once delivery.

Never assume exactly-once processing.

Use deterministic identifiers and database constraints.

Use:

```text
content_hash
```

to detect duplicate image content.

Use unique constraints wherever appropriate.

Never generate duplicate assets because the same message was processed twice.

Never generate duplicate embeddings for the same asset/version.

---

# 7. Duplicate Detection

The system must calculate a SHA-256 hash for each valid image.

The hash must be used to identify identical files.

If the image already exists:

```text
content_hash = existing hash
```

do not:

* Upload another copy to S3.
* Call the vision model again.
* Generate another embedding.

Instead, associate the new source reference with the existing asset.

This is important because the same image may exist in:

```text
Drive Folder A
Drive Folder B
Drive Folder C
```

The canonical asset should exist only once in S3.

---

# 8. Storage Model

S3 is the canonical image storage.

Do not use the Google Drive URL as the permanent asset URL.

Store S3 object references such as:

```text
storage_provider
bucket
object_key
```

Prefer storing the object key instead of permanently storing a hard-coded public URL.

The object key should be deterministic or derived from the immutable asset ID.

Example conceptual structure:

```text
assets/{assetId}/original/{filename}
```

Do not use the Google Drive filename as the primary identifier.

Filenames can collide.

Asset IDs must be unique.

---

# 9. Image Processing

Before sending images to the vision model:

1. Validate the actual file type.
2. Validate file size.
3. Validate image dimensions.
4. Detect corrupted images.
5. Calculate SHA-256.
6. Generate an AI-optimized image representation if necessary.

Use an image processing library such as Sharp where appropriate.

Keep:

```text
Original image
```

for S3 storage.

Use:

```text
Resized/optimized representation
```

for AI processing when appropriate.

Do not overwrite the original.

---

# 10. Vision Metadata

The vision model must return structured JSON.

Do not request long natural-language descriptions.

The metadata should be optimized for search and retrieval.

The schema should conceptually contain:

```json
{
  "caption": "...",
  "objects": [],
  "actions": [],
  "styles": [],
  "colors": [],
  "background": "...",
  "composition": "...",
  "orientation": "...",
  "age_groups": [],
  "educational_uses": [],
  "search_keywords": []
}
```

The exact schema must be designed during the implementation phase.

The metadata must be:

* Concise.
* Search-oriented.
* Deterministic where possible.
* Structured.
* Versioned.

Store the raw AI response for debugging and reprocessing when appropriate.

---

# 11. Search Description

Generate a canonical textual search description from the structured metadata.

Example:

```text
Cute cartoon elephant holding a red balloon.
Single animal character.
Children's illustration.
Gray elephant.
Red balloon.
White background.
Suitable for preschool and kindergarten worksheets.
```

This search description is the input to the embedding model.

Do not generate multiple embeddings initially.

Create one canonical search description per asset.

---

# 12. Embedding

Use the same embedding model for:

```text
Asset search descriptions
```

and:

```text
User search queries
```

Initial embedding model:

```text
OpenAI text-embedding-3-small
```

The embedding record must store:

```text
asset_id
embedding
provider
model
dimensions
source_text_hash
created_at
```

The `source_text_hash` must allow the system to determine whether the embedding is still valid.

If:

```text
search_description changes
```

then:

```text
source_text_hash changes
```

and the embedding must be regenerated.

---

# 13. Versioning

The system must support versioning.

Track at least:

```text
metadata_version
embedding_version
prompt_version
vision_provider
vision_model
embedding_provider
embedding_model
```

The system must allow future reprocessing such as:

```text
Reprocess all assets with metadata_version = 1
```

or:

```text
Regenerate embeddings using a newer model
```

Do not require re-uploading the original image to S3 for metadata or embedding regeneration.

---

# 14. PostgreSQL Data Model

Design the Prisma schema around these conceptual entities:

```text
IngestionJob
IngestionFile
Asset
AssetSource
AssetMetadata
AssetEmbedding
ProcessingAttempt
```

Potential relationships:

```text
IngestionJob
    │
    └── IngestionFile
            │
            └── AssetSource
                    │
                    ▼
                  Asset
                 /     \
                /       \
               ▼         ▼
        AssetMetadata  AssetEmbedding
```

The system must distinguish:

```text
Asset
```

from:

```text
AssetSource
```

because one asset may originate from multiple Drive files/folders.

Example:

```text
Asset
  asset_id = 123
  content_hash = ABC

AssetSource 1
  drive_file_id = X
  folder = Animals

AssetSource 2
  drive_file_id = Y
  folder = Preschool Animals
```

Both sources point to the same canonical asset.

---

# 15. Ingestion Jobs

An ingestion job represents one user/system request to ingest a Drive folder.

Example:

```text
POST /asset-ingestion/jobs
```

Conceptually:

```json
{
  "sourceType": "GOOGLE_DRIVE",
  "rootFolderId": "..."
}
```

The job must track:

```text
total discovered
total processed
total successful
total skipped
total failed
total duplicate
```

The job must have a lifecycle:

```text
CREATED
SCANNING
PROCESSING
COMPLETED
COMPLETED_WITH_ERRORS
FAILED
CANCELLED
```

The system must support resuming incomplete ingestion jobs.

---

# 16. SQS Architecture

Use SQS for asynchronous processing.

Do not put the entire processing operation into a single long-running SQS message.

Use stage-specific messages where appropriate.

Conceptually:

```text
Drive Scan
    ↓
Asset Processing Queue
    ↓
S3 Upload Queue
    ↓
AI Metadata Queue
    ↓
Embedding Queue
    ↓
Finalization
```

The exact queue topology should be designed based on the existing infrastructure.

Every message should contain minimal identifiers.

Prefer:

```json
{
  "assetId": "...",
  "ingestionFileId": "..."
}
```

instead of sending large image payloads through SQS.

Never send binary image data through SQS.

---

# 17. Failure Handling

Classify failures into:

## Retryable

Examples:

```text
HTTP 429
HTTP 500
HTTP 502
HTTP 503
HTTP 504
Network timeout
Connection reset
Temporary database connection failure
Temporary S3 failure
Temporary AI provider outage
```

Use exponential backoff with jitter.

## Non-retryable

Examples:

```text
Unsupported file format
Corrupted image
Permanent permission denied
Invalid credentials
Deleted Drive file
Invalid request
Invalid image content
```

Do not retry these indefinitely.

---

# 18. Dead Letter Handling

Every SQS processing queue must have a dead-letter queue strategy.

When the maximum retry count is reached:

```text
Main Queue
    ↓
Retry
    ↓
Retry
    ↓
Retry
    ↓
DLQ
```

Store enough information to investigate:

```text
asset_id
ingestion_file_id
job_id
processing_stage
error_code
error_message
attempt_count
last_attempt_at
```

The system must support manually replaying a DLQ message after the underlying problem is fixed.

---

# 19. Database Transactions

Be careful with external side effects.

Do not assume PostgreSQL transactions can atomically include:

```text
S3
AI API
SQS
```

They cannot.

Use explicit state transitions.

Example:

```text
S3 upload succeeds
    ↓
DB update fails
    ↓
Retry
    ↓
Check if S3 object already exists
    ↓
Do not upload unnecessarily
    ↓
Update DB
```

The system must be designed around eventual consistency between external services.

---

# 20. Search Architecture

Initial search should support:

```text
Text Query
    ↓
Query Embedding
    ↓
PGVector
    ↓
Top K Candidates
    ↓
Metadata Filters
    ↓
Ranking
```

Support future filters such as:

```text
category
style
age_group
orientation
background
color
object
action
```

Do not implement OpenSearch or Elasticsearch yet unless explicitly requested.

Do not implement a dedicated reranking model initially.

Keep the first retrieval version simple.

---

# 21. Redis Usage

Redis should not be the source of truth.

Use Redis for:

```text
Hot search result caching
Frequently requested asset metadata
Potential query result caching
Short-lived locks where appropriate
```

Do not store the only copy of an asset or metadata in Redis.

The system must continue functioning correctly if Redis is flushed.

---

# 22. Security

Follow these requirements:

* Never expose AWS credentials.
* Never expose Google Drive credentials.
* Never store API keys in source code.
* Use environment variables/secrets management.
* Validate all external inputs.
* Use least-privilege IAM permissions.
* Use private S3 buckets by default.
* Generate signed URLs or CDN URLs when appropriate.
* Do not expose internal S3 object keys unnecessarily.

---

# 23. Observability

Every processing operation must be traceable.

Use structured logs containing:

```text
job_id
ingestion_file_id
asset_id
processing_stage
sqs_message_id
attempt
provider
model
duration
status
error_code
```

Track metrics:

```text
Images discovered
Images processed
Images successful
Images failed
Duplicates
AI metadata latency
Embedding latency
S3 upload latency
Drive download latency
Retry count
DLQ count
```

The implementation should make it easy to answer:

```text
Why did this asset fail?
Where did it fail?
How many times was it retried?
Can it be retried?
What is the current state?
```

---

# 24. Implementation Rules

IMPORTANT:

Do not implement the entire system in one step.

Work incrementally.

Before writing code:

1. Inspect the existing repository.
2. Understand the existing NestJS module structure.
3. Identify existing Prisma schema conventions.
4. Identify existing SQS abstractions.
5. Identify existing S3 abstractions.
6. Identify existing Redis abstractions.
7. Identify existing configuration/environment patterns.
8. Identify existing logging and error-handling conventions.
9. Identify existing authentication/authorization patterns.

Do not duplicate infrastructure that already exists.

Reuse existing abstractions where appropriate.

Do not make unrelated refactors.

Do not change existing behavior outside this feature.

---

# 25. Task Execution Protocol

You must work using explicit tasks.

Maintain a task tracker in the project documentation.

Create:

```text
docs/asset-ingestion/IMPLEMENTATION_PLAN.md
```

The plan must contain:

```text
Task ID
Task Name
Status
Dependencies
Description
Acceptance Criteria
Files Changed
Notes
```

Use statuses:

```text
TODO
IN_PROGRESS
BLOCKED
COMPLETED
SKIPPED
```

Initial task groups:

```text
PHASE 0 — Repository Discovery
PHASE 1 — Architecture & Data Model
PHASE 2 — Prisma Schema
PHASE 3 — S3 Asset Storage
PHASE 4 — Google Drive Source Adapter
PHASE 5 — Ingestion Job & Discovery
PHASE 6 — Image Validation & Hashing
PHASE 7 — Duplicate Detection
PHASE 8 — SQS Processing Pipeline
PHASE 9 — AI Vision Provider
PHASE 10 — Metadata Generation
PHASE 11 — Embedding Provider
PHASE 12 — PGVector Storage
PHASE 13 — Search API
PHASE 14 — Redis Caching
PHASE 15 — Retry & DLQ Handling
PHASE 16 — Observability
PHASE 17 — Testing
PHASE 18 — Pilot Migration
PHASE 19 — Production Migration
```

---

# 26. Critical Task Execution Rule

You must NOT implement all phases at once.

Start with:

```text
PHASE 0 — Repository Discovery
```

Your first response should only:

1. Inspect the repository.
2. Identify existing relevant modules.
3. Identify existing infrastructure.
4. Identify gaps.
5. Create/update `IMPLEMENTATION_PLAN.md`.
6. Propose the detailed task breakdown.
7. Do not implement production code yet.

After Phase 0 is completed, report:

```text
Phase 0 completed.

Repository findings:
...

Existing infrastructure:
...

Required changes:
...

Risks:
...

Next task:
TASK-XXX
...
```

Then wait for approval before proceeding to the next task.

---

# 27. Definition of Done

A task is only `COMPLETED` when:

* Implementation is complete.
* Relevant tests are added.
* Existing tests still pass.
* TypeScript compilation passes.
* Linting passes where applicable.
* Database migrations are valid where applicable.
* Error handling is implemented.
* Logging is implemented where appropriate.
* Documentation is updated.
* Task tracker is updated.

Do not mark tasks complete merely because code was written.

---

# 28. Testing Requirements

The implementation must eventually include:

### Unit tests

For:

```text
Hashing
Metadata parsing
AI response validation
State transitions
Duplicate detection
Retry classification
Embedding generation
```

### Integration tests

For:

```text
PostgreSQL
Prisma
PGVector
S3
SQS
```

Use mocks/local infrastructure where appropriate.

### End-to-end test

The final E2E flow should verify:

```text
Drive folder
    ↓
Discovery
    ↓
Asset record
    ↓
Download
    ↓
Hash
    ↓
S3
    ↓
Vision metadata
    ↓
Embedding
    ↓
PostgreSQL
    ↓
PGVector
    ↓
Search
    ↓
Correct asset returned
```

---

# 29. Pilot Migration

Before processing all 10,000+ images, implement a pilot mode.

The pilot should process:

```text
10 images
```

Then:

```text
100 images
```

Then:

```text
1,000 images
```

Only after validation should the full migration run.

The pilot must report:

```text
Total images
Success rate
Duplicate rate
Vision failures
Embedding failures
Average processing time
Average AI cost
S3 storage
Search quality
```

The pilot should allow manual inspection of generated metadata.

Do not process the entire asset library until the pilot results are reviewed.

---

# 30. Important Cost Control

The system must avoid unnecessary AI calls.

Before AI processing:

```text
Validate
→ Hash
→ Duplicate check
```

If duplicate:

```text
Skip AI
Skip embedding
Skip S3 upload
```

If metadata already exists for the same:

```text
content_hash
+
metadata_version
+
prompt_version
```

do not regenerate metadata.

If embedding already exists for the same:

```text
search_description_hash
+
embedding_model
```

do not regenerate the embedding.

This is mandatory.

---

# 31. First Task

Start now with:

## TASK-001 — Repository Discovery & Existing Infrastructure Audit

Do not write production implementation code.

Inspect the repository and document:

1. NestJS modules.
2. Existing Prisma models.
3. Existing SQS implementation.
4. Existing S3 implementation.
5. Existing Redis implementation.
6. Existing authentication.
7. Existing configuration management.
8. Existing logging.
9. Existing error handling.
10. Existing testing infrastructure.
11. Existing PGVector setup.
12. Existing AI integrations, if any.

Then create/update:

```text
docs/asset-ingestion/IMPLEMENTATION_PLAN.md
```

Document:

* Current architecture.
* Relevant existing modules.
* Reusable components.
* Missing components.
* Potential conflicts.
* Recommended implementation order.
* Detailed task list.

Do not make unrelated changes.

Do not implement the ingestion pipeline yet.

When finished, report the findings and identify the next task.

Wait for explicit approval before proceeding.
