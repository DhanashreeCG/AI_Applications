# AI Applications - KT Guide

## 1. What This Project Does

This project is a NestJS backend for educational AI products. It helps create learning content for children and teachers:

1. It builds an image library from Google Drive.
2. It makes the image library searchable using AI and vector search.
3. It generates flashcards using reusable templates, educational text, and library images.
4. It generates worksheets using reusable templates, educational text, and library images.

The most important idea is that the asset library is shared. Flashcards and worksheets search the existing library for images; they do not normally create new images.

## 2. Technology in Simple Terms

| Technology | Why it is used |
| --- | --- |
| NestJS + Express | HTTP API server and module structure |
| TypeScript | Application language |
| PostgreSQL | Main database and source of truth |
| Prisma 7 | Database access and schema management |
| pgvector | Stores and searches image embeddings |
| Redis | Cache and BullMQ queue backend |
| BullMQ | Background processing for ingestion stages |
| Google Drive API | Reads source images |
| AWS S3 | Stores the canonical image files and rendered output |
| Gemini | Image metadata and educational content generation |
| OpenAI embeddings | Converts text into vectors for semantic search |
| Sharp | Validates, hashes, and resizes images |
| Playwright | Renders HTML into WebP/PDF/images |
| Swagger | API documentation at `/api` |

The default server port is `5000`, unless `PORT` is configured.

## 3. Big Picture

```text
Google Drive
    |
    v
Asset ingestion pipeline
    |
    +--> S3: original image
    +--> Gemini: image metadata
    +--> OpenAI: text embedding
    +--> PostgreSQL + pgvector
    |
    v
Semantic image search
    |
    +--> Flashcard generation
    +--> Worksheet generation

Client request
    |
    v
Select a template -> Ask Gemini for structured content -> Find images -> Return/render content
```

There are three main product flows:

- **Asset ingestion and search:** prepare the reusable image library.
- **Flashcards:** generate cards from a selected layout template.
- **Worksheets:** generate worksheet structures from a selected worksheet template.

## 4. Main Flows

### 4.1 Asset ingestion

A full ingestion job normally works like this:

```text
Create ingestion job
    -> Scan Google Drive folders (metadata only)
    -> Queue each file in BullMQ
    -> Download file
    -> Validate image with Sharp
    -> Calculate SHA-256 hash
    -> Detect duplicate
    -> Upload new image to S3
    -> Generate Gemini metadata
    -> Generate OpenAI embedding
    -> Store metadata and vector in PostgreSQL
    -> Mark asset completed
```

Important behavior:

- The SHA-256 hash prevents the same image content from being stored twice.
- Existing metadata and embeddings are skipped when they already exist.
- `DRY_RUN` estimates work and checks duplicates without doing the full S3/AI path.
- Failed stages can be retried by the application and moved to a BullMQ dead-letter queue.
- Dead-letter items can be replayed through `POST /pipeline/dlq/replay`.

An image is searchable only after it has both AI metadata and an embedding.

### 4.2 Semantic search

Search receives normal language, for example `cartoon elephant for preschool`, and does the following:

```text
Search text
    -> Create an OpenAI embedding
    -> Search similar vectors in pgvector
    -> Apply optional metadata filters
    -> Return the best matching assets
    -> Cache the result in Redis when possible
```

The main endpoint is `POST /search`. Search is reused by both flashcards and worksheets.

### 4.3 Flashcard generation

```text
Request validation
    -> Analyze topic, age, grade, subject, and difficulty
    -> Determine the educational objective
    -> Select one eligible flashcard template
    -> Ask Gemini for content matching that template
    -> Validate the generated content
    -> Search for one image per image slot
    -> Assemble rendering-ready flashcard JSON
    -> Optionally render HTML, WebP, or PDF
```

The template defines the layout and component IDs. Gemini supplies educational text and image search queries, but it must not invent a new layout.

Main endpoints:

- `POST /flashcards/generate`
- `POST /flashcards/generate/stream`
- `POST /flashcards/render`
- `GET /flashcards/templates`
- `POST /flashcards/templates`
- `GET /flashcards/assets/:assetId/image`

The browser demo is `public/flashcards.html`.

### 4.4 Worksheet generation

```text
Validate request and safety rules
    -> Select a worksheet template
    -> Ask Gemini for JSON matching the template schema
    -> Validate the structure
    -> Search for images from imageQuery values
    -> Save the worksheet
    -> Build preview HTML
    -> Optionally render HTML, WebP, or PDF
```

Worksheet templates contain trusted HTML and JSON configuration. Generated content is stored as data; Gemini does not generate executable renderer code.

Main endpoints:

