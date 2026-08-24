# Flashcard Template Selection & AI Generation Context

Operational reference for how the flashcard pipeline selects a template, prompts Gemini, validates content, and retrieves images.

Primary code paths:

- Orchestrator: `src/modules/flashcards/services/flashcard-orchestrator.service.ts`
- Request analysis: `src/modules/flashcards/utils/user-request.resolver.ts`
- Template selection: `src/modules/flashcards/utils/template-selection.engine.ts`
- Rules/templates load: `src/modules/flashcards/services/template.repository.ts`
- Prompt builder: `src/modules/flashcards/constants/flashcard-prompt.constants.ts`
- Content service: `src/modules/flashcards/services/flashcard-content.service.ts`
- Content validation: `src/modules/flashcards/utils/llm-content.validator.ts`
- Image retrieval: `src/modules/flashcards/services/flashcard-image-retrieval.service.ts`

---

## End-to-end pipeline

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
```

The backend never generates layout, styling, positioning, or filenames. It returns rendering-ready JSON: selected template + educational text + asset references.

---

## 1. Request analysis (deterministic, no LLM)

Input (`POST /flashcards/generate`):

```json
{
  "query": "Compare fruits",
  "ageGroup": "3-4",
  "count": 5,
  "grade": "optional",
  "subject": "optional",
  "difficulty": "optional",
  "language": "optional"
}
```

Resolved fields:

| Field | How it is derived |
|---|---|
| `topic` | Query with noise words removed |
| `ageGroup` / `ageMin` / `ageMax` | Explicit `ageGroup`, or grade defaults |
| `grade` | Explicit field or parsed from query |
| `subject` | Explicit field or keyword map |
| `difficulty` | Explicit / keywords / grade / age defaults |
| `language` | Explicit / keywords / default `English` |
| `learningObjective` | Keyword rules only (never LLM) |
| `objectiveConfidence` | `exact_keyword` when a keyword matched; otherwise `age_default` |

### Objective keyword map

Keywords use word-boundary matching for single tokens (so `keyword` does not match `word`). Multi-word phrases match literally.

| Objective | Keywords |
|---|---|
| `counting` | count, counting, how many, number of, numbers, add, subtract, total |
| `matching` | match, matching, pair, pairs, connect |
| `sorting` | sort, sorting, group, groups, order, arrange |
| `classification` | classify, classification, category, categories, type of, types of, kind of |
| `comparison` | compare, comparing, comparison, difference, differences, versus, vs, alike, different |
| `question_answer` | quiz, question, questions, ask, answer, trivia |
| `science_facts` | fact, facts, science, why, how does, experiment |
| `reading` | read, reading, sentence, sentences, story, stories, passage |
| `phonics` | phonics, pronounce, pronunciation, sound out, letter sound, what sound, alphabet sound |
| `recognition` | recognize, recognise, spot, identify, name the, names of |
| `vocabulary` | vocab, vocabulary, words, learn words, spell, spelling, learn |
| `general_knowledge` | general knowledge, trivia facts |

**Removed:** bare `about` and `word` — they caused false positives (`flashcards about animals` → `general_knowledge`; `keyword` → `vocabulary`).

### Multi-keyword tie-break

When a query matches keywords for more than one objective:

1. Count matched keywords per objective.
2. Keep objectives with the highest hit count.
3. Break ties using `OBJECTIVE_PRIORITY` (most specific first):  
   `phonics` → `counting` → `matching` → `sorting` → `classification` → `comparison` → `question_answer` → `science_facts` → `reading` → `recognition` → `vocabulary` → `general_knowledge`.

Example: `"Identify and count the animals"` matches both `identify` (recognition) and `count` (counting) with hit count 1 each → **counting** wins (higher priority).

If no keyword matches, age midpoint defaults apply:

- ≤3 → `recognition`
- ≤6 → `vocabulary`
- ≤8 → `question_answer`
- else → `general_knowledge`

Example: `"Compare fruits"` + `"3-4"` → topic `fruits`, objective `comparison`, age `3-4`.

---

## 2. Template selection (config-driven)

### Data sources

1. Active `TemplateSelectionRule` rows (joined to active templates)
2. Active `FlashcardTemplate` rows **without** rules (synthetic metadata-only candidates)

So adding rules works without code changes. Templates remain selectable even if no rule exists yet.

### Hard filter (must pass)

1. Template must be active
2. Requested age group must overlap template `supportedAgeGroups`
   - `"3-4"` overlaps `"3-5"` ✓
   - `"3-4"` does **not** overlap only `"2-3"` and `"8-10"` ✗
3. If a rule configures non-empty `grades` / `subjects` / `difficulties`, request values must match (empty arrays = wildcard)

Topic/`topics` / `intents` do **not** select templates. Topic only affects generated content.

### Ranking (best → fallback)

Uses `effectiveObjectiveRank` — when `objectiveConfidence === 'age_default'`, raw objective rank is capped at **2** (related tier) so age-inferred labels do not over-power exact-age rule matches.

**Objective rank source:** When a rule defines explicit `learningObjectives`, only those objectives determine the candidate's objective rank. Template-level objectives are **not** merged via `Math.max()`. Template objectives only provide signal for synthetic fallback rules (templates without any selection rule). This prevents a rule created for one purpose (e.g. comparison) from borrowing a tier-3 rank from the underlying template's broader objectives (e.g. question_answer).

1. **Objective relevance** (highest weight; uses effective rank when age-default)
   - `3` exact objective on rule (or template for synthetic rules)
   - `2` related objective fallback
   - `1` generic fallback (`vocabulary` / `recognition` / `general_knowledge`)
   - `0` no useful objective signal
2. **Exact objective** — rule's own objectives directly match the requested objective (new tiebreaker)
3. Exact age-group match
4. Exact grade match
5. Exact subject match
6. Exact difficulty match
7. Newer `templateVersion`
8. Higher rule `priority`
9. Higher computed `score`
10. Stable rule id

`rankTemplateCandidates()` returns the full ordered list with per-candidate score breakdown. When `PIPELINE_STORE_AI_PAYLOAD=true`, the top 10 candidates are attached to the `TEMPLATE_SELECTION` pipeline stage metadata as `rankingBreakdown`.

### Related-objective fallback map

```text
comparison     → classification, matching, recognition, vocabulary
classification → sorting, matching, comparison, recognition
matching       → recognition, classification, vocabulary
sorting        → classification, matching, recognition
phonics        → reading, vocabulary, recognition
reading        → phonics, vocabulary, question_answer
science_facts  → general_knowledge, question_answer, vocabulary
question_answer→ reading, general_knowledge, science_facts
counting       → recognition, matching, vocabulary
recognition    → vocabulary, classification
vocabulary     → recognition, reading
general_knowledge → science_facts, question_answer, vocabulary
```

### Example: Compare fruits @ 3–4

1. Age filter keeps templates supporting `3-4`
2. Objective is `comparison`
3. Exact comparison template wins
4. Else related (`classification` / `matching`) within age range
5. Else generic vocabulary/recognition fallback

### Recommended rule shape

```text
FlashcardTemplate
  supportedAgeGroups = ['3-4']          # hard age filter
  learningObjectives = ['comparison']   # ranking signal

