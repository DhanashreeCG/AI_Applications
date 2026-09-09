Implement a production-ready **translation layer for the existing flashcard/worksheet generation system**.

> **Implemented:** shared `TranslationModule` (GCP Cloud Translation v2 + service-account auth via `GOOGLE_TRANSLATION_*` / fallback `GOOGLE_DRIVE_*`) + `POST /flashcards/translate` / `POST /worksheets/translate`. See [`../flashcards/FLASHCARD_TRANSLATION.md`](../flashcards/FLASHCARD_TRANSLATION.md).
>
> **Auth note:** Cloud Translation requires OAuth2 / service-account credentials — Google AI Studio API keys are not supported by this API.

## Context
This project currently generates flashcards/worksheets using JSON templates.

Current flow:

1. User provides generation request.
2. LLM generates content in **English** and fills the existing JSON template.
3. The generated JSON contains both:

   * user-facing textual content
   * non-translatable structural/data fields
4. Image fields contain image search descriptions/queries that are used for vector/image retrieval.
5. Image retrieval happens using the English image-search-related data.
6. The final generated JSON, including resolved image assets, is returned to the frontend for rendering.

Important:

* **English remains the canonical generation language.**
* Do NOT modify the existing LLM generation flow to generate different languages.
* Do NOT translate image-search descriptions before image retrieval.
* Do NOT regenerate flashcards when the user changes language.
* Generated flashcard JSON is currently **NOT persisted as a database record/source of truth**.
* The generated JSON returned by the generation flow is the source of truth for the current session/render.
* On page refresh, the generated flashcard can disappear. Do not introduce a persistence system as part of this task.
* There is already a cache layer in the application, but it should NOT be treated as persistent flashcard storage.
* The translation implementation must work directly from the flashcard JSON supplied to the API.

## Goal

Introduce a reusable, injectable **TranslationService** in the NestJS backend that uses **Google Cloud Translation (GCP)**.

The service must:

* Accept flashcard/worksheet JSON.
* Detect and translate only the appropriate user-facing textual fields.
* Preserve the JSON structure.
* Preserve IDs, asset IDs, image URLs, image metadata, image search descriptions, template metadata, layout data, etc.
* Translate multiple textual fields in a flashcard in an efficient batch rather than making one GCP request per field.
* Support translating an entire flashcard JSON in **one logical translation operation**, with as few GCP API calls as possible.
* Be reusable by both flashcard and worksheet flows.
* Be injectable through NestJS dependency injection.
* Be independent from the generation LLM.
* Be callable independently through an API.
* Return translated JSON suitable for directly rendering in the existing frontend.

---

# Architecture

Implement this separation:

Generation:

LLM
↓
English template JSON
↓
Image retrieval
↓
Final English flashcard JSON
↓
Frontend

Translation:

Final English flashcard JSON
↓
TranslationService
↓
GCP Translation API
↓
Translated flashcard JSON
↓
Frontend

When the user changes language:

Frontend sends the **existing English/generated JSON + target language** to the backend.

The backend translates the necessary fields and returns the translated JSON.

Do NOT call the LLM again.

Do NOT perform image retrieval again.

Do NOT regenerate the flashcard.

---

# Important API requirement

Create an API endpoint capable of accepting:

* the complete generated flashcard/worksheet JSON
* the requested target language

Conceptually:

POST /.../translate

Request:

{
"language": "mr",
"content": {
"...existing generated flashcard JSON..."
}
}

Response:

{
"...same JSON structure...",
"...translated user-facing fields..."
}

Use the project's existing API/controller conventions and naming patterns. Do not blindly create a new module if an existing flashcard/worksheet module is the appropriate location.

Inspect the repository first and integrate into the existing architecture.

---

# Translation field handling

Do NOT blindly stringify the entire JSON and send it to Google Translate.

The translation service must identify which values are translatable.

The following types of content should generally be translated:

* titles
* headings
* instructions
* questions
* labels
* descriptions shown to the learner
* answer text
* option text
* captions
* educational/user-facing text
* other text fields explicitly intended for rendering

The following must NOT be translated:

* asset IDs
* image IDs
* image URLs
* image storage paths
* template IDs
* component IDs
* element IDs
* internal keys
* slugs
* enum values
* renderer types
* layout properties
* CSS-related values
* coordinates
* dimensions
* colors
* font configuration
* booleans
* numbers
* embedding data
* vector data
* image-search queries
* image-search descriptions used for asset retrieval
* image metadata used by the retrieval pipeline
* database identifiers
* timestamps
* URLs
* arbitrary technical metadata

Most importantly:

If a field was used to find an image, **do not translate it**.

Example:

{
"content": "Lion",
"imageSearch": "lion standing in grass"
}

For Marathi:

{
"content": "सिंह",
"imageSearch": "lion standing in grass"
}

The imageSearch value remains unchanged.

---

# Do not hardcode only today's template

The project has multiple templates and both flashcards and worksheets.

Do NOT implement a brittle solution such as:

if field === "title"
if field === "instruction"
if field === "label"

and assume those are the only possible fields.

First inspect the existing template schema/component structure.

Prefer a reusable mechanism based on the existing component definitions/metadata.

If the template system already indicates whether a component is a text component or has editable/user-facing content, leverage that information.

The translation layer should be resilient to nested objects and arrays.

It should recursively process the JSON while applying an explicit rule for whether a field is translatable.

---

# Batch translation requirement

This is important.

Do NOT do this:

for each text field:
await GoogleTranslate(field)

That would create potentially dozens of network calls.

Instead:

1. Traverse the JSON.
2. Extract all translatable text values.
3. Assign each extracted value an internal reference/index.
4. Deduplicate identical strings where appropriate.
5. Send the collected strings to Google Cloud Translation in a batched request.
6. Receive translations.
7. Map translations back to their original locations.
8. Reconstruct the original JSON structure.
9. Return the translated JSON.

Conceptually:

English JSON:

{
"title": "Animals",
"instruction": "Match each animal with its home.",
"items": [
{
"label": "Lion",
"imageSearch": "lion standing in grass"
},
{
"label": "Bird",
"imageSearch": "bird on a tree"
}
]
}

Extract:

[
"Animals",
"Match each animal with its home.",
"Lion",
"Bird"
]

Translate these as a batch.

Then reconstruct:

{
"title": "जानवर",
"instruction": "प्रत्येक जानवर का उसके घर से मिलान करें।",
"items": [
{
"label": "शेर",
"imageSearch": "lion standing in grass"
},
{
"label": "पक्षी",
"imageSearch": "bird on a tree"
}
]
}

Do not make one GCP request for every text field.

Use the GCP Translation API's supported batch/multiple-content capability appropriately.

Also respect the API's request-size/content limits. If a very large worksheet exceeds a single request's limits, implement controlled chunking, but for normal flashcards there should be one translation request.

---

# TranslationService design

Create a reusable NestJS injectable service, for example:

TranslationService

It should expose a clean interface similar to:

translateContent(
content: unknown,
targetLanguage: string,
options?: TranslationOptions
): Promise<unknown>

Adapt the exact naming/types to the project's conventions.

The service should:

* be `@Injectable()`
* have a clear provider abstraction for GCP
* not contain controller-specific logic
* not contain frontend-specific logic
* not depend on a specific flashcard template
* be reusable by worksheets
* preserve input immutability
* return a new translated object rather than mutating the original object
* handle nested objects and arrays
* handle duplicate strings efficiently
* handle empty/null values safely
* skip non-string values
* skip empty strings
* avoid translating source and target when they are the same language

---

# GCP integration

Use **Google Cloud Translation** as the translation provider.

Do not introduce another translation provider.

Use the project's existing configuration/environment-variable conventions.

Do not hardcode:

* credentials
* project IDs
* API keys
* locations
* secrets

Inspect the existing project configuration patterns and follow them.

If GCP authentication is already configured in the repository, reuse it.

If authentication/configuration is missing, add only the minimum configuration necessary and document the required environment variables/configuration.

Do not commit service-account credentials or JSON secrets.

---

# Source language

The canonical generated content is English.

Design the service so the source language can be explicitly represented as:

en

but do not make the system depend on language detection.

For the current implementation:

sourceLanguage = "en"

targetLanguage = requested language

If targetLanguage is `en`, return the original content without calling GCP.

---

# Caching

There is already a cache layer in the application.

Inspect the existing cache implementation.

Translation may use the existing cache where appropriate, but:

**Do not create a persistent flashcard storage mechanism.**

The generated flashcard JSON remains ephemeral.

If caching is useful, cache only the translation result or translation fragments.

A suitable cache key could be conceptually based on:

source language
target language
content/hash

For example:

translation:{sourceLanguage}:{targetLanguage}:{contentHash}

Do not assume Redis/database persistence is required for correctness.

The system must still work correctly when the cache is empty.

---

# Frontend usage

Do not redesign the frontend.

Add only the API integration necessary for:

1. Initial English rendering:

   * existing behavior remains unchanged.

2. User selects another language:

   * frontend sends the currently available generated JSON and target language to the translation endpoint.
   * receives translated JSON.
   * replaces/render using the translated JSON.

3. User switches back to English:

   * use the original English JSON already available on the client where possible.
   * do not unnecessarily call GCP to translate English → English.

Do not regenerate the flashcard.

Do not rerun image retrieval.

Do not modify image assets.

---

# Error handling

Translation must not break the flashcard generation system.

If translation fails:

* return an appropriate API error
* do not corrupt the original English JSON
* do not modify the canonical/generated JSON
* log the failure using the project's existing logging conventions
* expose a useful but non-sensitive error response

If some implementation strategy allows partial translation, do not silently return a partially translated flashcard unless that behavior is explicitly designed and documented.

Prefer atomic behavior:

either return the translated JSON successfully, or report translation failure.

---

# Type safety