- `POST /worksheets/templates`
- `GET /worksheets/templates`
- `POST /worksheets/generate`
- `POST /worksheets/generate-set`
- `POST /worksheets/generate-set/stream`
- `GET /worksheets`
- `GET /worksheets/:id/preview`
- `POST /worksheets/:id/edit`
- `POST /worksheets/:id/render`
- `GET /worksheets/:id/images/search`
- `POST /worksheets/:id/images`

The teacher UI is `public/worksheets.html`; the editor UI is `public/worksheet-editor.html`.

## 5. Source Code Modules

All feature modules are under `src/modules/` and are registered in `src/app.module.ts`.

### Shared infrastructure

| Module | Location | Purpose |
| --- | --- | --- |
| Database | `src/modules/database` | Prisma client and PostgreSQL connection |
| Storage | `src/modules/storage` | Uploads, downloads, and signed URLs for S3 |
| Cache | `src/modules/cache` | Redis caching for search and asset metadata |
| Queue | `src/modules/queue` | BullMQ configuration, queues, and processors |
| Observability | `src/modules/observability` | Request logging and in-memory pipeline metrics |
| Pipeline tracker | `src/modules/pipeline-tracker` | Persists workflow execution, stage, AI, and image-search telemetry |

### Asset library

| Module | Location | Purpose |
| --- | --- | --- |
| Drive | `src/modules/drive` | Google Drive authentication, scanning, and downloads |
| Image | `src/modules/image` | Image validation, dimensions, hashing, and AI-safe resizing |
| Ingestion | `src/modules/ingestion` | Creates and tracks ingestion jobs and files |
| AI | `src/modules/ai` | Gemini vision, OpenAI embeddings, rate limits, and usage tracking |
| Pipeline | `src/modules/pipeline` | Runs ingestion stages, retries failures, and replays DLQ items |
| Search | `src/modules/search` | Embedding search, metadata filters, and result mapping |

### Educational products

| Module | Location | Purpose |
| --- | --- | --- |
| Flashcards | `src/modules/flashcards` | Template selection, content generation, image retrieval, editing, and rendering |
| Worksheets | `src/modules/worksheets` | Worksheet template selection, generation, editing, image retrieval, and rendering |

## 6. Important Files Inside Modules

### Application entry points

| File | Purpose |
| --- | --- |
| `src/main.ts` | Starts NestJS, configures JSON input, CORS, static files, logging, and Swagger |
| `src/app.module.ts` | Registers all application modules |
| `src/config/configuration.ts` | Loads and organizes environment configuration |
| `prisma/schema.prisma` | Database models and relations |
| `generated/prisma/` | Generated Prisma client; do not hand-edit |

### Flashcards

| File/folder | Purpose |
| --- | --- |
| `src/modules/flashcards/flashcards.controller.ts` | Flashcard HTTP endpoints |
| `services/flashcard-orchestrator.service.ts` | Runs the complete generation flow |
| `services/template-selection.service.ts` | Selects an eligible template |
| `services/flashcard-content.service.ts` | Calls Gemini and validates content |
| `services/flashcard-image-retrieval.service.ts` | Searches for images for image slots |
| `utils/user-request.resolver.ts` | Normalizes the user's request |
| `utils/template-selection.engine.ts` | Deterministic filtering and ranking |
| `utils/llm-content.validator.ts` | Ensures Gemini follows the template contract |
| `flashcard-renderer/` | HTML, browser, image, PDF, and storage rendering code |

### Worksheets

| File/folder | Purpose |
| --- | --- |
| `src/modules/worksheets/worksheets.controller.ts` | Worksheet HTTP endpoints |
| `services/worksheet-generation.service.ts` | Creates worksheet structures and sets |
| `services/worksheet-template-selection.service.ts` | Finds a matching worksheet template |
| `services/worksheet-content.service.ts` | Generates structured content with Gemini |
| `services/worksheet-validation.service.ts` | Validates generated worksheet data |
| `services/worksheet-edit.service.ts` | Handles field and image edits |
| `services/worksheet-render.service.ts` | Builds previews and rendered outputs |
| `renderers/` | Trusted TypeScript worksheet renderers |
| `utils/` | Structure, token, image, and layout helpers |

## 7. Repository Folder Structure

```text
AI_Applications/
├── src/                         # NestJS application source
│   ├── main.ts                  # Application bootstrap
│   ├── app.module.ts            # Root module
│   ├── common/                  # Shared events, HTTP helpers, and interfaces
│   ├── config/                  # Environment configuration
│   └── modules/                 # Feature and infrastructure modules
├── prisma/
│   ├── schema.prisma            # Database schema
│   └── migrations/              # Database migrations
├── generated/prisma/            # Generated Prisma client
├── public/                      # Browser UIs and static files
├── scripts/                     # Seed, migration, repair, and validation scripts
├── test/                        # End-to-end tests and test support
├── docs/                        # Architecture, handoff, testing, and feature notes
├── package.json                 # Commands and dependencies
├── tsconfig.json                # TypeScript configuration
├── nest-cli.json                # Nest CLI configuration
└── eslint.config.mjs            # ESLint configuration
```

