# Implement Worksheet Generation MVP in Existing NestJS Backend

## 1. Role

You are working inside an existing production-oriented NestJS 11 backend for an educational AI application.

Your task is to implement the **first MVP iteration of worksheet generation** inside this existing NestJS repository.

Do NOT create a separate Node.js/Express application.

Do NOT create a parallel database, Redis setup, queue setup, asset-search implementation, AI provider implementation, or rendering infrastructure if equivalent functionality already exists in the repository.

The existing repository is the source of truth for architecture and conventions.

Before changing code:

1. Inspect the existing repository structure.
2. Inspect the existing flashcard module thoroughly.
3. Inspect the existing asset search module.
4. Inspect the existing AI/Gemini module.
5. Inspect the existing storage/S3 module.
6. Inspect the existing Prisma schema.
7. Inspect the existing Playwright flashcard renderer.
8. Inspect the existing BullMQ/queue module.
9. Inspect existing DTO, validation, logging, error handling, configuration, and testing conventions.
10. Reuse existing services wherever possible.

The goal is to build a **small, clean worksheet generation module** that follows the architecture already established by flashcards.

---

# 2. Existing Project Context

The project is a NestJS 11 + TypeScript backend using:

- NestJS 11
- Express
- Prisma 7
- PostgreSQL
- pgvector with 1536-dimensional embeddings
- AWS S3
- Redis
- BullMQ
- Gemini through `@google/genai`
- OpenAI `text-embedding-3-small`
- Playwright for HTML → WebP/PDF rendering
- Swagger
- Existing asset ingestion and semantic search
- Existing flashcard generation pipeline

The current repository already contains these major modules:

```text
src/modules/database
src/modules/storage
src/modules/cache
src/modules/queue
src/modules/observability
src/modules/pipeline-tracker
src/modules/drive
src/modules/image
src/modules/ingestion
src/modules/ai
src/modules/pipeline
src/modules/search
src/modules/flashcards
```

The existing asset library is the shared foundation of the application.

The asset pipeline is approximately:

```text
Google Drive
    ↓
Asset ingestion
    ↓
S3
    ↓
Gemini Vision metadata
    ↓
OpenAI embedding
    ↓
PostgreSQL + pgvector
    ↓
Semantic asset search
```

Flashcards already consume this asset library rather than generating images.

The existing flashcard generation flow is:

```text
REQUEST_VALIDATION
    ↓
REQUEST_ANALYSIS
    ↓
EDUCATIONAL_OBJECTIVE_DETERMINATION
    ↓
TEMPLATE_SELECTION
    ↓
LLM_CONTENT_GENERATION
    ↓
IMAGE_RETRIEVAL
    ↓
FINAL_VALIDATION
    ↓
RESPONSE
    ↓
optional rendering
```

Follow this architectural philosophy for worksheets.

---

# 3. Worksheet Prototype Being Migrated

There is an existing prototype worksheet repository based on Node.js/Express.
You can refer it at @C:\Users\shubh\Downloads\WorksheetMakerMain_localhost-20260813T065743Z-1-001\WorksheetMakerMain_localhost 

The prototype currently has template folders such as:

```text
backend/templates/{category}/{type}/
```

Each template may contain:

```text
template.html
renderer.js
structure.json
meta.json
field-editor.js
field-prompts.json
ai-edit-system-prompt.txt
ai-edit-config.js
ai-edit-panel.js
ai-edit-popup.html
background.png
sample.png
```

The prototype currently discovers templates from the filesystem and dynamically imports `renderer.js`.

That filesystem architecture must NOT be copied directly into the NestJS production implementation.

Instead, preserve the useful concepts:

```text
template definition
+
structure contract
+
HTML rendering
+
AI content generation
+
field editing
+
image retrieval
```

while replacing the prototype infrastructure with the existing NestJS infrastructure.

---

# 4. MVP Scope

Implement only the following worksheet capabilities for the first iteration:

## API 1 — Generate Worksheet

```http
POST /worksheets/generate
```

Purpose:

Generate the logical worksheet structure from the user's request.

The flow should:

```text
request
    ↓
validate request
    ↓
select worksheet template
    ↓
load template from DB
    ↓
generate worksheet structure using Gemini
    ↓
validate generated structure
    ↓
resolve image search queries through existing asset search
    ↓
return rendering-ready worksheet representation
```

The API should NOT generate arbitrary HTML through Gemini.

Gemini generates structured worksheet content only.

---

## API 2 — Edit Worksheet Fields

```http
POST /worksheets/:worksheetId/edit
```

Purpose:

Allow the frontend to regenerate/edit one or more editable worksheet fields using Gemini.

The API should:

```text
worksheet
    ↓
load current structure
    ↓
identify editable field
    ↓
load template AI configuration
    ↓
send relevant context + field instructions to Gemini
    ↓
generate replacement value
    ↓
validate replacement
    ↓
update worksheet structure
    ↓
return updated structure
```

Do not allow the model to modify arbitrary HTML.

The model modifies the structured worksheet data only.

---

## API 3 — Render / Download Worksheet

