# Flashcard Generation Architecture

Template-driven pipeline: understand the request → select a layout template → generate educational content → retrieve images → assemble rendering-ready JSON.

---

## Design boundaries

| Owns | Does not own |
|---|---|
| Request analysis (deterministic) | Layout / styling / positioning |
| Template selection hard filter (deterministic) + LLM semantic rank among eligible templates | Inventing layouts / choosing ineligible templates |
| LLM educational content only | Image generation |
| Asset Library search (existing) | Duplicating search/embedding logic |
| Merge: template + content + assets | Frontend rendering (optional renderer is separate) |

The LLM never invents components. The selected template’s `layoutDefinition` is the output contract. Template *eligibility* (age/grade/subject/difficulty) stays deterministic; the LLM only ranks topical/pedagogical fit among already-eligible candidates, with deterministic fallback.

---

## System context

```text
                    ┌─────────────────────┐
                    │  Client / API       │
                    │  POST /flashcards/  │
                    │  generate           │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │ Flashcards Module   │
                    │ (NestJS)            │
                    │                     │
                    │  Orchestrator       │
                    │  ├─ Request resolve │
                    │  ├─ Template select │
                    │  ├─ Content (LLM)   │
                    │  ├─ Image retrieve  │  ← cards in parallel
                    │  └─ Assemble JSON   │  ← streamed per card
                    └─┬───────┬───────┬───┘
                      │       │       │
           ┌──────────▼─┐ ┌───▼────┐ ┌▼────────────────┐
           │ Postgres   │ │ Gemini │ │ Search / Asset  │
           │ Templates  │ │ (LLM)  │ │ Library (PGVec) │
           │ + Rules    │ │        │ │ + S3 assets     │
           └────────────┘ └────────┘ └─────────────────┘
```

External dependencies (unchanged by this module): Asset Library, Semantic Search, embeddings, S3 storage. Optional: Pipeline Execution Tracker (observability only).

---

## Module components

| Component | Role |
|---|---|
| `FlashcardsController` | HTTP: generate, generate/stream (NDJSON), list/upload templates, render, asset proxy |
| `FlashcardOrchestratorService` | End-to-end stage orchestration + telemetry + per-card progress callbacks |
| `user-request.resolver` | Deterministic topic / age / grade / subject / difficulty / objective |
| `TemplateSelectionService` + `template-selection.engine` | Hard filter + rank → one template (deterministic fallback) |
| `TemplateSelectionAiService` + `TemplateCatalogCacheService` | LLM semantic pick among hard-filtered candidates (cached catalog prefix) |
| `TemplateRepository` / `FlashcardTemplateService` | Persist & load templates and selection rules |
| `FlashcardContentService` | Prompt build → LLM → content validation |
| `FlashcardImageRetrievalService` | One search per image slot → top unused asset |
| `FlashcardRendererService` (optional) | HTML/WebP/PDF from assembled response |

---

## Data model (template system)

### `FlashcardTemplate`

Layout-only reusable definition. No educational content.

- Identity: `id`, `name`, `templateVersion`, `active`
- Pedagogy metadata: `supportedAgeGroups`, `supportedGrades`, `learningObjectives`, `subjectsSupported`, `difficultyLevels`
- Presentation metadata: `templateType`, `layoutType`, `pageSize`, `orientation`
- Contract: `layoutDefinition` (regions + editable components: text types and `image` slots)

### `TemplateSelectionRule`

Config-driven matching for deterministic selection (no hardcoded age→template chains).

- Links to one `templateId`
- Optional filters / boosts: `ageMin`/`ageMax`, `grades`, `subjects`, `learningObjectives`, `difficulties`, `priority`
- Empty arrays = wildcard
- Topic / intents do **not** select templates; topic only feeds content generation

Templates without rules remain selectable as synthetic metadata-only candidates.

---

## Template lifecycle (creation)

```text
Upload API (POST /flashcards/templates)
  → validate layout-only payload
  → persist FlashcardTemplate
  → (separately) attach TemplateSelectionRule rows for ranking coverage
  → active templates become candidates in TEMPLATE_SELECTION
```

Adding a new layout = new template (+ rules). No orchestrator / prompt / image-pipeline code changes if component types stay in the supported set.

---

## End-to-end generation flow

```text
REQUEST_VALIDATION
  → REQUEST_ANALYSIS
  → EDUCATIONAL_OBJECTIVE_DETERMINATION
  → TEMPLATE_SELECTION
  → LLM_CONTENT_GENERATION
      → PROMPT_GENERATION
      → LLM_REQUEST
      → CONTENT_VALIDATION
  → IMAGE_QUERY_GENERATION
  → IMAGE_RETRIEVAL
  → RESPONSE_ASSEMBLY
  → FINAL_VALIDATION
  → RESPONSE_RETURN
  → [optional] FLASHCARD_RENDERING
```

