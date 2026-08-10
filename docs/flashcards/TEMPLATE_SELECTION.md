Continue flashcard work in D:/AI Team/AI_Applications.

Primary context (read all three before touching code):
- docs/asset-ingestion/HANDOFF_CONTEXT.md
- docs/flashcards/FLASHCARD_SELECTION_AND_GENERATION_CONTEXT.md
- docs/flashcards/FLASH_CARD_REVISED.md

## Problem statement

TEMPLATE_SELECTION and the REQUEST_ANALYSIS stage feeding it are producing wrong or
low-confidence template picks. This is a two-part failure, not one bug — diagnose both
before fixing either:

1. CONTEXT RETRIEVAL (upstream of selection) — user-request.resolver.ts is deriving
   topic / objective / age / grade / subject / difficulty deterministically from
   keywords only. Any query that doesn't hit the keyword map falls through to the
   age-midpoint default (recognition / vocabulary / question_answer /
   general_knowledge), which is a weak signal for template ranking.

2. TEMPLATE SELECTION (template-selection.engine.ts) — ranking depends entirely on
   objective match quality (exact → related → generic). If (1) hands it a wrong or
   generic objective, ranking degrades to the related-objective fallback map or the
   generic tier, which is a much flatter signal and increases the chance of picking a
   template that's structurally valid but pedagogically wrong for the query.

Known aggravating factor from handoff notes: TemplateSelectionRule rows are NOT YET
SEEDED across the objective+age matrix, so many (objective, age) combinations only
have synthetic candidates (templates with no rule), which rank purely on the template's
own supportedAgeGroups/learningObjectives with no exact-age/grade/subject/difficulty
boosts available. This flattens the ranking further and increases ties.

## Diagnostic steps (do these first, report findings before changing behavior)

1. Instrument (temporarily, behind a debug flag or just structured logs) every stage
   output for a batch of real/representative queries:
   - raw query → resolved {topic, objective, ageGroup, grade, subject, difficulty, language}
   - candidate template list AFTER hard filter (age overlap + grades/subjects/difficulties)
   - each candidate's ranking score breakdown (objective tier, age/grade/subject/difficulty
     exact-match bits, templateVersion, rule priority, rule id) — not just the winner
   - final selected template id/name

2. Build a test set of 20-30 realistic queries covering:
   - queries that clearly hit a keyword ("compare X", "sort Y", "what sound does X make")
   - queries that DON'T hit any keyword and fall to age-midpoint default
   - queries with ambiguous/multiple keyword hits (e.g. "identify and count the animals"
     — hits both `recognition` and `counting`; resolver currently has no documented
     tie-break rule for this — find and fix it)
   - queries where age group is missing/inferred vs explicit
   - queries where objective is correctly inferred but ZERO templates have a
     TemplateSelectionRule for that (objective, age) pair — confirm these fall to
     synthetic-candidate ranking and check whether the winner is defensible

3. For each of the 20-30 cases, record: expected template (your judgment) vs actual
   selected template vs ranking score gap between #1 and #2 candidate. Small gaps
   (near-ties) are the real signal of an unreliable ranking, even when the top pick
   happens to be right today.

## Fix targets (implement after diagnostics confirm root cause, in this order)

### A. Objective inference (user-request.resolver.ts)
- Expand the keyword map — current lists are short and miss common phrasings
  (synonyms, plurals, verb forms, non-English keyword variants if `language` isn't
  English-only). Pull actual failing queries from diagnostics into the map.
- Add explicit tie-break rules for multi-keyword matches instead of relying on map
  iteration order (e.g. priority order of objectives, or count matched keywords per
  objective and take the max, with a documented deterministic tie-break for exact ties).
- Consider a confidence signal, not just a single objective string: return
  {objective, confidence: 'exact_keyword' | 'age_default'} so TEMPLATE_SELECTION can
  weight ranking differently when the input signal itself is weak (e.g. widen the
  related-objective search rather than trusting a shaky exact match).
- Do NOT introduce an LLM call here unless explicitly decided — this stage is
  documented as deterministic/no-LLM by design (auditability + cost). If keyword
  coverage genuinely can't scale, flag this as a design decision for the user rather
  than silently adding an LLM classification call.

### B. Rule coverage (data, not code)
- Generate a coverage report: cross every active template's supportedAgeGroups ×
  learningObjectives against existing TemplateSelectionRule rows. List every
  (objective, ageGroup) cell with zero matching rule — these are exactly the cases
  falling back to synthetic-candidate ranking.
- Seed TemplateSelectionRule rows to close the highest-traffic gaps first (use query
  logs / the test set from diagnostics to prioritize). This is config work per your
  own conventions doc ("new layouts should be template + selection-rule config, not
  orchestrator hardcoding") — don't let this turn into engine changes.

### C. Ranking engine (template-selection.engine.ts)
- Only touch this if diagnostics show correct objective/age input still producing
  wrong picks. Likely candidates:
  - Confirm the related-objective fallback map is symmetric/sane where it matters
    (e.g. does `comparison → classification` also make sense as
    `classification`'s fallback including `comparison`? Check both directions used
    in your test set.)
  - Confirm stable rule id as final tie-break is actually deterministic (not
    insertion-order-dependent if rule ids aren't sequential/stable across environments).
  - Confirm synthetic candidates (no rule) are scored on a scale genuinely comparable
    to rule-backed candidates — audit whether a template with no rule but a strong
    metadata match can ever legitimately outrank a rule-backed template with a weaker
    match, and whether that's intended.

### D. Observability going forward
- Persist the per-request ranking breakdown (not just the winner) into the pipeline
  tracker tables you already have for flashcards, gated behind
  PIPELINE_TRACKING_ENABLED / PIPELINE_STORE_AI_PAYLOAD-style flags. Without this,
  the next time selection "feels wrong" there's no data trail to diagnose from —
  which is the situation you're in right now.

## Deliverable

1. Diagnostic report (stage outputs + ranking breakdowns for the 20-30 test queries)
2. Root-cause summary: which of A/B/C is actually responsible, with evidence
3. Fix implementation, scoped to the confirmed root cause(s) only
4. Updated/expanded focused test suite:
   npx jest --testPathPatterns="template-selection.engine|user-request.resolver" --no-coverage
5. Rule-coverage seed script or migration for the gaps found in step B
6. Short note added to FLASHCARD_SELECTION_AND_GENERATION_CONTEXT.md documenting the
   tie-break rules added in A and any ranking-formula changes from C

Do not touch IMAGE_QUERY_GENERATION / IMAGE_RETRIEVAL or the Gemini content prompt —
those are downstream and out of scope for this task unless diagnostics show the wrong
template selection is itself causing bad image queries (in which case flag it, don't fix it here).

No commits unless explicitly requested.