```http
POST /worksheets/:worksheetId/render
```

The same endpoint should support output formats such as:

```json
{
  "format": "html"
}
```

or:

```json
{
  "format": "webp"
}
```

or:

```json
{
  "format": "pdf"
}
```

The endpoint should:

```text
worksheet structure
    ↓
template
    ↓
resolved assets
    ↓
trusted renderer
    ↓
HTML
    ↓
Playwright
    ↓
HTML / WebP / PDF
```

Do not create separate APIs such as:

```text
/generate-pdf
/generate-webp
/render-html
```

unless an existing repository convention requires it.

One render endpoint with a format parameter is preferred.

---

# 5. Important Scope Boundary

Do NOT implement:

- user accounts
- worksheet sharing
- worksheet collaboration
- worksheet history UI
- worksheet analytics
- template CRUD APIs
- template upload APIs
- template admin UI
- template version management UI
- template marketplace
- new image ingestion
- new embedding infrastructure
- new search infrastructure
- new AI provider
- new Redis infrastructure
- new BullMQ infrastructure

Templates will be inserted manually into the database during this MVP.

The backend must provide the data model and services required to consume them.

Do NOT build an API for creating templates.

---

# 6. Database Architecture

The database must be PostgreSQL through the existing Prisma 7 setup.

Before modifying `schema.prisma`, inspect the existing models and determine whether an existing model can be reused or extended.

Do not duplicate existing flashcard concepts unnecessarily.

However, worksheets and flashcards should remain logically separate because their template contracts and rendering structures are different.

## Proposed model: WorksheetTemplate

Create a `WorksheetTemplate` model if an appropriate existing model does not already exist.

Conceptually:

```text
WorksheetTemplate
-----------------
id
name
slug
category
description

status

version

templateHtml

structureDefinition

meta

rendererType

rendererConfig

aiConfig

fieldPrompts

aiSystemPrompt

backgroundAssetId
sampleAssetId

createdAt
updatedAt
```

Use appropriate Prisma types.

Prefer JSON/JSONB-compatible Prisma fields for structured configuration.

Suggested meaning:

### `name`

Human-readable template name.

Example:

```text
Counting Objects
```

### `slug`

Stable identifier.

Example:

```text
counting_objects_v1
```

### `category`

Examples:

```text
numeracy
language
thematic
phonics
```

### `description`

Human-readable explanation.

### `status`

Use an enum if consistent with project conventions.

Potential states:

```text
DRAFT
ACTIVE
INACTIVE
```

Do not introduce unnecessary states.

### `version`

Integer or string according to project conventions.

### `templateHtml`

The actual HTML template.

This replaces the prototype's:

```text
template.html
```

### `structureDefinition`

JSON describing the worksheet structure/schema expected by the renderer and LLM.

This replaces the role of:

```text
structure.json
```

However, distinguish between:

1. template structure/schema/defaults
2. generated worksheet instance structure

The template database row should NOT contain generated user-specific worksheet content.

### `meta`

JSON for template metadata.

This replaces:

```text
meta.json
```

### `rendererType`

A trusted renderer identifier.

Example:

```text
counting_objects
matching
classification
phonics
```

Do NOT store executable JavaScript here.

### `rendererConfig`

Optional JSON configuration required by the renderer.

### `aiConfig`

JSON configuration for AI generation/editing.

### `fieldPrompts`

JSON configuration replacing:

```text
field-prompts.json
```

### `aiSystemPrompt`

Text replacing:

```text
ai-edit-system-prompt.txt
```

### `backgroundAssetId`

Reference to an existing asset/storage object if applicable.

Do not store binary image data in PostgreSQL.

### `sampleAssetId`

Reference to sample image storage if applicable.

---

# 7. Generated Worksheet Persistence

Create a separate model for a generated worksheet.

Conceptually:

```text
Worksheet
---------
id
templateId

request
structure

status

createdAt
updatedAt
```

Possible status:

```text
GENERATED
RENDERING
COMPLETED
FAILED
```

Keep the status model simple.

The generated worksheet's `structure` must contain the actual generated content.

For example:

```json
{
  "worksheetType": "counting_objects",
  "instruction": "Count the objects.",
  "items": [
    {
      "count": 3,
      "imageQuery": "red apples",
      "assetId": "..."
    },
    {
      "count": 5,
      "imageQuery": "yellow bananas",
      "assetId": "..."
    }
  ]
}
```

Do not store large binary image data inside this JSON.

Use asset IDs or storage references.

---

# 8. Rendered Output Persistence

If the existing storage architecture supports it cleanly, create a lightweight output model.

Conceptually:

```text
WorksheetOutput
---------------
id
worksheetId
format
storageKey
createdAt
```

Formats:

```text
HTML
WEBP
PDF
```

Do not store generated PNG/PDF binary data directly in PostgreSQL.

Store output in S3 using the existing storage module.

Use existing S3 conventions.

---

# 9. Database Relationships

The intended relationship is:

```text
WorksheetTemplate
       │
       │ 1:N
       ▼
Worksheet
       │
       │ 1:N
       ▼
WorksheetOutput
```

Potentially:

```text
WorksheetTemplate
       │
       ├──── backgroundAssetId ──→ Asset
       │
       └──── sampleAssetId ──────→ Asset
```

Only add these Asset relationships if the existing `Asset` model makes this appropriate.

Do not duplicate the Asset table.

---

# 10. Prisma Requirements

Follow the repository's existing Prisma 7 conventions.

The project uses:

```text
@generated/prisma/client
```

for generated Prisma client imports.

Do not introduce a different Prisma client pattern.

After modifying the schema:

```bash
npx prisma generate
```

and run the appropriate migration workflow according to the project's existing development conventions.

Do NOT seed template data.

The developer/user will manually create template database entries.

Do NOT modify existing production data.

Do NOT reset the database.

Do NOT use destructive migration commands.

---

# 11. Template Architecture

The template system must be database-driven.

Do NOT scan:

```text
templates/
```

at runtime.

Do NOT dynamically import template folders.

Do NOT require:

```text
template-name/
    template.html
    renderer.js
```

to exist on the server.

The database is the source of truth for template definitions.

---

# 12. Trusted Renderer Architecture

The prototype has:

```text
renderer.js
```

Do NOT store executable renderer JavaScript in PostgreSQL.

Instead, create a renderer registry in NestJS.

Example:

```text
src/modules/worksheets/renderers/
    worksheet-renderer.interface.ts
    worksheet-renderer.registry.ts
    counting-objects.renderer.ts
    ...
```

The exact filenames are up to the existing repository conventions.

Define an interface similar to:

```typescript
interface WorksheetRenderer {
  readonly type: string;

  render(input: WorksheetRenderInput): Promise<string> | string;
}
```

The registry should map:

```text
rendererType
    ↓
trusted renderer implementation
```

Example:

```text
counting_objects
    ↓
CountingObjectsRenderer
```

The DB contains:

```json
{
  "rendererType": "counting_objects"
}
```

The renderer implementation remains TypeScript code inside the NestJS application.

---

# 13. Renderer Responsibilities

A renderer is responsible for converting:

```text
template HTML
+
validated worksheet structure
+
resolved assets
+
renderer configuration
```

into final HTML.

It must NOT:

- call Gemini
- perform embeddings
- perform vector search
- invent worksheet content
- select templates
- make arbitrary database queries
- execute user-provided JavaScript
- download arbitrary URLs

It should be deterministic.

---

# 14. Generic vs Template-Specific Rendering

Prefer a generic renderer architecture whenever possible.

If multiple templates can be rendered through the same declarative mechanism, do not create a separate TypeScript renderer for every template.

For example:

```text
GenericWorksheetRenderer
```

can process a template whose HTML contains controlled placeholders.

Only create specialized renderers when a template genuinely requires unique rendering logic.

The architecture should support:

```text
rendererType = "generic"
```

and:

```text
rendererType = "counting_objects"
```

for specialized cases.

Do not over-engineer this during MVP.

---

# 15. Template HTML

The template HTML should be stored in:

```text
WorksheetTemplate.templateHtml
```

The rendering engine should inject the validated structure and resolved assets.

Do NOT ask Gemini to generate HTML.

Do NOT allow arbitrary template HTML from the worksheet generation request.

Only trusted HTML stored in the database should be rendered.

---

# 16. Template Assets

The prototype has:

```text
background.png
sample.png
```

Do not store these as binary data in PostgreSQL.

Use the existing storage/S3 system.

The database should contain references such as:

```text
backgroundAssetId
sampleAssetId
```

or storage keys according to the existing Asset/S3 architecture.

Reuse:

```text
StorageService
Asset
```

instead of creating a worksheet-specific storage implementation.

---

# 17. Asset Retrieval

This is a critical part of the implementation.

Do NOT implement another image search system.

Reuse the existing:

```text
SearchService
```

and/or:

```text
FlashcardImageRetrievalService
```

depending on the existing abstractions.

If the flashcard-specific retrieval service is too tightly coupled to flashcards, extract only the reusable asset-search functionality into a shared service without breaking flashcards.

The desired worksheet flow is:

```text
Gemini
   ↓
imageQuery
   ↓
existing semantic asset search
   ↓
PostgreSQL + pgvector
   ↓
Asset
   ↓
S3
```

The worksheet system must never rely on:

```text
frontend/images/
```

or local image folders.

---

# 18. Image Search Contract

Generated worksheet content should use semantic image queries.

Example:

```json
{
  "imageQuery": "three red apples"
}
```

NOT:

```json
{
  "imageName": "apple_23.png"
}
```

The LLM should describe what image is required.

The asset search system decides which actual asset to use.

The generated structure can then be enriched:

```json
{
  "imageQuery": "three red apples",
  "assetId": "asset-123"
}
```

Do not put S3 binary data into the structure.

---

# 19. Asset Retrieval Concurrency

Inspect the existing flashcard image retrieval implementation and reuse its concurrency, caching, and search conventions.

Do not create arbitrary parallelism.

The existing project already has:

```text
FLASHCARD_IMAGE_SEARCH_LIMIT
FLASHCARD_IMAGE_CONCURRENCY
FLASHCARD_SIGNED_URL_TTL_SECONDS
```

Follow the same general philosophy.

For MVP, one best asset per image slot is sufficient unless the template explicitly requires multiple candidates.

---

# 20. Worksheet Generation Flow

Implement approximately:

```text
POST /worksheets/generate
        │
        ▼
WorksheetGenerationService
        │
        ├── validate request
        │
        ├── analyze request
        │
        ├── select template
        │
        ├── load template
        │
        ├── generate content with Gemini
        │
        ├── validate structure
        │
        ├── extract image queries
        │
        ├── retrieve assets
        │
        ├── attach asset IDs
        │
        ├── persist Worksheet
        │
        └── return worksheet
```

---

# 21. Template Selection

For MVP, do NOT create a complicated AI template-selection system.

The existing flashcard architecture already demonstrates deterministic eligibility and ranking.

Reuse the concept.

The worksheet template can contain metadata such as:

```json
{
  "grades": ["LKG", "UKG"],
  "subjects": ["Math"],
  "topics": ["Counting"],
  "ageMin": 3,
  "ageMax": 6,
  "difficulty": ["easy", "medium"]
}
```

Implement deterministic selection first.

If the existing flashcard selection engine is reusable, reuse it.

Otherwise implement a small worksheet-specific selector.

Do NOT send the entire template catalog to Gemini.

---

# 22. Gemini Content Generation

Reuse the existing Gemini provider/module.

Do not instantiate another Google Gemini client.

The content generation prompt should include:

```text
User request
+
template metadata
+
template structure definition
+
educational constraints
+
output requirements
```

The model must return JSON only.

Conceptually:

```json
{
  "instruction": "Count the objects.",
  "items": [
    {
      "count": 3,
      "imageQuery": "red apples"
    }
  ]
}
```

---

# 23. LLM Boundary

Gemini is responsible for:

```text
educational content
text
question generation
labels
image search descriptions
```

Gemini is NOT responsible for:

```text
HTML
CSS
layout
positions
template selection from arbitrary templates
actual asset selection
S3 URLs
rendering
PDF generation
```

The existing flashcard architecture explicitly follows the principle that the LLM generates content but does not invent layouts or styling. Preserve that boundary.

---

# 24. Structure Validation

Implement a worksheet-specific validation layer.

Do not trust Gemini output directly.

Validation must check:

- required fields
- correct data types
- array lengths
- allowed values
- string lengths
- template-specific constraints
- image query presence where required
- no unexpected fields where strict schemas are required

Use the project's existing validation approach where possible.

Prefer schema validation with the repository's existing libraries/conventions.

If the existing flashcard `llm-content.validator` pattern is reusable, follow that pattern.

---

# 25. Prevent Layout Injection

The generated structure must never contain:

```text
arbitrary HTML
arbitrary CSS
arbitrary JavaScript
template definitions
renderer code
```

If a field is intended to contain text, treat it as text.

Escape or safely handle HTML-sensitive content during rendering.

Do not use `innerHTML` with untrusted generated values unless the existing rendering design explicitly sanitizes them.

---

# 26. Worksheet Editing

Implement:

```http
POST /worksheets/:worksheetId/edit
```

Request conceptually:

```json
{
  "field": "instruction",
  "instruction": "Make this shorter and easier for a 4-year-old."
}
```

or, if the existing design supports it:

```json
{
  "fieldPath": "items[0].label",
  "instruction": "Make this simpler."
}
```

The service should:

1. Load worksheet.
2. Load template.
3. Resolve the field definition.
4. Confirm the field is editable.
5. Load field-specific AI prompt configuration.
6. Load current value.
7. Generate replacement through Gemini.
8. Validate replacement.
9. Update worksheet structure.
10. Re-run asset retrieval if the edited field changes an image query.
11. Persist.
12. Return updated worksheet.

Do not expose arbitrary JSON-path mutation without validation.

---

# 27. Linked Fields

The prototype has concepts such as:

```text
getLinkedFields
getLinkedFieldPrompt
```

If the template's manually entered AI configuration requires linked fields, support this concept in the DB `aiConfig`/`fieldPrompts`.

However, do not copy the prototype's frontend JavaScript architecture.

The backend should own the editing logic.

---

# 28. Render API

Implement:

```http
POST /worksheets/:worksheetId/render
```

Request:

```json
{
  "format": "pdf"
}
```

Allowed values:

```text
html
webp
pdf
```

Flow:

```text
load worksheet
    ↓
load template
    ↓
resolve assets
    ↓
renderer registry
    ↓
HTML
    ↓
Playwright
    ↓
output
```

---

# 29. Reuse Existing Playwright Rendering

The current project already uses Playwright for flashcard HTML → WebP/PDF rendering.

Inspect the existing flashcard renderer implementation.

Extract reusable functionality only if necessary.

Do NOT introduce Puppeteer merely because the worksheet prototype used Puppeteer.

The existing NestJS project's rendering technology should be preferred.

If the existing flashcard renderer can render arbitrary worksheet HTML safely, extract/reuse that browser/rendering infrastructure.

