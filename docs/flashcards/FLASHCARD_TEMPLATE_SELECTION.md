# Flashcard template selection

How the generate-flashcards pipeline chooses a layout template. Source of truth is the code in:

- `src/modules/flashcards/services/flashcard-orchestrator.service.ts`
- `src/modules/flashcards/services/template-selection.service.ts`
- `src/modules/flashcards/utils/template-selection.engine.ts`
- `src/modules/flashcards/services/template.repository.ts`
- `src/modules/flashcards/services/template-selection-ai.service.ts`
- `src/modules/flashcards/utils/user-request.resolver.ts`

There is **no hardcoded default template id**. A template is either forced by `templateId`, or chosen from active templates that survive age (and optional rule) filters, then ranked, then optionally re-picked by an LLM among those survivors.

---

## Entry points

| Request | What happens |
| --- | --- |
| `POST /flashcards/generate` with `templateId` | Skip ranking and AI. Load that template if it exists and is `active`. |
| Same endpoint without `templateId` | Resolve query → rank candidates → optional AI pick among ranked ids → load winner |
| Empty `templateId` (`""`) | `400 INVALID_REQUEST` — field must be a non-empty string if sent |

Explicit selection uses `TemplateSelectionService.selectByTemplateId`. The template does **not** have to match the request age or objective. Inactive or missing ids fail (`404 NO_TEMPLATE_FOUND` or `409 TEMPLATE_VERSION_MISMATCH`).

---

## Inputs that feed auto-selection

`resolveUserRequest` runs first (`REQUEST_ANALYSIS`). Template ranking never sees the raw query except as derived fields.

### Age (required)

1. If `ageGroup` is sent, parse it (`"3-4"`, `"ages 3 to 4"`, en-dashes). Invalid format → `400 UNSUPPORTED_AGE`.
2. Else if grade is known (`grade` field or parsed from the query: Nursery, Preschool, KG, Grade N), use `GRADE_AGE_DEFAULTS`:

| Grade | Age band | Default difficulty |
| --- | --- | --- |
| Nursery | 2–3 | beginner |
| Preschool | 3–4 | beginner |
| KG | 4–5 | beginner |
| Grade 1 | 5–6 | beginner |
| Grade 2 | 6–7 | beginner |
| Grade 3 | 7–8 | intermediate |
| Grade 4 | 8–9 | intermediate |
| Grade 5 | 9–10 | intermediate |
| Grade 6 | 10–11 | advanced |
| Grade 7 | 11–12 | advanced |
| Grade 8 | 12–13 | advanced |

3. Else → `400` — provide `ageGroup` or a recognizable grade.

There is **no global default age**. Age is not optional for auto-selection.

### Learning objective

Keyword map on the query (`count`, `match`, `phonics`, …). Highest keyword-hit count wins; ties use `OBJECTIVE_PRIORITY` (phonics first, then counting, matching, …, general_knowledge last).

If **no** keyword hits, objective is an **age midpoint default** (`objectiveConfidence: 'age_default'`):

| Midpoint of age band | Default objective |
| --- | --- |
| ≤ 3 | `recognition` |
| ≤ 6 | `vocabulary` |
| ≤ 8 | `question_answer` |
| else | `general_knowledge` |

Age-default objectives are a **weak ranking signal**: exact/related objective scores are capped at tier 2 so an inferred label cannot dominate like a real keyword match.

### Difficulty (always set)

Order: request `difficulty` → keywords in query → grade table above → midpoint of age (`≤6` beginner, `≤10` intermediate, else advanced). Aliases: easy/basic/simple → beginner; medium/moderate → intermediate; hard/difficult/challenging → advanced.

### Subject

Request `subject`, else keywords in query. May stay `null`. Null does **not** hard-fail a rule that lists subjects.

### Topic

Stripped from the query (noise words, ages, grades, difficulty, subject words). **Topic is not a hard filter.** It is passed to the AI selector for semantic fit among templates that already passed age/rule filters.

---

## Candidate pool (not a single “default” template)

`TemplateRepository.listActiveSelectionRules`:

1. Load every **active** `TemplateSelectionRule` whose template is **active**.
2. For every **active** `FlashcardTemplate` that has **no** rule, append a **synthetic rule**:
   - id `synthetic-{templateId}`
   - `priority: 50`
   - empty rule-level grades / subjects / objectives / difficulties (wildcards)
   - template metadata (`supportedAgeGroups`, `learningObjectives`, …) used for age support and objective ranking

So every active template can be selected even with zero rule rows. Synthetic rules are the coverage fallback, not a named default template.

If there are no active rules **and** no active templates, selection throws `404 NO_TEMPLATE_FOUND`.

---

## Hard filters (deterministic)

A candidate is dropped if:

- Template is inactive.
- Template `supportedAgeGroups` is non-empty **and** does not overlap the requested age band. Empty `supportedAgeGroups` = **legacy wildcard**: still eligible, never counts as exact age.
- Rule lists grades / subjects / difficulties **and** the request supplies that field **and** it does not match (case-insensitive; difficulty aliases). Empty rule lists = wildcard. Missing request field when the rule lists values = **pass but not exact** (so age-only requests still resolve).

- Template has `requiresExplicitRequest = true` **and** the raw `query` + `topic` contain none of its trigger terms. See below.

Learning objective is **not** a hard gate. A phonics request can still keep a vocabulary-only rule in the pool and rank it lower.

**Topic / intents on the rule are unused** in the current engine, apart from the opt-in gate below.

### Opt-in templates (`requiresExplicitRequest`)

