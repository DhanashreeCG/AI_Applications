# Worksheet Generation Architecture

Worksheet generation lives in the existing NestJS backend (`src/modules/worksheets`). It follows the flashcard pipeline: template → Gemini content → semantic asset search → trusted renderer → Playwright.

## Architecture

```text
POST /worksheets/generate or POST /worksheets/generate-set
        ↓
validate request & safety checks (before any LLM call)
        ↓
template selection (explicit ID bypasses AI, else deterministic filter + AI picker)
        ↓
1 SINGLE Gemini LLM call for content generation (generates up to requested count with diverse content & exercises)
        ↓
concurrent structure validation for all generated worksheet items
        ↓
batch in-memory query deduplication & concurrent SearchService (pgvector) → assetId per imageQuery slot
        ↓
parallel persistence via Prisma transaction (all worksheets saved concurrently)
        ↓
parallel preview HTML assembly & response return
```

```text
POST /worksheets/:id/edit
        ↓
editable field check (aiConfig.editableFields)
        ↓
Gemini replacement JSON
        ↓
validate + optional imageQuery re-search
        ↓
persist
```

```text
POST /worksheets/:id/render  { "format": "html" | "webp" | "pdf" }
        ↓
trusted renderer registry (TypeScript, never JS from DB)
        ↓
HTML
        ↓
Playwright BrowserPoolService (shared with flashcards) for webp/pdf
        ↓
S3 (WorksheetOutput.storageKey)
```

## Database models

| Model | Role |
| --- | --- |
| `WorksheetTemplate` | Trusted HTML + JSON config. No generated content. No executable renderer code. |
| `Worksheet` | One generated instance: original request + structure (content + assetIds). |
| `WorksheetOutput` | Pointer to rendered HTML/WebP/PDF in S3. |

Statuses: template `DRAFT | ACTIVE | INACTIVE`. worksheet `GENERATED | RENDERING | COMPLETED | FAILED`. output `HTML | WEBP | PDF`.

Binary images stay in S3 via the existing `Asset` table. `backgroundAssetId` / `sampleAssetId` are optional asset id strings, not blobs.

## Template structure

Templates are created with `POST /worksheets/templates` (multipart, including background + example images). There is no template list/update/delete API in this MVP, and templates are not seeded.

Useful JSON columns:

- `structureDefinition` — JSON Schema the LLM output must match
- `meta` — selection hints (`grades`, `subjects`, `topics`, `ageMin`, `ageMax`, `difficulty`)
- `aiConfig` — `{ "editableFields": ["instruction", "items"], "linkedFields": { "instruction": ["title"] } }`
- `fieldPrompts` — per-field edit guidance
- `aiSystemPrompt` — edit system prompt
- `rendererConfig` — `{ "width": 794, "height": 1123 }`
- `rendererType` — must match a NestJS registry entry (`generic` for MVP)

Placeholders in `templateHtml` (generic renderer):

- `{{instruction}}` — HTML-escaped text (case-insensitive; `{{TOPIC}}` also matches `topic`)
- `{{#items}} ... {{/items}}` — array loop
- `{{@index}}` — 1-based index in a loop
- `{{assetUrl}}` — same-origin proxy URL injected at render time from `assetId` (never stored)
- `{{IMAGE:main_image}}` or `<img data-image-slot="main_image" />` — generic image slot
- `{{BACKGROUND_IMAGE}}` / `{{backgroundAssetUrl}}` — static template background
- `{{BODY_CLASS}}` — `editor-mode` or `export-mode`

Do not persist `signedUrl`, `imageUrl`, or `assetUrl` on `Worksheet.structure`. Persist `imageQuery` + `assetId`. URLs are resolved at preview/render.

`GET /worksheets/:id/preview?mode=editor|export` returns the same HTML Playwright uses, plus `canvas` (`rendererConfig.width/height`, default 1016×1316), normalized `editableFields` (`type`, `path`, `editable`, `aiEditable`), and `fieldPrompts` separately.

Editor page: `/worksheet-editor.html?id=<worksheetId>` loads template HTML in an iframe and scales the canvas visually. Image replacement uses `GET /worksheets/:id/images/search` and `POST /worksheets/:id/images`.

## Example template row

Insert manually (do not run this in production automatically):

```sql
INSERT INTO "WorksheetTemplate" (
  "id", "name", "slug", "category", "description", "status", "version",
  "templateHtml", "structureDefinition", "meta", "rendererType",
  "rendererConfig", "aiConfig", "fieldPrompts", "aiSystemPrompt",
  "createdAt", "updatedAt"
) VALUES (
  'cworksheettemplate0001',
  'Counting Objects',
  'counting_objects_v1',
  'numeracy',
  'Count pictured objects and write the number.',
  'ACTIVE',
  1,
  '<!DOCTYPE html><html><body><h1>{{instruction}}</h1>{{#items}}<section><img src="{{assetUrl}}" alt="{{imageQuery}}" /><p>{{@index}}. Count: {{count}}</p></section>{{/items}}</body></html>',
  '{
    "type": "object",
    "required": ["instruction", "items"],
    "additionalProperties": false,
    "properties": {
      "instruction": { "type": "string", "minLength": 1, "maxLength": 200 },
      "items": {
        "type": "array",
        "minItems": 4,
        "maxItems": 4,
        "items": {
          "type": "object",
          "required": ["count", "imageQuery"],
          "additionalProperties": false,
          "properties": {
            "count": { "type": "integer", "minimum": 1, "maximum": 10 },
            "imageQuery": { "type": "string", "minLength": 1, "maxLength": 120 }
          }
        }
      }
    }
  }'::jsonb,
  '{
    "grades": ["LKG", "UKG"],
    "subjects": ["Math"],
    "topics": ["Counting"],
    "ageMin": 3,
    "ageMax": 6,
    "difficulty": ["easy", "medium"]
  }'::jsonb,
  'generic',
  '{ "width": 1016, "height": 1316 }'::jsonb,
  '{ "editableFields": ["instruction", "items"] }'::jsonb,
  '{ "instruction": "Keep the instruction to one short sentence." }'::jsonb,
  'You edit a single worksheet field. Return JSON {"value": ...} only. No HTML.',
  NOW(),
  NOW()
);
```