TemplateSelectionRule
  templateId = <that template>
  ageMin = 3, ageMax = 4                # exact-age boost (optional)
  learningObjectives = ['comparison']   # ranking boost
  priority = 100+
  grades/subjects/difficulties/topics = [] unless you want hard filters
```

Notes:

- Hard age filtering uses template `supportedAgeGroups`
- Rule `ageMin`/`ageMax` mainly boost exact-age ranking
- Difficulty aliases: `easy`↔`beginner`, `medium`↔`intermediate`, `hard`↔`advanced`

---

## 3. Selected template becomes the LLM contract

After selection, `layoutDefinition` is parsed into editable components:

- Text components: everything except `type=image`
- Image components: each `type=image` slot independently

The selected template ID/name/version/orientation and every component ID are injected into the prompt. The LLM must not invent extra components or choose another template.

Prompt version: `v4-template-components`

---

## 4. Actual Gemini prompt (template-aware)

Built by `buildFlashcardContentPrompt(...)`.

```text
You generate educational flashcard CONTENT only.

Rules:
- Return JSON only.
- Never invent UI layout, positioning, colors, fonts, styling, or rendering metadata.
- Never choose templates.
- The backend already selected the template below. Treat its component IDs and types as the exact output contract.
- Generate one independent value for every required text component and one independent image search description for every required image component.
- Never reuse one image component's query as a substitute for another image component.
- Never return image filenames — only semantic image search fields.
- Keep language age-appropriate for ages {ageMin}-{ageMax}.
- Write all educational text in {language}.
- {ageBandGuidance}
- Maximize educational variety. Do NOT always reuse the same canonical examples (e.g. A→Apple/Ball/Cat, or Potato/Tomato/Carrot). Rotate equally valid age-appropriate alternatives when they exist.
- Content must be factually correct, concise, curriculum-aligned, and visually teachable.