Some layouts teach a mechanic rather than a topic — letter/digit tracing,
handwriting drills. They must never win on generic requests, so they are
excluded from the ranked pool unless the user's own words ask for them.

- `FlashcardTemplate.requiresExplicitRequest` turns the gate on.
- `FlashcardTemplate.explicitRequestKeywords` lists the unlocking terms.
  Matching is whole-word (multi-word entries match as phrases) against
  `query` + `topic`. When the list is empty, the template's `tags` +
  `templateType` are used instead, so a newly flagged template is never
  permanently unreachable.
- Both fields can be set at upload time.
- Because the gate runs before ranking, gated ids never enter
  `allowedTemplateIds`, so the AI selector cannot pick them. The catalog also
  exposes `requiresExplicitRequest` and the prompt treats those templates as
  off by default (defense in depth).
- Explicitly passing `templateId` bypasses selection entirely and is therefore
  unaffected.

Seeded gates: the digit-tracing layout unlocks on tracing/handwriting/number/
digit terms; the alphabet-tracing layout unlocks on tracing/handwriting/letter/
alphabet/phonics terms.

---

## Deterministic ranking

Survivors get a score, then a **lexicographic sort** (score is a tie-break, not the only order):

1. Effective objective rank (3 exact → 2 related → 1 generic fallback → 0)
2. Exact objective on the **rule** (or template objectives if the rule has none — synthetic case)
3. Exact age (template age-group exact match **or** rule `ageMin`/`ageMax` equal to request)
4. Exact grade
5. Exact subject (rule or template subjects)
6. Exact difficulty (rule or template difficulties)
7. Newer `templateVersion` (semver-like numeric parts)
8. Higher rule `priority`
9. Higher numeric `score`
10. Stable `ruleId` ascending

Numeric score (for telemetry and last-resort ties):

| Component | Points |
| --- | --- |
| `effectiveObjectiveRank * 1000` | 0 / 1000 / 2000 / 3000 |
| Exact age | +500 |
| Exact grade | +300 |
| Exact subject | +200 |
| Exact difficulty | +100 |
| Rule priority | +priority |
| Exact rule objective | +120 |
| Exact template objective only (no rule objectives) | +80 |
| Rule/template has objectives but none exact | −40 |

Related objectives (tier 2) come from `RELATED_OBJECTIVES` (e.g. comparison ↔ classification/matching). Generic fallbacks (tier 1) are templates tagged `vocabulary`, `recognition`, or `general_knowledge`.

The first row after this sort is the **deterministic winner**.

---

## AI re-rank (optional)

After ranking, `TemplateSelectionAiService` may pick among **unique ranked template ids**.

AI is skipped (deterministic winner kept) when:

| `fallbackReason` | Meaning |
| --- | --- |
| `disabled` | `flashcards.templateSelectionAi.enabled` is false |
| `no_candidates` | Empty allow-list |
| `single_candidate` | Only one template survived — no choice to make |
| `missing_api_key` | Provider client not configured |
| `circuit_open` | Circuit breaker open |
| `malformed_json` | Model output not parseable |
| `invalid_id` | Model returned an id not in the allow-list |
| `low_confidence` | `confidenceScore` below `minConfidence` (config default **0.5**) |
| timeout / provider errors | Treated as fallback |

When AI succeeds, the ranked candidate whose `templateId` equals the model’s id becomes the winner (`selectionMode: 'ai'`). If that id is not in the ranked list, the deterministic winner stays.

The LLM must not invent layouts; it only chooses among already-eligible templates. Topic and template description/type/structure matter here; age eligibility was already decided.

If the loaded template was deactivated between rank and fetch, orchestrator **retries selection once**.

---

## What “default” means in this pipeline

| Phrase | Actual behavior |
| --- | --- |
| Default template | **None.** No reserved id. Winner is always rank (or AI among ranked). |
| Default age | Only via **grade** → `GRADE_AGE_DEFAULTS`. No age + no grade → error. |
| Default objective | Age-midpoint labels when the query has no objective keywords. Ranked weaker (`age_default`). |
| Default difficulty | Grade table, else age midpoint. |
| Default language | `English` if not in request or query. |
| Default card count | `5` (`DEFAULT_FLASHCARD_COUNT`) — unrelated to which template is used. |
| Synthetic rule | Template with no `TemplateSelectionRule` still competes using its own age/objective metadata, priority 50. |
| Wildcard metadata | Empty lists on rules/templates do not exclude the candidate. |

---

## Failure modes

| Code | When |
| --- | --- |
| `UNSUPPORTED_AGE` | Bad/missing age; grade with no table entry |
| `NO_TEMPLATE_FOUND` | No active templates/rules, or none pass age/rule filters, or selected id disappeared |
| `TEMPLATE_VERSION_MISMATCH` | Winner (or explicit id) is inactive |
| `INVALID_REQUEST` | Missing query, empty `templateId`, bad `count` |

---

## Flow (auto-select)

```text
query + optional ageGroup/grade/subject/difficulty
        │
        ▼
resolveUserRequest  (age required; objective/difficulty defaults as above)
        │
        ▼
active rules + synthetic rules for templates without rules
        │
        ▼
hard filter: active + age overlap + optional grade/subject/difficulty
        │
        ▼
rank (objective → exact age/grade/subject/difficulty → version → priority)
        │
        ├── 0 survivors → 404
        ├── 1 survivor  → that template (AI skipped)
        └── 2+ survivors → AI may override if enabled, valid id, confidence ≥ min
                else deterministic #1
```