`assetId` is added after search; it is an allowed enrichment key even when `additionalProperties` is false.

## Renderer architecture

`WorksheetRendererRegistry` maps `rendererType` → TypeScript class.

MVP registers `generic` only (`GenericWorksheetRenderer`). Add a specialized class later only if a template cannot be expressed with placeholders.

Never store or `eval` `renderer.js` from PostgreSQL.

## Gemini contract

Generation returns JSON matching `structureDefinition`. Image slots use `imageQuery` (visual description), never filenames or S3 URLs.

Edit returns `{"value": <replacement>}` for one field.

Calls reuse `GEMINI_API_KEY`, `ai.geminiMaxRps`, and `AiUsageService`. No second Google Cloud project/client stack.

## Asset retrieval

`imageQuery` → existing `SearchService` (OpenAI embedding + pgvector). One best asset per slot (`WORKSHEET_IMAGE_SEARCH_LIMIT`, default 1). Concurrency follows `WORKSHEET_IMAGE_CONCURRENCY` (falls back to flashcard image concurrency).

Render uses `GET /worksheets/assets/:assetId/image` (same-origin, reuses flashcard `AssetImageService` + S3 download).

The teacher UI is `/worksheets.html` (Toondemy LMS shell). Generate uses topic + age group, then a card grid with favourite / preview / download. Preview loads template HTML in an iframe (`GET /preview`) with Edit, AI Edit, and Playwright PNG/PDF download.

## Matching Templates & Shuffling

For matching templates like `number_names`, the generation process relies on `pairs[]` within the structure definition.
- **Positions**: The absolute positions of the left and right items are generated dynamically by `positionMatchingPairItems` based on `layout` properties (e.g. `start_top`, `number_left`, `name_left`, `row_height`). If absent, template-specific defaults are applied.
- **Shuffling**: To ensure the generated output is a genuine matching puzzle, the values on the right side (names) are subjected to a deterministic shuffle (`Math.sin`-based stable sort on indices). This scrambles their visual order in the DOM without destroying the underlying logical mapping of pairs required for grading.

## APIs

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/worksheets/templates` | Create a template; upload `background` + `sample`/`example` images to S3 |
| POST | `/worksheets/generate` | Create worksheet structure |
| POST | `/worksheets/:worksheetId/edit` | Edit one editable field |
| POST | `/worksheets/:worksheetId/render` | `html` / `webp` / `pdf` (`mode`: `editor` \| `export` for html) |
| GET | `/worksheets` | Paginated generated worksheets for the results grid |
| GET | `/worksheets/templates` | Active template catalog (sample thumbnail URLs) |
| POST | `/worksheets/generate-set` | Generate one worksheet per matching template (max 10) |
| GET | `/worksheets/:worksheetId/preview` | Resolved HTML + editor metadata |
| GET | `/worksheets/:worksheetId/images/search` | Semantic image picker results |
| POST | `/worksheets/:worksheetId/images` | Set `assetId` on an image slot |
| POST | `/worksheets/:worksheetId/fields` | Direct text field update (no Gemini) |

Swagger: `/api`.

### Generate example

```json
{
  "grade": "LKG",
  "age": 5,
  "subject": "Math",
  "topic": "Counting",
  "difficulty": "easy",
  "language": "English"
}
```

Optional: `query`, `templateId` (id or slug).

### Edit example

```json
{ "field": "instruction", "instruction": "Make this shorter for a 4-year-old." }
```

or `{ "fieldPath": "items[0].imageQuery", "instruction": "Use grapes." }`

### Render example

```json
{ "format": "pdf" }
```

`html` returns markup. `webp`/`pdf` upload to S3 under `worksheets/rendered/{worksheetId}/` and return a signed `uri`.

Templates can be inserted with `POST /worksheets/templates` (multipart: fields + `background` and `sample` image files). That uploads both images to S3, creates `Asset` rows, and stores `backgroundAssetId` / `sampleAssetId`. You can still insert rows manually if needed.

## Manual template insertion

1. Apply migration `20260814120000_worksheet_models`.
2. Insert an `ACTIVE` `WorksheetTemplate` row (example above).
3. Call `POST /worksheets/generate`.
4. Call edit/render with the returned `id`.

Do not copy the prototype `templates/` folder into this repo.
