# Worksheet template selection (current generation flow)

How a template is chosen during worksheet generation. This document reflects the **current** code paths as of the traced implementation — not the older multi-template cycling behavior described in some legacy notes under `docs/worksheets/`.

## Source of truth (code)

| Concern | File |
| --- | --- |
| Pipeline orchestration | `src/modules/worksheets/services/worksheet-generation.service.ts` |
| Deterministic filter + rank + AI handoff | `src/modules/worksheets/services/worksheet-template-selection.service.ts` |
| LLM picker + fallbacks | `src/modules/worksheets/services/worksheet-template-selection-ai.service.ts` |
| Catalog load / meta parse / explicit lookup | `src/modules/worksheets/services/worksheet-template.service.ts` |
| Request validation | `src/modules/worksheets/services/worksheet-validation.service.ts` |
| Selection prompts + JSON schema | `src/modules/worksheets/constants/worksheet-prompt.constants.ts` |
| AI outcome types | `src/modules/worksheets/interfaces/worksheet-template-selection-ai.interfaces.ts` |
| Template `meta` shape | `src/modules/worksheets/types/worksheet.types.ts` → `WorksheetTemplateMeta` |
| HTTP entry | `src/modules/worksheets/worksheets.controller.ts` |
| Config | `src/config/configuration.ts` → `worksheets.templateSelectionAi` |

Worksheets do **not** use a flashcard-style `TemplateSelectionRule` table. Selection is:

1. Optional explicit `templateId` (id **or** slug), else
2. Filter `ACTIVE` templates by JSON `meta`, then
3. Rank by a deterministic score, then
4. Optionally ask an LLM to pick among survivors (with deterministic fallback).

There is **no hardcoded default template slug**.

---

## Where selection sits in generation

### HTTP entry points

| Endpoint | Service method | Selection |
| --- | --- | --- |
| `POST /worksheets/generate` | `WorksheetGenerationService.generate` | Runs `TEMPLATE_SELECTION` once via `select(dto)` |
| `POST /worksheets/generate-set` | `generateSet` → `generate` | **Same as generate** — one selection, then `count` structures on that template |
| `POST /worksheets/generate-set/stream` | Same as generate-set | Same selection behavior |

`generateSet` does **not** call `listMatching` and does **not** cycle different templates per item. It calls `generate(dto)` once; `dto.count` drives how many content structures are produced for the **single** selected template.

### Pipeline stages around selection

Inside `runGenerate`:

```text
REQUEST_VALIDATION
  → validateRequest(dto)   // need query | topic | templateId; age rules
REQUEST_ANALYSIS
  → content-restriction check + normalized request fields
TEMPLATE_SELECTION
  → templateSelectionService.select(dto, telemetry)
CONTENT GENERATION
  → contentService.generateStructures(template, dto, count, …)
IMAGE_RETRIEVAL
  → assetService.attachAssetsBatch(…, { templateSlug })
… compose HTML …
```

Selection telemetry `completeMetadata` records:

- `templateId`, `templateSlug`, `rendererType`, `category`
- `explicitTemplateId`
- `selectionMode`: `'explicit' | 'ai' | 'deterministic'`
- optional `aiConfidence`, `aiReasoning`, `aiFallbackReason`

The AI outcome is attached on the selected template object as a non-schema field `_aiOutcome` for that metadata only.

---

## Request contract that affects selection

From `GenerateWorksheetDto` / `GenerateWorksheetRequest`:

| Field | Role in selection |
| --- | --- |
| `templateId` | If non-empty after trim → **explicit** path (skip filter/rank/AI) |
| `query` | Not used in deterministic eligibility; passed to AI as primary intent |
| `topic` | Hard filter when `meta.topics` is non-empty; AI input; +8 score on exact match |
| `grade` | Hard filter when `meta.grades` is non-empty (with aliases); +10 score on **exact** match only |
| `subject` | Hard filter when `meta.subjects` is non-empty; +8 on exact match |
| `difficulty` | Hard filter when `meta.difficulty` is non-empty; +4 on exact match |
| `age` | Numeric age for range check vs `meta.ageMin`/`ageMax` |
| `ageGroup` | If `age` absent, first digit group (e.g. `"4-5"` → `4`) used as age |
| `count` | Does **not** change which template is selected; only how many worksheets/structures |

### Pre-selection validation

`WorksheetValidationService.validateRequest`:

- At least one of `query`, `topic`, or `templateId` must be present.
- If `age` is provided it must be a finite number ≥ 0.

Missing all three → `INVALID_REQUEST`.

---

## Path A — Explicit template

```text
dto.templateId trimmed non-empty
        │
        ▼
templateService.getActiveByIdOrSlug(idOrSlug)
        │
        ├── not found → 404 TEMPLATE_NOT_FOUND
        ├── status ≠ ACTIVE → 404 TEMPLATE_NOT_FOUND
        └── return template
```

Lookup matches **either** Prisma `id` **or** `slug`.

Important:

- Grade / subject / topic / age / difficulty are **not** checked.
- AI ranking is **not** invoked.
- Used when the UI picks a catalog template, or when a client forces a slug (e.g. `matching_single_letter`).

Telemetry: `selectionMode = 'explicit'`.

---

## Path B — Auto-select (`select`)

When `templateId` is omitted:

### B1. Load catalog

`templateService.listActive()`:

```ts
findMany({
  where: { status: 'ACTIVE' },
  orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
})
```

Inactive templates never enter the pool.

### B2. Eligibility (`isEligible`)

For each active template, parse `meta` via `parseMeta` → `WorksheetTemplateMeta`:

```ts
{
  grades?: string[];
  subjects?: string[];
  topics?: string[];
  ageMin?: number;
  ageMax?: number;
  difficulty?: string[];
}
```

Rules:

| Request | Meta | Behavior |
| --- | --- | --- |
| `grade` set | `grades[]` non-empty | Must match via `matchesGrade` (case-insensitive + **aliases**) |
| `subject` set | `subjects[]` non-empty | Exact case-insensitive membership |
| `topic` set | `topics[]` non-empty | Exact case-insensitive membership |
| `difficulty` set | `difficulty[]` non-empty | Exact case-insensitive membership |
| resolved age set | both `ageMin` and `ageMax` set | Age must be in `[ageMin, ageMax]` |

**Wildcards:** if a meta array is missing or empty, that dimension does **not** exclude the template. A template with `meta: {}` is eligible for every auto-select request (subject only to age range if both sides are set).

**Age resolution (`resolveAge`):**

1. Finite numeric `request.age`, else
2. First `(\d+)` in `ageGroup` (so `"4-5"` → `4`, not a full range overlap), else
3. No age filter.

Unlike flashcards, worksheet age is **not** a min–max band overlap against multiple supported groups.

#### Grade aliases (`matchesGrade`)

Used only for **eligibility**, not for score points. Examples:

| Request (normalized) | Also accepts on template |
| --- | --- |
| `fs0` / `nursery` | `fs0`, `nursery`, `pre-k`, `2-3` |
| `fs1` / `lkg` | `fs1`, `lkg`, `kg1`, `preschool`, `3-4` |
| `fs2` / `ukg` | `fs2`, `ukg`, `kg2`, `kindergarten`, `4-5` |
| `grade1` / `grade 1` | `grade 1`, `grade1`, `1st grade`, `class 1`, `5-6` |
| (same pattern for grade 2 / 3) | … |

If both sides are non-empty and neither exact nor alias match → template is ineligible.

If **no** template remains → `404 NO_TEMPLATE_FOUND` with `{ grade, subject, topic }` in the error payload.

### B3. Deterministic ranking (`score`)

Eligible templates are sorted:

```ts
eligible.sort((a, b) => score(b, request) - score(a, request));
```

Score starts at `0`. Points are added only when the request field is present **and** matches meta with **exact** case-insensitive equality (`includesInsensitive`) — **not** grade aliases:

| Match | Points |
| --- | --- |
| grade (exact string) | +10 |
| subject | +8 |
| topic | +8 |
| age inside `[ageMin, ageMax]` | +6 |
| difficulty | +4 |

Implications:

- A template eligible only via grade **alias** may score **0** for grade while still surviving the filter.
- Empty-meta templates often score `0`.
- Tie-break: modern JS `Array.sort` is stable, so equal scores keep `listActive` order → newer `updatedAt` first, then `id` asc. There is **no** explicit `updatedAt` comparator in `select`.

### B4. Single vs multiple candidates

| Eligible count | Behavior |
| --- | --- |
| `0` | `NO_TEMPLATE_FOUND` (already thrown) |
| `1` | Return that template. `_aiOutcome = { usedFallback: true, fallbackReason: 'single_candidate' }`. AI is **not** called. |
| `> 1` | Call `WorksheetTemplateSelectionAiService.select({ …, allowedTemplateIds })` |