---

# 30. Browser Lifecycle

Follow the existing flashcard renderer's browser pooling/lifecycle strategy.

Do not launch a new browser process for every API request if the existing renderer already maintains a reusable browser/page strategy.

Be careful with:

- concurrent renders
- browser cleanup
- page cleanup
- timeouts
- failed renders
- memory usage

The VPS environment is memory-constrained, so avoid creating excessive browser instances.

---

# 31. Asset URLs During Rendering

The renderer needs browser-accessible image URLs.

Use the existing S3 signed URL or same-origin asset proxy architecture.

Do not embed large base64 image blobs into the worksheet structure unless the existing renderer specifically requires it.

Prefer:

```text
asset ID
    ↓
signed URL / existing proxy
    ↓
HTML <img src="...">
```

Reuse the existing flashcard asset image proxy if it is suitable.

---

# 32. HTML / WebP / PDF Output

For:

```text
html
```

return the generated HTML or an appropriate stored/retrievable representation.

For:

```text
webp
```

use the existing Playwright renderer.

For:

```text
pdf
```

use the existing Playwright renderer.

Use S3 for persistent generated files if that matches the existing output-storage architecture.

Do not add another file-storage system.

---

# 33. BullMQ

For the first MVP, do NOT automatically put every worksheet operation behind a queue.

First inspect the existing flashcard generation latency and architecture.

The goal is to keep the public API simple.

If generation/rendering is already implemented synchronously in flashcards and acceptable for MVP, follow that pattern.

However:

- do not block the event loop with expensive browser work unnecessarily
- reuse existing worker infrastructure if the existing architecture already requires it
- if queueing is needed, use the existing QueueModule and BullMQ setup
- never create another Redis connection system

If asynchronous generation is introduced, the API contract should return a worksheet/job ID rather than inventing a separate queue architecture.

For MVP, prefer the simplest implementation consistent with the existing flashcard system.

---

# 34. Redis

Reuse existing Redis infrastructure.

Do not add another Redis client unless the existing architecture requires a specific isolated connection.

Potential caching candidates:

```text
template lookup
template metadata
asset search results
```

Do not cache mutable worksheet structures without careful invalidation.

Do not over-engineer caching for the first implementation.

---

# 35. API DTOs

Create DTOs consistent with the existing project.

Example:

```text
GenerateWorksheetDto
EditWorksheetDto
RenderWorksheetDto
```

Generate request should support the educational request fields already used by flashcards where applicable:

```text
grade
age
subject
topic
difficulty
language
```

Do not invent additional mandatory request fields unless required by the implementation.

---

# 36. Response Contract

Generate endpoint should return something conceptually like:

```json
{
  "id": "worksheet-id",
  "template": {
    "id": "template-id",
    "slug": "counting_objects_v1"
  },
  "structure": {
    "instruction": "Count the objects.",
    "items": [
      {
        "count": 3,
        "imageQuery": "red apples",
        "assetId": "asset-id"
      }
    ]
  }
}
```

Do not return giant base64 image strings.

Do not return HTML from the generation API unless the existing frontend requires it.

Rendering is a separate responsibility.

---

# 37. Template DB Manual Entry

The implementation must make it easy for the developer to manually insert templates.

Provide:

1. Prisma schema.
2. Clear expected JSON structure.
3. Example documentation showing one template record.
4. Example `structureDefinition`.
5. Example `aiConfig`.
6. Example `fieldPrompts`.
7. Example `rendererConfig`.

Do NOT create seed scripts that populate production template data.

A documentation example is sufficient.

---

# 38. Example Template Record

Document a representative template such as:

```text
slug:
counting_objects_v1

rendererType:
generic

templateHtml:
<stored HTML>

structureDefinition:
{
  "type": "object",
  "required": [
    "instruction",
    "items"
  ],
  "properties": {
    "instruction": {
      "type": "string"
    },
    "items": {
      "type": "array",
      "minItems": 4,
      "maxItems": 4
    }
  }
}

aiConfig:
{
  "editableFields": [
    "instruction",
    "items"
  ]
}
```

The exact schema can be adapted to the existing validation library.

---

# 39. Mapping Prototype Files to Production

Use this mapping:

```text
Prototype                     Production
----------------------------------------------------------------
template.html                 WorksheetTemplate.templateHtml

structure.json                WorksheetTemplate.structureDefinition

meta.json                     WorksheetTemplate.meta

field-prompts.json            WorksheetTemplate.fieldPrompts

ai-edit-system-prompt.txt     WorksheetTemplate.aiSystemPrompt

ai-edit-config.js             WorksheetTemplate.aiConfig JSON

renderer.js                   Trusted NestJS renderer implementation

field-editor.js               Backend worksheet edit service/config

ai-edit-panel.js              Frontend concern; NOT required for backend MVP

ai-edit-popup.html            Frontend concern; NOT required for backend MVP

background.png                S3 / Asset reference

sample.png                    S3 / Asset reference
```

Do not copy prototype files into the NestJS backend unnecessarily.

---

# 40. Module Structure

Create something approximately like:

