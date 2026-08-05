# Template Selection Diagnostic Report

**Date:** 2026-08-05  
**Scope:** REQUEST_ANALYSIS → TEMPLATE_SELECTION for seeded flashcard catalog  
**Test harness:** `src/modules/flashcards/utils/template-selection.diagnostic.spec.ts` (20 cases)  
**Full ranking artifact:** [TEMPLATE_SELECTION_RANKING_BREAKDOWN.md](./TEMPLATE_SELECTION_RANKING_BREAKDOWN.md) (regenerate: `npm run flashcards:emit-diagnostics`)

---

## Root-cause summary

| Area | Finding | Evidence | Fix applied |
|---|---|---|---|
| **A. Objective inference** | First-match iteration order caused wrong picks on multi-keyword queries; bare `about`/`word` caused false positives | `"identify and count"` would pick first map entry hit; `"flashcards about animals"` matched `general_knowledge` via `about` | Keyword hit-count scoring + `OBJECTIVE_PRIORITY` tie-break; word-boundary matching; removed `about`/`word`; expanded synonym map; added `objectiveConfidence` |
| **B. Rule coverage** | Age-band rules existed but objective-specific boosts (comparison, phonics, counting, sorting) were missing — wrong-age templates won via overlap + exact objective on rule | `"Lion vs tiger"` @ 6-8 selected 5-6 fact template because `rule_obj_5_6_comparison` scored objective rank 3 without exact age | Added `OBJECTIVE_RULE_SEEDS` (8 rules); re-enabled empty-DB seeding; coverage script at `scripts/flashcards/template-rule-coverage.ts` |
| **C. Ranking engine** | Engine behaved as designed; failures were upstream (A) and data (B). One refinement: age-default objectives should not rank as exact tier | Vegetables @ 3-4 with no keywords correctly defaults to vocabulary, but weak signals should not dominate when age-default | Cap `effectiveObjectiveRank` at 2 when `objectiveConfidence === 'age_default'` |
| **D. Observability** | Only winner logged — no trail for near-ties | Handoff notes | `rankTemplateCandidates()` + pipeline metadata when `PIPELINE_STORE_AI_PAYLOAD=true` |

**Primary responsibility:** A + B (roughly 60% / 35%). C was a minor guardrail, not a formula rewrite.

---

## Fragile passes (12 / 20)

Cases where **#1 and #2 share the same `effectiveObjectiveRank`** (objective-tier gap `< 1`). The expected template still wins today, but the margin is tie-breaker-dependent — see the breakdown doc for every candidate, score components, and total score gap.

| Case | #1 rule | #2 rule | Shared tier | Total score gap |
|---|---|---|---|---:|
| no keyword age default vocabulary | rule_obj_3_4_comparison | rule_obj_3_4_counting | 2 | 0 |
| about noise word does not hijack objective | rule_obj_3_4_comparison | rule_obj_3_4_counting | 2 | 0 |
| quiz keyword | rule_obj_6_8_comparison | rule_age_6_8_qa | 3 | −30 |
| science facts | rule_obj_5_6_comparison | rule_obj_5_6_counting | 3 | 0 |
| recognition age default 2-3 | rule_age_2_3_recognition | rule_obj_3_4_comparison | 2 | 530 |
| match pairs | rule_obj_3_4_comparison | rule_obj_3_4_counting | 3 | 0 |
| classify categories | rule_obj_5_6_comparison | rule_obj_6_8_comparison | 3 | 600 |
| reading story | rule_obj_6_8_comparison | rule_age_6_8_qa | 3 | 10 |
| difference comparison phrasing | rule_obj_5_6_comparison | rule_obj_6_8_comparison | 3 | 600 |
| spot recognition | rule_age_2_3_recognition | rule_obj_3_4_comparison | 3 | 530 |
| grade 1 vegetables EVS | rule_obj_5_6_counting | rule_obj_5_6_comparison | 2 | 40 |
| vs comparison shorthand | rule_obj_6_8_comparison | rule_obj_5_6_comparison | 3 | 500 |

**Non-fragile (8):** compare keyword, sort keyword, phonics sound query, multi-keyword identify and count, how many counting, explicit phonics, group sorting phrasing, general knowledge age default 10-12.

Negative total score gap (e.g. quiz keyword: −30) means the winner has a **lower computed score** but wins on earlier sort keys (exact age, priority, rule id) — documented in the breakdown tables.

---

## OBJECTIVE_RULE_SEEDS deployment

| Path | Auto-applies objective rules? |
|---|---|
| Empty DB → first `FlashcardSeedService` boot | **Yes** — `ALL_RULE_SEEDS` includes 8 objective rules |
| DB already has templates | **No** — seed skipped; run `npm run flashcards:rule-coverage -- --apply` after confirmation |
| Staging / prod | **Not verified** — query `TemplateSelectionRule` for `rule_obj_%` ids before assuming coverage |

---

## Rule-id tie-break

Verified in `template-selection.diagnostic.spec.ts`: identical scores with rules `a_rule_early` vs `z_rule_late` always pick `a_rule_early`, regardless of input array order. Seed and `--apply` rules use stable string ids; see [FLASHCARD_SELECTION_AND_GENERATION_CONTEXT.md](./FLASHCARD_SELECTION_AND_GENERATION_CONTEXT.md) changelog for caveats on API-uploaded cuid rules.

---

## Tests

```bash
npm test                                          # full suite — 166 tests (verified 2026-08-05)
npx jest --testPathPatterns="template-selection.engine|user-request.resolver|template-selection.diagnostic" --no-coverage
npm run flashcards:emit-diagnostics               # regenerate ranking breakdown markdown
```

**`objectiveConfidence` consumer check:** Added to `ResolvedUserRequest` only. Orchestrator + template selection service read it; `GenerateFlashcardsResponse` unchanged — no API contract break.

---

## Remaining limitations (not in scope)

- No dedicated comparison / sorting / matching **layout templates** — related-objective fallback uses nearest age-appropriate vocabulary/Q&A layouts.
- Overlap age filtering still allows a 5-6 template to compete for 6-8 requests; objective rules with exact `ageMin`/`ageMax` are the intended mitigation until tighter hard filters are product-approved.
- Twelve fragile passes indicate overlapping objective rules on the same template — consider consolidating or raising objective-specific priority separation in a future config pass.
- Non-English query keywords not expanded in this pass.
- **Pending product decision:** whether `topic` should ever influence selection (documented in context doc; currently content-only).