### B5. AI pick or deterministic fallback

On AI success (`usedFallback === false` and `result.selectedTemplateId` is in the eligible set):

- Return that template.
- Telemetry `selectionMode = 'ai'`.

Otherwise:

- Return `eligible[0]` (highest deterministic score).
- Attach the AI outcome (including `fallbackReason`).
- Telemetry `selectionMode = 'deterministic'`.

---

## AI selection service (detail)

`WorksheetTemplateSelectionAiService.select` decides whether to call the LLM and validates the answer.

### Config (`worksheets.templateSelectionAi`)

| Key | Env (typical) | Default (code) |
| --- | --- | --- |
| `enabled` | `WORKSHEET_TEMPLATE_SELECTION_AI_ENABLED` | on unless `'false'` |
| `provider` | `WORKSHEET_TEMPLATE_SELECTION_PROVIDER` | `openai` (config); service treats non-openai as Gemini |
| `openaiModel` | `WORKSHEET_TEMPLATE_SELECTION_OPENAI_MODEL` | `gpt-4.1-mini` |
| `geminiModel` | `WORKSHEET_TEMPLATE_SELECTION_GEMINI_MODEL` | `gemini-2.5-flash` |
| `minConfidence` | `WORKSHEET_TEMPLATE_SELECTION_MIN_CONFIDENCE` | `0.5` |
| `timeoutMs` | `WORKSHEET_TEMPLATE_SELECTION_TIMEOUT_MS` | `6000` |
| cost knobs | `WORKSHEET_TEMPLATE_SELECTION_COST_PER_M_*` | used for usage accounting |

Also uses shared AI rate limit / circuit breaker settings (`ai.openaiMaxRps` / `ai.geminiMaxRps`, failure threshold, cooldown).

### Early fallbacks (no LLM call)

| `fallbackReason` | When |
| --- | --- |
| `disabled` | Feature flag off |
| `no_candidates` | Empty `allowedTemplateIds` |
| `single_candidate` | Only one allowed id (also short-circuited in parent for eligible.length === 1) |
| `missing_api_key` | Provider client not constructed |
| `circuit_open` | Circuit breaker open |

### LLM call shape

1. Reload **all** active templates and build a catalog block:

   ```text
   TEMPLATE CATALOG:
   [ { id, name, category, subjects, topics, difficulty, ageMin, ageMax }, … ]
   ```

2. User JSON:

   ```json
   {
     "topic": "...",
     "query": "...",
     "ageGroup": "...",
     "grade": "...",
     "subject": "...",
     "difficulty": "...",
     "allowedTemplateIds": ["…sorted…"],
     "promptVersion": "v1-worksheet-fit"
   }
   ```

3. System prompt: `WORKSHEET_TEMPLATE_SELECTION_SYSTEM_PROMPT` (`v1-worksheet-fit`) — select **one** id from `allowedTemplateIds` by educational intent (matching / coloring / tracing / sorting, etc.). Does **not** generate worksheet content.

4. Response must match the strict schema (`detectedIntent`, `selectedTemplateId`, `confidenceScore`, `reasoning`, `alternativeTemplateId`).

5. Post-checks:

   - Parse failure → `malformed_json`
   - `selectedTemplateId` ∉ allowed → `invalid_id`
   - `alternativeTemplateId` ∉ allowed → cleared to `null` (does not fail)
   - `confidenceScore < minConfidence` → `low_confidence`
   - Timeout / provider errors → `timeout` / `provider_error`

Successful picks record AI usage and optional pipeline AI telemetry (`PIPELINE_STORE_AI_PAYLOAD` gates storing prompt/response payloads).

The parent `select` only uses `selectedTemplateId`. (`alternativeTemplateId` is used by `listMatching` — see below.)

---

## `listMatching` (present, not on the generate path)

`WorksheetTemplateSelectionService.listMatching` still exists for a **wider** pool:

- Eligibility: `isEligibleForSet` = `ACTIVE` + **age range only** (ignores grade/subject/topic/difficulty).
- Sort by the same `score`.
- If multiple candidates, AI may reorder: push `selectedTemplateId` first, then `alternativeTemplateId`, then the rest; slice to `limit`.