```text
src/modules/worksheets/
│
├── worksheets.module.ts
│
├── controllers/
│   └── worksheets.controller.ts
│
├── services/
│   ├── worksheet-generation.service.ts
│   ├── worksheet-template.service.ts
│   ├── worksheet-template-selection.service.ts
│   ├── worksheet-content.service.ts
│   ├── worksheet-validation.service.ts
│   ├── worksheet-edit.service.ts
│   └── worksheet-render.service.ts
│
├── renderers/
│   ├── worksheet-renderer.interface.ts
│   ├── worksheet-renderer.registry.ts
│   └── generic-worksheet.renderer.ts
│
├── dto/
│   ├── generate-worksheet.dto.ts
│   ├── edit-worksheet.dto.ts
│   └── render-worksheet.dto.ts
│
└── types/
    └── worksheet.types.ts
```

Adjust this to existing project conventions.

Do not create unnecessary abstractions.

---

# 41. Controller Responsibilities

The controller should remain thin.

It should:

```text
validate DTO
→ call service
→ return response
```

It should NOT:

- call Gemini directly
- call Prisma directly
- perform vector search
- render HTML
- manipulate template HTML
- implement asset retrieval
- implement business logic

---

# 42. Service Responsibilities

## WorksheetTemplateService

Responsible for:

```text
load template
find template by ID
find template by slug
validate template availability
```

No template creation API is needed.

---

## WorksheetTemplateSelectionService

Responsible for:

```text
input
→ eligible templates
→ deterministic selection
```

Do not call Gemini for basic template selection.

---

## WorksheetContentService

Responsible for:

```text
template + educational request
→ Gemini
→ structured worksheet content
```

---

## WorksheetValidationService

Responsible for:

```text
validate generated structure
validate edited fields
ensure structure conforms to template
```

---

## WorksheetEditService

Responsible for:

```text
worksheet
+
field
+
instruction
→ Gemini
→ validated update
```

---

## WorksheetRenderService

Responsible for:

```text
worksheet
→ template
→ renderer
→ HTML
→ Playwright
→ output
```

---

# 43. Avoid Flashcard Coupling

The worksheet module should reuse shared infrastructure but should NOT modify flashcard behavior unnecessarily.

Good:

```text
Worksheet
   ↓
shared SearchService
```

Good:

```text
Worksheet
   ↓
shared Gemini provider
```

Good:

```text
Worksheet
   ↓
shared StorageService
```

Good:

```text
Worksheet
   ↓
shared Playwright/browser infrastructure
```

Avoid:

```text
Worksheet
   ↓
FlashcardOrchestratorService
```

unless there is a genuinely reusable abstraction.

The flashcard system is already implemented and must remain stable.

---

# 44. Error Handling

Use existing NestJS error-handling conventions.

Examples:

```text
template not found
→ NotFoundException

worksheet not found
→ NotFoundException

invalid field
→ BadRequestException

field not editable
→ BadRequestException

invalid Gemini output
→ appropriate AI/content error

asset search failure
→ appropriate service error

render failure
→ appropriate render error
```

Do not expose internal prompts, API keys, SQL errors, or raw provider exceptions.

---

# 45. Logging

Use the project's existing structured logger.

Log meaningful milestones:

```text
worksheet generation started
template selected
content generation completed
asset retrieval completed
worksheet persisted
render started
render completed
```

Do not log:

- API keys
- full signed URLs
- unnecessary image data
- giant HTML
- giant base64 strings
- sensitive prompt contents unless the project's AI telemetry explicitly allows it

Follow existing AI usage/telemetry conventions.

---

# 46. Observability

If the existing pipeline tracker is designed generically enough, consider recording worksheet stages.

Potential stages:

```text
REQUEST_VALIDATION
TEMPLATE_SELECTION
LLM_CONTENT_GENERATION
STRUCTURE_VALIDATION
IMAGE_RETRIEVAL
PERSISTENCE
RENDER
```

However, do not force worksheet tracking into a flashcard-specific implementation if it would create unnecessary coupling.

Reuse existing tracker abstractions if they are generic.

---

# 47. AI Usage / Cost Tracking

Reuse the existing AI module and its usage/cost tracking.

Do not create a second Gemini provider.

Do not bypass existing rate limiting/circuit breaker behavior.

The worksheet LLM calls must go through the existing AI infrastructure.

---

# 48. Testing Requirements

Add unit tests for:

### Template selection

```text
eligible template selected
no matching template
```

### Content validation

```text
valid structure accepted
missing field rejected
extra field rejected where strict
invalid array length rejected
invalid image query rejected
```

### Asset retrieval

Mock the existing SearchService.

Verify:

```text
imageQuery → asset ID
```

### Editing

Test:

```text
editable field accepted
non-editable field rejected
Gemini replacement validated
image query edit triggers asset re-resolution
```

### Rendering

Mock renderer/browser infrastructure where appropriate.

Test:

```text
template → renderer
invalid renderer type
HTML generation
format validation
```

### Controller

Test the three API contracts.

---

# 49. Do Not Build Frontend

For this task, only implement backend APIs and backend rendering.