Bypass: if `templateId` is provided on the request, `EDUCATIONAL_OBJECTIVE_DETERMINATION` and `TEMPLATE_SELECTION` are skipped; the template loads by ID.

---

## Stage architecture

### 1. Request analysis

Deterministic (no LLM).

Input: `query`, `ageGroup`, optional `grade` / `subject` / `difficulty` / `language` / `count` / `templateId`.

Resolves: `topic`, age bounds, `grade`, `subject`, `difficulty`, `language`, `learningObjective`, `objectiveConfidence` (`exact_keyword` | `age_default`).

Objective comes from keyword rules (with multi-match tie-break), else age-midpoint defaults.

### 2. Template selection

Hard filter is deterministic; semantic ranking may use an LLM.

1. Load active rules (joined to active templates) + active templates without rules (synthetic candidates)
2. **Hard filter:** active; age-group overlap with `supportedAgeGroups`; rule `grades` / `subjects` / `difficulties` if non-empty
3. **AI semantic rank** (when `templateId` is omitted and AI is enabled): pass the full active template catalog as a **cached static prompt prefix**, plus a small dynamic suffix with `topic` / learner context / `allowedTemplateIds` (survivors of the hard filter). The model returns one id from `allowedTemplateIds` + confidence + reasoning. Prompt caching (OpenAI automatic prefix cache / Gemini implicit) keeps token cost low across requests. Selection-rule rows are **not** sent to the LLM — they already shaped `allowedTemplateIds`.
4. **Deterministic fallback:** if AI is disabled, returns an invalid/low-confidence id, times out, or errors, use the existing weighted rank (objective relevance → exact objective / age / grade / subject / difficulty → `templateVersion` → rule `priority` → score → stable rule id)
5. Return exactly one template; parse `layoutDefinition` → editable text + image component contracts

Telemetry: `TEMPLATE_SELECTION` stage metadata includes `selectionMode` (`ai` | `deterministic`), confidence/reasoning/fallback reason, `catalogHash`, and `cachedTokens`. Each AI call also writes an `AiUsage` row (`stage: flashcard_template_selection`) including `cachedInputTokens`.

### 3. Content generation

Selected template = LLM contract.

- Prompt injects learner profile + selected template ID/version/orientation + exact component IDs
- LLM returns JSON only: per-card `textComponents` and `imageComponents` (semantic search fields, never filenames or layout)
- Validator enforces exact card count, exact component IDs, no layout/styling fields; may regenerate invalid cards

### 4. Image retrieval

For each card × each image component independently:

1. Take that slot’s LLM-written `searchQuery` verbatim — never rewritten or expanded
2. Call the existing Search Service **once** (`limit` = `FLASHCARD_IMAGE_SEARCH_LIMIT`, default 8 ranked hits)
3. Claim the top-similarity asset not already used elsewhere in the set, so no image repeats across cards
4. Attach asset reference / signed URL; miss → `IMAGE_NOT_FOUND`, search failure after retries → `error`, neither fails the set

See [`FLASHCARD_IMAGE_RETRIEVAL.md`](./FLASHCARD_IMAGE_RETRIEVAL.md) for the full stage design.

### 5. Response assembly

Merge selected template + validated text + asset references into ordered components matching the template.

Output is rendering-ready JSON. Downstream renderer (if enabled) requires zero AI re-processing.

---

## Separation of concerns

```text
Presentation   → FlashcardTemplate.layoutDefinition (+ optional renderer)
Education logic → Request resolver + selection rules / engine
AI content     → LLM text + image search descriptions only
Assets         → Existing search + library (referenced, not generated)
```

---

## Primary code paths

| Concern | Path |
|---|---|
| Orchestration | `src/modules/flashcards/services/flashcard-orchestrator.service.ts` |
| Progressive stream | [`PROGRESSIVE_CARD_DELIVERY.md`](./PROGRESSIVE_CARD_DELIVERY.md), `POST /flashcards/generate/stream` |
| Request analysis | `src/modules/flashcards/utils/user-request.resolver.ts` |
| Template selection | `src/modules/flashcards/utils/template-selection.engine.ts` |
| AI template selection | `src/modules/flashcards/services/template-selection-ai.service.ts` |
| Template catalog cache | `src/modules/flashcards/services/template-catalog-cache.service.ts` |
| Templates / rules | `src/modules/flashcards/services/template.repository.ts` |
| Template upload | `src/modules/flashcards/services/flashcard-template.service.ts` |
| Prompt | `src/modules/flashcards/constants/flashcard-prompt.constants.ts` |
| Content | `src/modules/flashcards/services/flashcard-content.service.ts` |
| Content validation | `src/modules/flashcards/utils/llm-content.validator.ts` |
| Images | `src/modules/flashcards/services/flashcard-image-retrieval.service.ts` |
| Schema | `prisma/schema.prisma` (`FlashcardTemplate`, `TemplateSelectionRule`) |