Use proper TypeScript types.

Avoid:

any

where a useful type can be created.

However, do not over-engineer a giant type system for every possible template.

The translation layer should operate generically on JSON-like structures while preserving the original structure.

---

# Tests

Add unit tests for TranslationService.

At minimum test:

1. Simple text field translation.
2. Nested text fields.
3. Arrays.
4. Multiple text fields are batched.
5. Duplicate strings are not unnecessarily translated multiple times.
6. Image-search fields remain unchanged.
7. Asset IDs remain unchanged.
8. URLs remain unchanged.
9. Numbers/booleans remain unchanged.
10. Empty/null values remain unchanged.
11. English → English does not call GCP.
12. GCP failure does not mutate the original input.
13. Original JSON structure is preserved.
14. Flashcard with multiple components.
15. Worksheet with multiple components.
16. A realistic existing template JSON from this repository.

Mock the GCP client in unit tests. Do not make real GCP calls from tests.

Also add/update controller/API tests according to the project's existing testing conventions.

---

# Important implementation workflow

Before writing code:

1. Inspect the existing repository structure.
2. Identify:

   * flashcard generation module
   * worksheet generation module
   * template schemas
   * component schemas
   * current JSON response structure
   * existing cache implementation
   * configuration/environment handling
   * existing external API/provider patterns
3. Determine the safest integration point.
4. Reuse existing abstractions where possible.
5. Do not duplicate existing utilities/providers.
6. Do not make unrelated refactors.

Then implement the translation layer.

---

# API contract

Create/document the API contract clearly.

Example:

POST /flashcards/translate

Request:

{
"language": "mr",
"content": {
"...generated flashcard JSON..."
}
}

Response:

{
"...translated flashcard JSON..."
}

The exact route should follow the project's existing API naming conventions.

Validate:

* target language
* content presence
* content shape

Do not allow arbitrary executable input or unsafe processing.

---

# Performance requirements

The implementation should be optimized for flashcard usage.

Requirements:

* one logical translation request per flashcard JSON under normal size limits
* no request per text field
* no request per component
* no request per card
* deduplicate identical strings
* cache where the existing cache architecture makes sense
* avoid unnecessary serialization/deserialization
* do not send non-translatable content to GCP

For a request containing 5 flashcards/cards, translate all relevant text from the provided JSON together rather than making 5 separate GCP calls.

The translation service receives the complete JSON and handles extraction/batching internally.

---

# Security requirements

Never expose:

* GCP credentials
* service account private keys
* API secrets

in frontend code.

The browser must call our NestJS backend.

Architecture:

Frontend
↓
NestJS Translation API
↓
TranslationService
↓
GCP Translation

NOT:

Frontend
↓
GCP directly

Use server-side GCP credentials/configuration.

---

# Deliverables

Implement the complete feature, including:

1. TranslationService.
2. GCP translation provider/client integration.
3. Translation extraction/reconstruction logic.
4. Target-language validation.
5. Translation API endpoint/controller.
6. DTOs/types.
7. Existing cache integration if appropriate.
8. Unit tests.
9. API/controller tests where appropriate.
10. Configuration/environment documentation.
11. Any required dependency installation.
12. Minimal frontend integration if the repository contains the frontend and its architecture requires it.

Do not modify the existing English generation behavior.

Do not modify image retrieval behavior.

Do not introduce flashcard persistence.

Do not introduce a second LLM call.

Do not translate image-search/retrieval fields.

---

# Acceptance criteria

The implementation is considered correct when:

### Existing behavior

English flashcard generation continues to work exactly as before.

### Translation

Given an existing generated English JSON and:

targetLanguage = "mr"

the API returns the same JSON structure with user-facing text translated to Marathi.

### Images

Image assets and image retrieval data remain exactly unchanged.

### Batching

A flashcard containing many text fields does not result in one GCP request per text field.

### Multiple cards

A JSON containing 5 cards is translated as one logical batch/request where GCP limits allow it, not 5 independent translation operations.

### No persistence dependency

The API works using only the JSON supplied in the request. It must not require a database flashcard record.

### Language switching

English → Marathi does not regenerate the flashcard.

Marathi → Hindi can translate the currently available canonical English JSON to Hindi without regenerating content.

Prefer always translating from the canonical English JSON rather than translating Marathi → Hindi, to avoid compounded translation quality loss.

### English

English → English performs no GCP request.

### Safety

Failure of translation never modifies the original English JSON.

### Reusability

TranslationService can be injected and reused by both flashcard and worksheet features.

---

# Final implementation principle

Keep the system conceptually:

GENERATION = English canonical content

IMAGE RETRIEVAL = English retrieval semantics

TRANSLATION = presentation/localization layer

RENDERING = language-specific presentation

The translation layer must be **orthogonal to content generation and image retrieval**.

Do not solve this by adding language instructions to the generation prompt.

Do not make translation part of the LLM generation pipeline.

Implement translation as a reusable backend capability that accepts the already-generated JSON and returns a translated version.