Do not modify:

```text
public/flashcards.html
```

unless absolutely necessary for a minimal manual test.

Do not build a worksheet UI.

We will manually call the APIs using Swagger/Postman/curl initially.

Swagger documentation should be added for all three APIs.

---

# 50. Swagger

Document:

```text
POST /worksheets/generate
POST /worksheets/:worksheetId/edit
POST /worksheets/:worksheetId/render
```

Include:

- request DTO
- response shape
- allowed render formats
- example request
- example response
- possible error responses

The existing project exposes Swagger at:

```text
/api
```

Keep this convention.

---

# 51. Security Requirements

Never execute:

```text
renderer code from DB
JavaScript from DB
user-supplied JavaScript
user-supplied CSS
```

Only trusted renderer implementations in the NestJS source code may execute.

Template HTML is trusted application configuration.

Generated LLM values must be treated as untrusted text.

Sanitize/escape values appropriately before injecting into HTML.

Do not allow worksheet requests to specify arbitrary filesystem paths or arbitrary URLs.

---

# 52. Performance Requirements

Keep expensive operations bounded.

Do not:

```text
generate unnecessary embeddings
download assets unnecessarily
launch a browser per asset
launch a browser per render if a shared browser is already available
send huge prompts
send huge template catalogs to Gemini
store base64 images in DB
```

Use existing Redis/search caching where appropriate.

Use one best asset per image slot for MVP.

---

# 53. Important Architecture Principle

The entire worksheet system should follow:

```text
Template
    ↓
defines what can be generated

Gemini
    ↓
fills the template with educational content

Asset Search
    ↓
finds actual images

Renderer
    ↓
turns structured data into HTML

Playwright
    ↓
turns HTML into WebP/PDF
```

Never invert these responsibilities.

---

# 54. Example End-to-End Flow

Request:

```json
{
  "grade": "LKG",
  "age": 5,
  "subject": "Math",
  "topic": "Counting",
  "difficulty": "Easy",
  "language": "English"
}
```

Template selection:

```text
counting_objects_v1
```

Gemini output:

```json
{
  "instruction": "Count the objects.",
  "items": [
    {
      "count": 3,
      "imageQuery": "red apples"
    },
    {
      "count": 5,
      "imageQuery": "yellow bananas"
    }
  ]
}
```

Validation:

```text
PASS
```

Asset search:

```text
red apples
    ↓
asset-123

yellow bananas
    ↓
asset-456
```

Persist:

```json
{
  "instruction": "Count the objects.",
  "items": [
    {
      "count": 3,
      "imageQuery": "red apples",
      "assetId": "asset-123"
    },
    {
      "count": 5,
      "imageQuery": "yellow bananas",
      "assetId": "asset-456"
    }
  ]
}
```

Render:

```text
Worksheet
   ↓
WorksheetTemplate.templateHtml
   +
structure
   +
asset URLs
   ↓
GenericWorksheetRenderer
   ↓
HTML
   ↓
Playwright
   ↓
PDF
```

---

# 55. Implementation Order

Implement in this order.

## Phase 1 — Repository analysis

Before writing code:

- inspect Prisma schema
- inspect flashcard module
- inspect template repository/service
- inspect flashcard renderer
- inspect SearchService
- inspect StorageService
- inspect AI provider
- inspect QueueModule
- inspect configuration
- inspect tests

Report briefly what reusable services you found.

Do not start implementing until you understand these boundaries.

---

## Phase 2 — Database

Implement:

```text
WorksheetTemplate
Worksheet
WorksheetOutput
```

only if required.

Add relationships and indexes.

Recommended indexes:

```text
WorksheetTemplate.slug
WorksheetTemplate.status
Worksheet.templateId
Worksheet.createdAt
WorksheetOutput.worksheetId
```

Use unique constraints where appropriate.

Do not add speculative columns.

---

## Phase 3 — Template services

Implement:

```text
WorksheetTemplateService
WorksheetTemplateSelectionService
```

Templates are read-only through the application for now.

---

## Phase 4 — Renderer architecture

Implement:

```text
WorksheetRenderer interface
WorksheetRendererRegistry
GenericWorksheetRenderer
```

Reuse existing Playwright infrastructure.

Do not implement template-specific renderers until an actual manually inserted template requires them.

---

## Phase 5 — Content generation

Implement:

```text
WorksheetContentService
WorksheetValidationService
```

Reuse existing Gemini provider.

Generate strict structured output.

---

## Phase 6 — Asset retrieval

Integrate the existing semantic search.

Do not duplicate embedding/search code.

---

## Phase 7 — Worksheet generation API

Implement:

```text
POST /worksheets/generate
```

Persist the generated worksheet.

---

## Phase 8 — Edit API

Implement:

```text
POST /worksheets/:worksheetId/edit
```

---

## Phase 9 — Render API

Implement:

```text
POST /worksheets/:worksheetId/render
```

Support:

```text
html
webp
pdf
```

---

## Phase 10 — Tests

Add unit/integration tests.

Run:

```bash
npm test
npm run build
```

Also run the existing flashcard tests to ensure there are no regressions.