**Current generation code does not call `listMatching`.**  
`generate` / `generateSet` always use `select`. Treat `listMatching` as a helper available for future multi-layout sets or other callers — not part of today’s generate pipeline.

---

## End-to-end diagrams

### Single / set generate without `templateId`

```text
POST /worksheets/generate(|-set)
        │
        ▼
validateRequest ──► need query | topic | templateId
        │
        ▼
content restriction (query/topic + country)
        │
        ▼
listActive (ACTIVE, updatedAt desc)
        │
        ▼
isEligible (meta filters + grade aliases + age)
        │
        ├── none ──► NO_TEMPLATE_FOUND
        ├── one  ──► that template (deterministic / single_candidate)
        └── many
              │
              ▼
         sort by score desc
              │
              ▼
         AI select(allowedTemplateIds)
              │
              ├── high-confidence valid id ──► that template (ai)
              └── fallback ──────────────────► eligible[0] (deterministic)
        │
        ▼
generateStructures(template, dto, count)
attachAssetsBatch(…, templateSlug)
compose HTML …
```

### Explicit `templateId`

```text
POST … { "templateId": "matching_single_letter" }
        │
        ▼
getActiveByIdOrSlug
        │
        ├── missing/inactive ──► TEMPLATE_NOT_FOUND
        └── template ───────────► generateStructures / assets / render
              (no meta filter, no AI)
```

---

## After selection (what does *not* re-select)

Once a template is chosen:

1. **Content LLM** uses that template’s `structureDefinition` / prompts (`WorksheetContentService`) — may include slug-specific prompt addenda (e.g. `number_names`, `tracing`, `matching_single_letter`).
2. **Assets** resolve image queries with `templateSlug` (e.g. lineart bias for some slugs).
3. **Renderer** is resolved by `rendererType` + slug aliases in `WorksheetRendererRegistry` (e.g. `circle_the_things` forced renderer; most layouts use `generic`).
4. Bad `structureDefinition` or invalid LLM JSON fails later (`INVALID_STRUCTURE` / `INVALID_LLM_OUTPUT`) — selection is **not** retried automatically.

---

## Failure modes (selection-related)

| Code | When |
| --- | --- |
| `INVALID_REQUEST` | No `query` / `topic` / `templateId`; invalid `age` |
| `TEMPLATE_NOT_FOUND` | Explicit id/slug missing or not `ACTIVE` |
| `NO_TEMPLATE_FOUND` | Auto-select: zero eligible active templates |

AI failures do **not** surface as HTTP errors by themselves; they downgrade to the deterministic top candidate.

---

## Catalog listing vs selection

`GET /worksheets/templates` → `listCatalog()` returns **all** active templates with parsed `meta` and sample URLs. It does **not** apply request filters. The UI can then send a chosen `id`/`slug` as `templateId` on generate (Path A).

---

## Contrast with flashcards (short)

| | Flashcards | Worksheets (current) |
| --- | --- | --- |
| Explicit id | Active template; age often still constrained elsewhere | Id **or slug**; must be `ACTIVE`; meta ignored |
| Rules | `TemplateSelectionRule` + synthetics | Template `meta` JSON only |
| Age | Band overlap / required more often | Optional; first number from `ageGroup` vs `ageMin`/`ageMax` |
| Topic | Soft / AI | Hard filter if `meta.topics` set |
| Multi-item generate | Can vary by rules | **One** template for the whole `count` batch |
| LLM | Optional re-rank | Optional re-rank among eligible survivors |
| Default template | None | None |

---

## Operational notes for template authors

To influence auto-select, set `worksheetTemplate.meta` carefully:

- Fill `grades` / `subjects` / `topics` / `difficulty` / `ageMin`/`ageMax` when the layout is specialized.
- Empty arrays / omitted keys = wildcards (easy to win on unconstrained requests via recency).
- Prefer grade labels consistent with aliases (`lkg`, `ukg`, `grade 1`, …) so eligibility matches UI values.
- `description` / `category` are shown to the selection LLM via the catalog (category + meta), so keep them accurate for intent matching (matching vs tracing vs coloring, etc.).
- Selection never reads `templateHtml`; layout fit is inferred from catalog text + allowed ids only.

---

## Related docs

- Older summary (partially stale on generate-set / `listMatching`): `docs/worksheets/WORKSHEET_TEMPLATE_SELECTION.md`
- Broader generation architecture: `docs/worksheets/WORKSHEET_GENERATION_ARCHITECTURE.md`