## 8. Documentation Folder Map

| Folder/file | Use it for |
| --- | --- |
| `docs/PROJECT_CONTEXT.md` | Current high-level architecture and status |
| `docs/PROJECT_KT.md` | This beginner-friendly onboarding guide |
| `docs/test.md` | Local setup and component validation order |
| `docs/optimization.md` | Token, cost, and performance rules |
| `docs/asset-ingestion/` | Ingestion, search, retries, monitoring, and handoff notes |
| `docs/flashcards/` | Flashcard templates, selection, prompts, retrieval, and rendering |
| `docs/worksheets/` | Worksheet generation, templates, editing, and rendering |
| `docs/worksheet-maker-templates.md` | Mapping from the old WorksheetMaker prototype to this project |
| `docs/file-generation/` | File-generation prompt and implementation notes |
| `docs/vector-search/` | Vector-search-specific notes and fixes |
| `docs/temp/` | Temporary working notes; verify freshness before relying on them |

For flashcard work, start with `docs/flashcards/FLASHCARD_SELECTION_AND_GENERATION_CONTEXT.md`.
For asset ingestion work, start with `docs/asset-ingestion/HANDOFF_CONTEXT.md`.
For worksheet work, start with `docs/worksheets/WORKSHEET_GENERATION_ARCHITECTURE.md`.

## 9. Database Concepts

The most important database records are:

- `IngestionJob`: one request to scan/process a Drive folder.
- `IngestionFile`: one Drive file inside an ingestion job.
- `Asset`: one canonical image, identified by a unique content hash.
- `AssetMetadata`: Gemini-generated searchable information about an asset.
- `AssetEmbedding`: the vector used for semantic search.
- `ProcessingAttempt`: stage-level success and failure history.
- `AiUsage`: provider, token, latency, and cost information.
- `FlashcardTemplate`: reusable flashcard layout and learning metadata.
- `TemplateSelectionRule`: configurable flashcard eligibility and ranking rules.
- `WorksheetTemplate`: trusted worksheet HTML and JSON generation contract.
- `Worksheet`: one generated worksheet instance.
- `WorksheetOutput`: a rendered worksheet file stored in S3.

PostgreSQL is the source of truth. Redis is for cache and queue support, and S3 stores binary files.

## 10. Useful Commands

Run commands from the repository root:

```powershell
npm install
npm run build
npm run start:dev
npm test
npm run test:e2e
```

Useful validators:

```powershell
npm run validate:drive
npm run validate:image
npm run validate:vision
npm run validate:embedding
npm run validate:vector
npm run validate:search
npm run validate:cache
npm run validate:queue -- --queue ingestion
```

Flashcard diagnostics:

```powershell
npm run flashcards:rule-coverage
npm run flashcards:emit-diagnostics
```

The exact environment variables depend on the feature being run. Common groups are:

- `DATABASE_URL` for PostgreSQL.
- `REDIS_*` and `QUEUE_WORKER_*` for cache and BullMQ.
- `AWS_*` for S3.
- `GOOGLE_DRIVE_*` for Drive access.
- `GEMINI_*` and `OPENAI_*` for AI providers.
- `PIPELINE_*` for retries and tracking.
- `FLASHCARD_*` and `WORKSHEET_*` for product behavior.

## 11. Beginner Starting Path

1. Read this file and `docs/PROJECT_CONTEXT.md`.
2. Read `src/app.module.ts` to see how modules are connected.
3. Read the controller for the feature you need.
4. Follow the controller into its main service or orchestrator.
5. Check the related DTOs, validators, and tests.
6. Check `prisma/schema.prisma` before changing persisted data.
7. Use Swagger at `/api` to inspect the available HTTP contracts.
8. Run the narrowest relevant test or validation script before making a broader change.

A useful mental rule is:

```text
Controller = HTTP entry point
Service = business logic
Repository/Prisma = database access
Provider = external API integration
Renderer = final HTML/image/PDF output
DTO/validator = input and output contract
```

## 12. Current Known Notes

- Runtime queues use BullMQ on Redis; older notes may mention SQS because the project was migrated.
- The ingestion pipeline has a known gap when a duplicate asset exists but its S3, metadata, or embedding work is incomplete.
- Flashcard template selection is database-driven; do not hardcode age-to-template decisions in the orchestrator.
- Worksheet templates use trusted registered renderers. Do not execute renderer JavaScript loaded from the database.
- Do not commit changes unless the task explicitly asks for a commit.