---

# 56. Migration Safety

This repository already contains production flashcard and asset-ingestion functionality.

Therefore:

- do not rewrite existing Prisma models unnecessarily
- do not rename existing models
- do not alter existing flashcard API contracts
- do not change existing asset search behavior
- do not change existing embedding behavior
- do not change existing BullMQ behavior
- do not change existing S3 behavior
- do not change existing Gemini provider behavior
- do not change existing flashcard renderer behavior unless extracting a genuinely reusable abstraction
- do not remove any existing functionality

If a shared abstraction needs to be extracted, preserve backward compatibility.

---

# 57. No Unnecessary Abstraction

This is an MVP.

Do not create:

```text
10 interfaces
20 factories
multiple generic base classes
template plugin systems
dynamic code loading
microservices
new queues
new databases
```

unless the existing codebase genuinely requires them.

Prefer simple NestJS services with clear responsibilities.

---

# 58. No Template Seeding

Very important:

Do NOT create:

```text
seed worksheet templates
```

The templates will be inserted manually into the DB.

However, provide documentation showing exactly what fields the manual DB entry requires.

If helpful, provide a sample SQL/JSON example in documentation, but do not automatically execute it.

---

# 59. Documentation

Create a concise developer document:

```text
docs/worksheets/WORKSHEET_GENERATION_ARCHITECTURE.md
```

It should document:

1. Architecture
2. Database models
3. Template structure
4. Template DB entry example
5. Renderer architecture
6. Gemini generation contract
7. Asset retrieval flow
8. Three APIs
9. Render formats
10. Manual template insertion process
11. Example end-to-end request

Do not create a huge document duplicating the entire codebase.

---

# 60. Final Acceptance Criteria

The implementation is complete when all of the following are true:

### Architecture

- Worksheet generation exists inside the existing NestJS repository.
- No separate Express/Node worksheet server exists.
- Existing infrastructure is reused.

### Database

- Worksheet templates are stored in PostgreSQL.
- Generated worksheet structures are stored separately from templates.
- Binary assets are not stored in PostgreSQL.
- Template HTML is stored in the template record.
- Template configuration is stored as JSON/text.
- Renderer code is trusted TypeScript, not executable DB content.

### Generation

```http
POST /worksheets/generate
```

works end-to-end:

```text
request
→ template
→ Gemini
→ validation
→ semantic image search
→ worksheet
```

### Editing

```http
POST /worksheets/:worksheetId/edit
```

works end-to-end:

```text
worksheet
→ editable field
→ Gemini
→ validation
→ updated worksheet
```

### Rendering

```http
POST /worksheets/:worksheetId/render
```

supports:

```text
html
webp
pdf
```

using the existing Playwright infrastructure.

### Assets

Worksheet image retrieval uses the existing PostgreSQL + pgvector asset-search system.

No local image-bank dependency exists.

### AI

Worksheet generation/editing uses the existing Gemini infrastructure.

No second Gemini client is created.

### Storage

Generated files use the existing S3 infrastructure.

### Stability

Existing flashcard APIs and tests continue to work.

### Quality

```bash
npm test
npm run build
```

must pass.

---

# 61. What NOT to Do

Do not:

1. Create a new Express server.
2. Create a new database.
3. Create a new Redis setup.
4. Create a new embedding/search implementation.
5. Create a new S3 implementation.
6. Create a new Gemini client.
7. Copy the prototype's `templates/` directory into the NestJS repository.
8. Dynamically import renderer JavaScript from the database.
9. Store executable JavaScript in PostgreSQL and execute it.
10. Ask Gemini to generate HTML.
11. Ask Gemini to select arbitrary assets.
12. Put base64 images into the worksheet database record.
13. Build template CRUD APIs.
14. Seed template data.
15. Build a frontend.
16. Modify flashcard behavior unnecessarily.
17. Replace Playwright with Puppeteer merely because the prototype uses Puppeteer.
18. Introduce a queue unless it is consistent with the existing runtime architecture.
19. Add speculative database fields.
20. Make unrelated refactors.

---

# 62. First Action

Before implementing anything, inspect the repository and identify:

```text
1. Existing Prisma schema relevant to FlashcardTemplate and Asset.
2. Existing FlashcardTemplateService/Repository.
3. Existing FlashcardImageRetrievalService.
4. Existing SearchService contract.
5. Existing Gemini provider/service contract.
6. Existing Playwright renderer.
7. Existing StorageService.
8. Existing QueueModule.
9. Existing validation patterns.
10. Existing configuration patterns.
```

Then provide a concise implementation plan showing:

```text
Existing component
        ↓
Reusable for worksheets?
        ↓
How it will be reused
```

After that, implement the worksheet MVP.

Do not wait for further clarification unless there is an actual contradiction in the existing repository.

When a design choice is ambiguous, prefer:

```text
reuse existing implementation
>
small shared abstraction
>
new worksheet-specific implementation
>
new infrastructure
```

The primary goal is to get a clean, production-aligned worksheet MVP into the existing NestJS backend without destabilizing the completed flashcard and asset-ingestion systems.