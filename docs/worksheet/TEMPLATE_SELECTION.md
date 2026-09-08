# Worksheet template selection (three-stage)

How a template is chosen during worksheet generation.

**Pipeline:** Age hard-filter → Intent/difficulty classify + rerank → Select (margin or LLM).

## Source of truth (code)

| Concern | File |
| --- | --- |
| Pipeline orchestration | `src/modules/worksheets/services/worksheet-generation.service.ts` |
| Stage 1 filter + Stage 2 rerank + Stage 3 handoff | `src/modules/worksheets/services/worksheet-template-selection.service.ts` |
| Stage 2 classify + Stage 3 LLM picker | `src/modules/worksheets/services/worksheet-template-selection-ai.service.ts` |
| Age band helpers | `src/modules/worksheets/utils/age-band.util.ts` |
| FS0–FS2 taxonomy + scoring knobs | `src/modules/worksheets/constants/worksheet-template-taxonomy.constants.ts` |
| Selection / classify prompts + JSON schema | `src/modules/worksheets/constants/worksheet-prompt.constants.ts` |
| Catalog load / meta parse / explicit lookup | `src/modules/worksheets/services/worksheet-template.service.ts` |
| Request validation | `src/modules/worksheets/services/worksheet-validation.service.ts` |
| AI / telemetry types | `src/modules/worksheets/interfaces/worksheet-template-selection-ai.interfaces.ts` |
| Template `meta` shape | `src/modules/worksheets/types/worksheet.types.ts` → `WorksheetTemplateMeta` |
| Config | `src/config/configuration.ts` → `worksheets.templateSelectionAi` |

Worksheets do **not** use a flashcard-style `TemplateSelectionRule` table. There is **no hardcoded default template slug**.

---

## Where selection sits in generation

| Endpoint | Selection |
| --- | --- |
| `POST /worksheets/generate` | Runs `TEMPLATE_SELECTION` once via `select(dto)` |
| `POST /worksheets/generate-set` | Same — one selection, then `count` structures on that template |
| `POST /worksheets/generate-set/stream` | Same |

`generateSet` does **not** cycle different templates per item.

### Telemetry (`completeMetadata`)

- `templateId`, `templateSlug`, `rendererType`, `category`
- `explicitTemplateId`
- `selectionMode`: `'explicit' | 'ai' | 'deterministic'`
- `selectionReason` (e.g. `single_age_match`, `decisive_rerank_margin`, `ai_pick`, `ai_fallback_*`)
- `ageBand`, `ageFilteredCount`, `stage2Classification`, `rerankTopScores`, `scoreMargin`
- optional `aiConfidence`, `aiReasoning`, `aiFallbackReason`

Attached on the selected template as `_selectionTelemetry` / `_aiOutcome`.

---

## Request contract

| Field | Role |
| --- | --- |
| `templateId` | Non-empty → **Path A** (skip Stages 1–3) |
| `age` | Point age → Stage 1 band `[age, age]` |
| `ageGroup` | Parsed as **both** endpoints (e.g. `"4-5"` → `[4, 5]`), not first digit only |
| `grade` | Mapped to canonical age band when age/ageGroup absent (FS0→2–3, FS1→3–4, FS2→4–5, Grade1→5–6, …) |
| `query` / `topic` | Stage 2 classification input |
| `subject` / `difficulty` | Stage 2 scoring signals only (not hard filters) |
| `count` | Does not change which template is selected |

Validation still requires at least one of `query`, `topic`, or `templateId`.

---

## Path A — Explicit template

Unchanged: `getActiveByIdOrSlug` by id or slug. No age/meta filter, no AI. Templates missing `ageMin`/`ageMax` remain reachable this way.

Telemetry: `selectionMode = 'explicit'`.

---

## Path B — Auto-select (three stages)

### Stage 1 — Hard filter by age

1. Resolve request → `AgeBand { min, max, source }` via `resolveAgeBand`.
2. Load all `ACTIVE` templates.
3. For each template:
   - Missing/undefined `ageMin` or `ageMax` → log `TEMPLATE_MISSING_AGE_META`, **exclude** from auto-select (not a wildcard).
   - If request age band is resolvable → require inclusive overlap:
     `template.ageMin <= reqMax AND template.ageMax >= reqMin`.
   - If no request age/grade/ageGroup can be resolved → keep all templates that declare age meta (no overlap check).
4. Empty pool → `404 NO_TEMPLATE_FOUND` with `ageBand` in the error payload.
5. Exactly one survivor → return immediately (`selectionReason: single_age_match`). Skip Stage 2/3.

Grade/subject/topic/difficulty are **not** hard filters at this stage.

### Stage 2 — Classify intent, then rerank

Runs only on `ageFiltered`.

1. **Classify** (LLM, catalog-independent): `theme`, `subTopic`, `activityIntent`, `difficulty`, `confidence`.
   - FS0–FS2 age bands use the closed taxonomy in `worksheet-template-taxonomy.constants.ts`.
   - Grade 1+ uses free-form theme/subTopic; activity types still use the 15-item list.
   - On classify failure → empty classification with optional request `difficulty` / `topic` fallback.
2. **Rerank** every Stage 1 survivor (score starts at 0; no hard excludes):

| Signal | Points |
| --- | --- |
| `theme` / `subTopic` match (`meta.theme`, `meta.subTopics`, or legacy `meta.topics`) | +12 |
| `activityIntent` match `meta.activityType` | +10 |
| `subject` exact match | +8 |
| `grade` exact match (not alias) | +6 |
| `difficulty` match | +4 |

Tie-break: newer `updatedAt`, then `id` asc.

### Stage 3 — Select

- If top score ≥ second score + `MIN_SCORE_MARGIN` (6) **and** top score > 0 → return top (`decisive_rerank_margin`). No Stage 3 LLM.
- Else → Stage 3 LLM picker with `allowedTemplateIds` = **top N** by rerank (N=5), plus pre-computed `classification` hints.
- On any AI fallback (`disabled`, `no_candidates`, `single_candidate`, `missing_api_key`, `circuit_open`, `malformed_json`, `invalid_id`, `low_confidence`, `timeout`, `provider_error`) → return top of rerank list.

---

## `WorksheetTemplateMeta`

```ts
interface WorksheetTemplateMeta {
  grades?: string[];
  subjects?: string[];
  topics?: string[];        // backward compat / grade1–3
  theme?: string;           // FS0–FS2 closed vocabulary
  subTopics?: string[];
  activityType?: string[];  // 15-item activity taxonomy
  ageMin?: number;          // required for auto-select
  ageMax?: number;          // required for auto-select
  difficulty?: string[];
}
```

Stored in Prisma `WorksheetTemplate.meta` (JSON). Runtime guard enforces age for auto-select; no separate NOT NULL columns.

### Backfill scripts

| Script | Purpose |
| --- | --- |
| `scripts/backfill-worksheet-template-age-meta.ts` | Flag missing age; dry-run / `--apply` grade→age backfill |
| `scripts/suggest-worksheet-template-taxonomy.ts` | Review-only theme/subTopics/activityType suggestions (never writes) |

---

## Grade → age band (Stage 1)

| Stage | Age band |
| --- | --- |
| FS0 / Nursery / Pre-K | 2–3 |
| FS1 / LKG | 3–4 |
| FS2 / UKG | 4–5 |
| Grade 1 | 5–6 |
| Grade 2 | 6–7 |
| Grade 3 | 7–8 |

---

## What did not change

- Explicit `templateId` path
- Renderer / asset-attachment steps after selection
- `generateSet` “one template for the whole batch” behavior
