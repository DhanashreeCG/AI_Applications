# Worksheet template selection

How generate-worksheet chooses a template. Source of truth:

- `src/modules/worksheets/services/worksheet-template-selection.service.ts`
- `src/modules/worksheets/services/worksheet-template.service.ts`
- `src/modules/worksheets/services/worksheet-generation.service.ts`
- `src/modules/worksheets/services/worksheet-validation.service.ts`

Worksheets do **not** use selection rules, synthetic rules, or an LLM picker. Selection is: optional explicit id/slug, else filter active templates by `meta`, then highest score.

There is **no hardcoded default template**. If several templates score the same, JavaScript’s stable sort keeps `listActive` order: `updatedAt` descending, then `id` ascending — so the most recently updated eligible template wins ties.

---

## Entry points

| API | Selection |
| --- | --- |
| Generate one worksheet | `WorksheetTemplateSelectionService.select` |
| Generate a set (`count` worksheets) | `listMatching` first; each item then generated with that template’s id |

Request validation (`validateRequest`): at least one of `query`, `topic`, or `templateId` must be non-empty. `age` if present must be a finite number ≥ 0.

---

## Explicit template (`templateId`)

If `templateId` is a non-empty string after trim:

- Lookup is **id or slug**: `getActiveByIdOrSlug`.
- Status must be `ACTIVE`.
- **No** grade / subject / topic / age check.
- Ranking is skipped.

Missing or inactive → `404 TEMPLATE_NOT_FOUND`.

This path is used for:

- UI “use this catalog template”
- Each item in a generate-set (after matching, generate is called with `templateId` set)

---

## Auto-select one worksheet (`select`)

When `templateId` is omitted:

1. Load all templates with `status = ACTIVE` (`listActive`).
2. Keep those that pass `isEligible`.
3. If none → `404 NO_TEMPLATE_FOUND` (payload includes grade/subject/topic).
4. Sort by `score` descending.
5. Return `eligible[0]`.

### Eligibility (`isEligible`)

Inactive templates never appear in `listActive`. Remaining checks use JSON `meta` on the template (`WorksheetTemplateMeta`):

| Request field | Meta field | Rule |
| --- | --- | --- |
| `grade` | `grades[]` | If **both** are non-empty, request must be in the list (trim, case-insensitive). |
| `subject` | `subjects[]` | Same |
| `topic` | `topics[]` | Same |
| `difficulty` | `difficulty[]` | Same |
| age | `ageMin` + `ageMax` | If request age **and** both meta bounds are set, age must fall in `[ageMin, ageMax]`. |

**Wildcards:** empty or missing meta arrays do **not** exclude the template. Empty `grades` means “any grade.” Templates with empty `meta` (`{}`) are eligible for every request that only fails on filled constraints — including a request with no grade/subject/topic/age at all.

Age for the request:

1. Numeric `age` if finite.
2. Else first digit group in `ageGroup` (e.g. `"3-4"` → `3`, `"ages 5"` → `5`).
3. Else no age filter.

Unlike flashcards, worksheet `ageGroup` is **not** parsed as a full min–max overlap. Only the first number is used, and it is compared to the template’s numeric range.

### Score (`score`) — ranking, not eligibility

Start at `0`. Add only when the request field is present **and** matches meta:

| Match | Points |
| --- | --- |
| grade | +10 |
| subject | +8 |
| topic | +8 |
| age inside `[ageMin, ageMax]` | +6 |
| difficulty | +4 |

A template that is eligible only because its meta is empty scores **0**. Among several 0-score templates, the newest `updatedAt` wins.

There is no version / priority / objective dimension. Topic **does** affect worksheets (hard filter when `meta.topics` is set, and +8 on match). Flashcards deliberately do not use topic as a hard filter.

---

## Generate-set (`listMatching`)

Used when generating several worksheets in one call.

- Pool: active templates that pass `isEligibleForSet` — **ACTIVE** plus **age range only** (if request age and meta bounds exist). Grade, subject, topic, and difficulty are **ignored** for set eligibility so the set can vary layouts.
- Sort by the same `score` as single select (so grade/subject/topic still influence **order**).
- Take the first `limit` (`count`, at least 1).
- If that list is empty, fall back to `select(dto)` (full eligibility, including explicit `templateId` if the client sent one).
- Generate `count` items by cycling the pool (`pool[index % pool.length]`). Each generate call sets `templateId` so selection is not re-run.

`listMatching` itself does **not** honor `templateId`. Passing `templateId` on generate-set only matters if the matching pool is empty and the fallback `select` runs.

---

## Catalog vs generate

`GET` templates (`listCatalog`) lists **all active** templates with parsed `meta` and sample image URLs. It does not apply request filters. The UI can still send a chosen `id`/`slug` as `templateId` on generate.

---

## What “default” means here

| Phrase | Actual behavior |
| --- | --- |
| Default template | **None.** No reserved slug or id. |
| Unconstrained request | Every active template is eligible; winner is highest score, then newest `updatedAt`. |
| Empty meta | Treat as wildcard (always eligible for auto-select). Often wins only when nothing else matches, via recency. |
| Default age | None. Age is optional. `ageGroup` contributes only its first integer. |
| Default language | `'English'` in request-analysis telemetry if omitted — not used in template matching. |
| Generate-set fallback | If age-only matching finds nobody, use single `select` (stricter filters or explicit id). |

---

## Failure modes

| Code | When |
| --- | --- |
| `INVALID_REQUEST` | No query, topic, or templateId; invalid `age` |
| `TEMPLATE_NOT_FOUND` | Explicit id/slug missing or not `ACTIVE` |
| `NO_TEMPLATE_FOUND` | Auto-select: no active template passed `isEligible` |

After selection, generation still uses that template’s HTML + `structureDefinition`. A bad structure is a later-stage error, not a selection retry.

---

## Flow (single generate, no `templateId`)

```text
query / topic / grade / subject / difficulty / age / ageGroup
        │
        ▼
ACTIVE worksheet templates
        │
        ▼
drop if meta lists a dimension the request fails
drop if age outside meta.ageMin–ageMax (when both sides present)
        │
        ├── none → 404 NO_TEMPLATE_FOUND
        └── score: grade 10, subject 8, topic 8, age 6, difficulty 4
                sort desc; ties → updatedAt desc
                take first
```

## Contrast with flashcards (short)

| | Flashcards | Worksheets |
| --- | --- | --- |
| Explicit id | Must exist and be active; age ignored | Id **or slug**; must be ACTIVE; meta ignored |
| Rules table | `TemplateSelectionRule` + synthetic rules | Template `meta` JSON only |
| Age | Required (or grade defaults); overlap with `supportedAgeGroups` | Optional; first number vs `ageMin`/`ageMax` |
| Topic | Not a hard filter; AI semantic pick | Hard filter if `meta.topics` set |
| LLM | Optional re-rank among survivors | None |
| Objective | Primary rank signal | Not used |
| Default template | None | None |