Learner profile:
- User request: {query}
- Topic focus: {topic}
- Grade: {grade}
- Age group: {ageMin}-{ageMax}
- Subject: {subject}
- Difficulty: {difficulty}
- Educational objective: {learningObjective}
- Language: {language}

Selected template contract:
- Template ID: {selectedTemplate.id}
- Template name: {selectedTemplate.name}
- Template version: {selectedTemplate.templateVersion}
- Template type: {selectedTemplate.templateType}
- Layout type: {selectedTemplate.layoutType}
- Orientation: {selectedTemplate.orientation}

Produce exactly {count} cards.
Inside "textComponents", use these exact component IDs verbatim. Do not rename, translate, omit required IDs, or add IDs:
- "{componentId}": type={componentType}, region={regionId}, required|optional, validation={...}

Inside "imageComponents", use these exact component IDs verbatim. Each ID represents a separate image requirement:
- "{componentId}": type=image, region={regionId}, required|optional, validation={...}

Every image component value must contain:
- searchQuery: short precise semantic query (object-first, child-friendly)
- expectedObjects: array of expected object names
- preferredStyle: e.g. cartoon
- preferredBackground: e.g. white
- orientation: e.g. portrait
- educationalUse: flashcard

JSON shape:
{
  "cards": [
    {
      "cardIndex": 0,
      "textComponents": {
        "{textComponentId}": "<type content>"
      },
      "imageComponents": {
        "{imageComponentId}": {
          "searchQuery": "<precise semantic query for this image slot>",
          "expectedObjects": ["<primary expected object>"],
          "preferredStyle": "cartoon",
          "preferredBackground": "white",
          "orientation": "{template.orientation}",
          "educationalUse": "flashcard"
        }
      }
    }
  ]
}
```

### Age-band guidance injected into the prompt

| Ages | Guidance |
|---|---|
| 2–3 | Single word labels only |
| 3–4 | Single word + one short sentence |
| 5–6 | Word + one short educational fact |
| 6–8 | Short description + recognition question (if question component exists) |
| 8+ | Fact + reasoning question (if question component exists) |

### Structured output schema

Gemini receives `responseMimeType: application/json` plus a schema that pins:

- `cards[].textComponents.{exactTextComponentIds}` → string
- `cards[].imageComponents.{exactImageComponentIds}` → image query object
- Required IDs from the selected template only

If validation fails for the whole set, the service may regenerate only invalid cards (not the entire set by default after partial success).

---

## 5. Content validation (before image search)

`validateLlmFlashcardPayload` enforces:

- No layout / styling / template / rendering fields from the LLM
- Exact card count
- Exact text component IDs (no extras, no missing required)
- Exact image component IDs (no extras, no missing required)
- Non-empty text values
- Each image object has `searchQuery` + non-empty `expectedObjects`
- `cardIndex` must equal the array index

Validated LLM card shape:

```ts
{
  cardIndex: number;
  textComponents: Record<string, string>;          // keyed by template text componentId
  imageComponents: Record<string, ImageSearchQuery>; // keyed by template image componentId
}
```

---

## 6. Image retrieval (after content generation)

For each card, for each selected-template image component:

1. Read that component’s `ImageSearchQuery` by `componentId`
2. Call Search Service **exactly once**, with that slot’s `searchQuery` verbatim and `limit: FLASHCARD_IMAGE_SEARCH_LIMIT` (default 8). No cascade, no enriched/topic variants, no query rewriting.
3. Rank the hits by similarity and claim the **top hit not already used elsewhere in this set** (2nd/3rd from the same result list if the top is taken) — no similarity threshold, no random rotation
4. Attach signed URL / proxy `imageUrl`, asset colours, and brand colour
5. Zero results, or every ranked hit already used → status `IMAGE_NOT_FOUND`
6. Embedding/search throwing is retried with the **same** query (default 3 attempts); exhausted → status `error`
7. One image failure does not fail the whole pipeline

Important: image slots are independent. Two image components never share one query by position; each uses its own keyed description.

Full detail — including why query wording drives accuracy, line-art gating, and telemetry — is in [`FLASHCARD_IMAGE_RETRIEVAL.md`](./FLASHCARD_IMAGE_RETRIEVAL.md).

---

## 7. Response assembly & final validation

Merge:

1. Selected template (`template`, `templateVersion`, `layoutDefinition`)
2. Validated text content
3. Retrieved asset metadata

Each card component in response order matches template editable-component order:

```json
{
  "componentId": "title_word",
  "type": "title",
  "componentType": "title",
  "editable": true,
  "content": "Apple",
  "validationRules": { "maxLength": 32 }
}
```

```json
{
  "componentId": "img_main",
  "type": "image",
  "componentType": "image",
  "editable": true,
  "content": null,
  "assetReference": {
    "assetId": "...",
    "s3ObjectKey": "...",
    "signedUrl": "...",
    "imageUrl": "/flashcards/assets/.../image",
    "similarity": 0.91,
    "mimeType": "image/png",
    "status": "found",
    "queryUsed": "cartoon red apple white background",
    "attempts": ["semantic"]
  }
}
```

Final validation checks:

- Card count
- Unique `cardId`s
- Component IDs and order match selected template
- Type / editable flags match
- Required text has content
- Required images have a retrieval result object (may be `IMAGE_NOT_FOUND`)

Rendering engine should require **zero AI processing** after this JSON.

---

## 8. What is config vs engine logic

### Configure in DB (preferred for new layouts)

- Insert / update `FlashcardTemplate`
- Insert / update `TemplateSelectionRule`
- Set `supportedAgeGroups`, `learningObjectives`, subjects, difficulties, layout components

### Engine behavior (code, not per-template hardcoding)

- Objective keyword inference from query
- Related-objective fallback ranking
- Difficulty aliases
- Prompt structure / schema builder
- Single-search image retrieval + top-unused similarity selection

Adding a new flashcard layout should only require template + selection-rule configuration, not orchestrator/prompt/image-pipeline rewrites, as long as component types stay within the supported set.

---

## Changelog (2026-08-06b) — rule-scoped objective rank & exactObjective sort

### Rule-scoped objective rank (`template-selection.engine.ts`)

When a `TemplateSelectionRule` defines explicit `learningObjectives`, only those objectives determine the candidate's objective tier. The previous `Math.max(templateObjectiveRank, ruleObjectiveRank)` merge allowed a rule created for one purpose (e.g. comparison) to borrow a tier-3 rank from the underlying template's broader objectives (e.g. question_answer). This caused 4+ wrong winners in the seed catalog.

**Removed:** `ruleExplicitlyMismatches()` gate — superseded by the rule-scoped rank source. The gate was too lenient (it only triggered when `objectiveRelevance === 0`, allowing tangentially related rules to escape).

**New sort dimension:** `exactObjective` — inserted between `effectiveObjectiveRank` and `exactAge`. When two candidates tie on effective tier, the one whose rule directly lists the requested objective wins (e.g. QA rule beats comparison rule for a question_answer request even when both reach tier 3 via different paths).

**Updated `objectiveExactBoost`:** When a rule has explicit objectives, `templateObjectiveExact` no longer inflates the score boost. Only `ruleObjectiveExact` grants the +120 boost.

### Fixed diagnostic cases

| Case | Before (wrong winner) | After (correct winner) |
|---|---|---|
| quiz keyword (question_answer, 6-8) | `rule_obj_6_8_comparison` | `rule_age_6_8_qa` |
| science facts (science_facts, 5-6) | `rule_obj_5_6_counting` | `rule_age_5_6_facts` |
| no keyword age default (vocabulary, 3-4) | `rule_obj_3_4_phonics` | `rule_age_3_4_vocabulary` |
| about noise word (vocabulary, 3-4) | `rule_obj_3_4_phonics` | `rule_age_3_4_vocabulary` |

### Diagnostics

- Fragile passes reduced from **13 → 12** of 23 cases.
- `science facts` case is **no longer fragile** (tier gap = 1, score gap = 1150).
- Remaining fragile cases are structurally expected: multiple rules legitimately share the same objective tier (e.g. `match pairs` where comparison/counting/sorting rules all list `matching` in their objectives).
- Regenerate: `npm run flashcards:emit-diagnostics`
- Unit tests expanded to **19** cases (4 new regression tests for the fixed scenarios).

### Explicit `templateId` bypass (controller)

Confirmed already implemented in `flashcard-orchestrator.service.ts`. When `dto.templateId` is provided, the orchestrator calls `loadExplicitTemplate()` which skips both `EDUCATIONAL_OBJECTIVE_DETERMINATION` and `TEMPLATE_SELECTION` pipeline stages. The template is loaded directly by ID via `TemplateSelectionService.selectByTemplateId()`. No code changes needed.

---

## Changelog (2026-08-06) — objective rank normalization & rule mismatch gate

### Rule mismatch gate (`template-selection.engine.ts`)

When a `TemplateSelectionRule` lists explicit `learningObjectives` that do not match or relate to the requested objective, the candidate receives **tier 0** — generic `templateObjectives` on the underlying template can no longer boost the rank via `Math.max()`.

**Effect:** `rule_obj_3_4_counting`, `rule_obj_3_4_comparison`, and `rule_obj_3_4_sorting` are demoted on vocabulary age-default queries instead of tying at tier 2.

**Note:** This gate was superseded by the rule-scoped objective rank fix (2026-08-06b) which eliminates the `Math.max()` merge entirely.

### `normalizeObjective()` alias expansion

Engine-side canonicalization now maps verb/action phrasings (e.g. `calculate` → `counting`, `reading_in_range` → `reading`, `grouping` → `sorting`) with hyphen/underscore/whitespace normalization and simple inflection stripping before tier evaluation.

### Diagnostics

- Harness expanded to **23** cases (verb-variation regressions for counting/reading).
- Regenerate: `npm run flashcards:emit-diagnostics`
- Coverage script: `npm run flashcards:rule-coverage` — seed catalog has no `(template, ageGroup, objective)` gaps.
- **Fragile pass:** twelve of twenty-three seed-catalog cases share `effectiveObjectiveRank` between #1 and #2 (listed at top of the breakdown doc).

---

## Changelog (2026-08-05) — template selection hardening

### `objectiveConfidence` (request analysis output)

New field on `ResolvedUserRequest` (internal resolver output, also emitted in pipeline stage metadata):

| Value | Meaning |
|---|---|
| `exact_keyword` | At least one objective keyword matched the query (after word-boundary matching). |
| `age_default` | No keyword matched; `learningObjective` came from the age-midpoint default table. |

Downstream use today: passed into `rankTemplateCandidates()` / `selectBestTemplate()` and stored on `REQUEST_ANALYSIS`, `EDUCATIONAL_OBJECTIVE_DETERMINATION`, and `TEMPLATE_SELECTION` pipeline metadata. **Not** exposed on `GenerateFlashcardsResponse.request` (API unchanged).

### Objective tie-break (keyword inference)

When multiple objectives match:

1. Count keyword hits per objective (word-boundary matching for single tokens; literal phrase match for multi-word keywords).
2. Keep objectives with the maximum hit count.
3. Break ties using `OBJECTIVE_PRIORITY` (most specific pedagogical intent first):  
   `phonics` → `counting` → `matching` → `sorting` → `classification` → `comparison` → `question_answer` → `science_facts` → `reading` → `recognition` → `vocabulary` → `general_knowledge`.

Removed bare `about` / `word` keywords (false positives).

### `effectiveObjectiveRank` cap (`age_default` only)

When `objectiveConfidence === 'age_default'`, raw objective rank is capped at **2** before scoring/sorting. Prevents a weak age-inferred label from scoring as tier 3 (exact) against templates whose objectives happen to match the default.

### Full ranking diagnostics

- Harness: `src/modules/flashcards/utils/template-selection.diagnostic.spec.ts` + `template-selection.diagnostic.util.ts`
- Artifact: `docs/flashcards/TEMPLATE_SELECTION_RANKING_BREAKDOWN.md` (regenerate: `npm run flashcards:emit-diagnostics`)

### `OBJECTIVE_RULE_SEEDS` — when they apply

| Scenario | What happens |
|---|---|
| **Empty DB** (zero `FlashcardTemplate` rows) | `FlashcardSeedService.onModuleInit()` seeds `TEMPLATE_SEEDS` + **`ALL_RULE_SEEDS`** (age-band + objective rules) on first app boot. |
| **Existing DB** (any templates already present) | Seed service **skips entirely** — objective rules are **not** auto-inserted. |
| **Manual backfill** | `npm run flashcards:rule-coverage -- --apply` upserts only `OBJECTIVE_RULE_SEEDS` by stable id (requires templates to exist). **Do not run `--apply` until the target environment is confirmed.** |

**Environment status (not verified against live DBs in this session):**

| Environment | Expected state | Verified? |
|---|---|---|
| Local dev | Unknown — depends whether DB was empty on first boot after seed re-enable, or pre-populated via upload | No |
| Staging | Unknown — likely missing objective rules if DB predates this session | No |
| Production | Unknown — same as staging | No |

To check an environment: `SELECT id FROM "TemplateSelectionRule" WHERE id LIKE 'rule_obj_%';` — expect 7 rows when applied.

### Rule-id tie-break determinism

Final sort key in `rankTemplateCandidates()` is `ruleId.localeCompare()` (lexicographic). Input fetch order from Prisma does **not** affect the winner.

| Rule source | Id stability | Tie-break safe? |
|---|---|---|
| Seed (`FlashcardSeedService`, coverage `--apply`) | Explicit string ids (`rule_age_3_4_vocabulary`, `rule_obj_3_4_comparison`, …) | Yes — identical across fresh seeds and upserts |
| Synthetic fallback (template with no rule) | `synthetic-${templateId}` | Yes — derived from template id |
| API-uploaded rules (no explicit id) | Prisma `@default(cuid())` | Deterministic **within** one DB; ids differ across environments/uploads |

**Guarantee:** For the shipped seed catalog, tie-break is fully deterministic. For ad-hoc uploaded rules that tie on all ranked dimensions, treat rule-id order as environment-local unless uploads use explicit ids.

---

## Pending product decisions

### Should `topic` ever influence template selection?

**Current behavior (code):** `topic` is extracted for content generation only. `TemplateSelectionRule.topics` exists in the schema but is **not** read by `template-selection.engine.ts`. Selection is objective + age (+ optional grade/subject/difficulty).

**Open question:** For queries like `"Compare fruits"` vs `"Compare animals"`, should topic ever boost a template (e.g. EVS-specific layout)? Or must topic remain content-only to keep selection auditable and config-driven?

**Status:** Pending product decision — do not implement topic-based ranking until decided.

---

## 9. Quick mental model

```text
User query
  → deterministic age + objective
  → filter templates by age group
  → rank by objective (exact → related → generic)
  → selected template defines exact text/image slots
  → Gemini fills only those slots (+ semantic image queries)
  → validate against template IDs
  → one image search per image component (top unused asset)
  → assemble template-shaped response JSON
```

Example path for `"Compare fruits"` / `3-4`:

1. Objective = `comparison`
2. Prefer comparison template supporting `3-4`
3. Prompt lists that template’s component IDs
4. LLM returns text + per-image search queries keyed by those IDs
5. Image retrieval runs one top-similarity search per image slot
6. Response returns the comparison template JSON with filled components
