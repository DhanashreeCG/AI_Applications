# Template Selection Fix & Objective Normalization Prompt

Continue flashcard work in `D:/AI Team/AI_Applications`.

Primary context (read before touching code):
- `docs/asset-ingestion/HANDOFF_CONTEXT.md`
- `docs/flashcards/FLASHCARD_SELECTION_AND_GENERATION_CONTEXT.md`
- `docs/flashcards/TEMPLATE_SELECTION_DIAGNOSTIC_REPORT.md`
- `docs/flashcards/TEMPLATE_SELECTION_RANKING_BREAKDOWN.md`

---

## Scope Boundary (Read First)

This task touches **only** `template-selection.engine.ts` (ranking logic) and `TemplateSelectionRule` config/seed data. Do not modify:
- `user-request.resolver.ts` objective/keyword inference itself (already fixed per the diagnostic report — hit-count scoring + `OBJECTIVE_PRIORITY` tie-break are working as intended and are out of scope here)
- Prompt generation, LLM content service, content validator, image retrieval
- Pipeline tracker / observability
- API contracts (`GenerateFlashcardsResponse` stays unchanged)

If you find yourself editing outside `template-selection.engine.ts` + rule/seed config files, stop and flag it instead of proceeding.

---

## Root Cause (Verified Against Current Code)

The diagnostic breakdown showed `rule_obj_3_4_counting`, `rule_obj_3_4_phonics`, and `rule_obj_3_4_sorting` all scoring `objectiveRank=2000` (tier 2, "related objective") against a resolved objective of `comparison`.

### Actual Mechanism
`objectiveRelevance()` correctly checks `RELATED_OBJECTIVES`, but `rankTemplateCandidates()` evaluates:
```typescript
rawObjectiveRank = Math.max(templateObjectiveRank, ruleObjectiveRank);

```

When a rule explicitly filters for an unrelated objective (e.g., `rule.learningObjectives = ['counting']`), but its template defines generic/related objectives in `templateObjectives` (e.g., `['vocabulary', 'recognition']`), `Math.max` allows the explicitly mismatched rule to inherit Tier 2 or Tier 1 status from the underlying template!

This causes:

* Unrelated explicit rules tying with relevant rules at Tier 2.
* The `age_default` cap (`effectiveObjectiveRank` capped at 2) flattening the candidate pool, making unrelated rules win off arbitrary tie-breakers.

---

## Fix — Normalization & Objective Alias Expansion

Users submit diverse query phrasings (e.g., verbs, action phrases, variations). Ensure `normalizeObjective()` and synonym maps handle extended variations before tier evaluation:

### 1. Action Verbs & Query Variations Mapping

* **Counting / Math:** `count`, `counting`, `calculate`, `calculating`, `add`, `addition`, `sum`, `tally`, `amount`, `math_operations` → `counting`
* **Comparison / Sorting:** `compare`, `comparing`, `difference`, `bigger_smaller`, `sort`, `sorting`, `grouping`, `categorization` → `comparison` / `sorting`
* **Phonics / Reading:** `read`, `reading`, `reading_in_range`, `phonics`, `letters`, `sounds`, `pronunciation` → `phonics` / `reading`
* **Identification / Matching:** `identify`, `identification`, `find`, `spot`, `match`, `matching`, `pair` → `recognition` / `matching`
* **Question & Answer:** `q_and_a`, `qa`, `question_and_answer`, `quiz`, `ask` → `question_answer`

### 2. Normalization Cleanups

Ensure normalization handles hyphens, underscores, extra whitespace, case-insensitivity, and common inflectional suffixes (`-ing`, `-s`, `-ed`).

---

## Fix — `objectiveRank` Computation & Precedence

Correct the tier assignment logic in `template-selection.engine.ts`:

### 1. Rule Mismatch Gate

If `rule.learningObjectives` is non-empty and does **NOT** match or relate to the requested objective, the candidate rule's `ruleObjectiveRank` must be `0`. Explicit rule filters **must not** be overridden or boosted by generic `templateObjectives`.

### 2. Tier Calculation

```text
given: requestedObjective (normalized), candidate rule & template objectives

tier 3 (exact)   = matches requestedObjective exactly
tier 2 (related) = objective ∈ RELATED_OBJECTIVES[requestedObjective]
tier 1 (generic) = objective ∈ {'vocabulary', 'recognition', 'general_knowledge'}
                   AND tier 2 condition is false
tier 0 (none)    = explicitly configured for a non-matching, non-related objective

```

### 3. Effective Objective Rank

Apply the existing `age_default` cap:

```typescript
effectiveObjectiveRank = objectiveConfidence === 'age_default' 
  ? Math.min(rawObjectiveRank, 2) 
  : rawObjectiveRank;

```

Leave `objectiveExactBoost`, age/grade/subject/difficulty/version/priority/rule-id tie-breakers untouched.

---

## Fix — Rule Coverage Gaps (Data / Config Only)

1. Run (or create if missing) a diagnostic helper cross-referencing active templates' `supportedAgeGroups × learningObjectives` against `TemplateSelectionRule` rows.
2. Seed rule rows for unrepresented combinations following the `OBJECTIVE_RULE_SEEDS` pattern (e.g., `rule_obj_{ageMin}_{ageMax}_{objective}`).
3. Do not delete or restructure existing rule rows (additive only).

---

## Decisions Made on the Three Open Questions (Do Not Reopen)

1. **Topic-based ranking:** Stays content-only, not added to engine rules.
2. **Age hard filter:** Stays as template `supportedAgeGroups` overlap (not tightened to rule `ageMin`/`ageMax`).
3. **Consolidating overlapping objective rules:** Not needed; fixing tier computation resolves the issue without deleting rules.

---

## Validation

1. Run/emit diagnostics: `npm run flashcards:emit-diagnostics` (or run diagnostic spec via Jest).
2. Confirm fragile-pass count drops significantly and expected rules win (e.g., `rule_age_3_4_vocabulary` outranks `_counting`/`_phonics`/`_sorting` for vocabulary queries).
3. Add regression tests in `template-selection.diagnostic.spec.ts` covering:
* Verb variations (`count`, `calculate`, `reading in range`, `add`) resolving and ranking correctly.
* Unrelated explicit rule objectives receiving Tier 0 relative to requested objectives.


4. Run: `npx jest --testPathPatterns="template-selection.engine|user-request.resolver|template-selection.diagnostic" --no-coverage`
5. Run full suite: `npm test`

---

## Deliverables

1. Confirmed root-cause fix in `template-selection.engine.ts` with enhanced normalization.
2. Seeded rule rows for confirmed coverage gaps.
3. Updated `TEMPLATE_SELECTION_RANKING_BREAKDOWN.md` and `TEMPLATE_SELECTION_DIAGNOSTIC_REPORT.md`.
4. New regression unit tests in `template-selection.diagnostic.spec.ts`.
5. Short changelog entry in `FLASHCARD_SELECTION_AND_GENERATION_CONTEXT.md`.