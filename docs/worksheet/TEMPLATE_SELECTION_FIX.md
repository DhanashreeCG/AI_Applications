# Cursor Prompt — Rebuild Worksheet Template Selection as: Age Hard-Filter → Intent/Difficulty Rerank → Select

Paste everything below into Cursor as the task prompt.

---

## Context (read first)

We have an existing worksheet template auto-selection pipeline. Source of truth:

- `src/modules/worksheets/services/worksheet-generation.service.ts` — orchestration
- `src/modules/worksheets/services/worksheet-template-selection.service.ts` — deterministic filter + rank + AI handoff
- `src/modules/worksheets/services/worksheet-template-selection-ai.service.ts` — LLM picker + fallbacks
- `src/modules/worksheets/services/worksheet-template.service.ts` — catalog load / meta parse
- `src/modules/worksheets/services/worksheet-validation.service.ts` — request validation
- `src/modules/worksheets/constants/worksheet-prompt.constants.ts` — selection prompts + schema
- `src/modules/worksheets/interfaces/worksheet-template-selection-ai.interfaces.ts`
- `src/modules/worksheets/types/worksheet.types.ts` → `WorksheetTemplateMeta`

Current flow (for reference — do not assume this is correct, we are replacing parts of it):

1. If `templateId` is present → explicit lookup, no filtering, no AI (leave this path untouched).
2. Else: load all `ACTIVE` templates → `isEligible()` hard-filters on `grades`, `subjects`, `topics`, `difficulty` (exact/alias match) **and** age (only if request has an age **and** the template has both `ageMin` and `ageMax`) → deterministic `score()` (+10 grade, +8 subject, +8 topic, +6 age, +4 difficulty) → if >1 survivor, call an LLM to pick one from the survivor set; on any LLM failure, fall back to `eligible[0]`.

### Problems with the current flow we need to fix

1. **Age is not actually a hard filter.** It only excludes a template when the request happens to carry a numeric age *and* the template happens to define both `ageMin`/`ageMax`. Templates with empty meta pass through regardless of age. Age resolution also collapses a range like `"4-5"` down to a single digit (`4`), so a template built for ages 5–6 can wrongly qualify or disqualify.
2. **Grade/subject/topic/difficulty are hard filters, but age is effectively soft.** We want the opposite priority: **age band is the primary hard filter**, everything else (topic/intent, difficulty) should be resolved by understanding what the user is actually asking for, then used to rerank.
3. **Query intent is only used by the LLM step, at the very end, over an already-shrunk pool**, and only when there is more than one deterministic survivor. If the deterministic filter overshoots (wrong template kept, right one dropped) because of the age bug above, the LLM never sees the correct candidate.
4. **No structured topic taxonomy is used.** Our real content taxonomy (below) is organized by age band → theme → sub-topics. Right now `meta.topics` is a flat string array matched by exact string equality, so it can't represent "this template covers the FARM TO FORK theme, sub-topic: table manners" in a way that generalizes to paraphrased user queries.
5. **`age` in real requests is a point value or a fairly loose band anywhere from 2 to 12 (not fixed to FS0/FS1/FS2/Grade1-3 boundaries).** The grade-alias table assumes fixed bands; we need age-range overlap as the actual hard filter, with grade/stage as a secondary hint only.

---

## What to build instead

Replace the single `isEligible → score → AI-pick-among-survivors` pipeline with an explicit **three-stage pipeline**, each stage independently testable:

### Stage 1 — Hard filter by age (mandatory, cannot be skipped by empty meta)

- Resolve the requested age into a concrete `[minAge, maxAge]` band:
  - If `request.age` (point value) is given → band is `[age, age]` but treat it as "must overlap template's `[ageMin, ageMax]` inclusively," i.e. `template.ageMin <= age <= template.ageMax`.
  - If only `request.ageGroup` (e.g. `"4-5"`, `"2-3"`) is given → parse **both** numbers into `[reqMin, reqMax]` and require true range overlap against `[template.ageMin, template.ageMax]`: `template.ageMin <= reqMax AND template.ageMax >= reqMin`. Do not truncate to the first digit.
  - If `request.grade`/stage (`fs0`, `fs1`, `fs2`, `grade1`…) is given instead of an age, map grade → its canonical age band (see table below) and use that band the same way.
- **Every active template must declare `ageMin`/`ageMax` for this filter to work.** Treat a template with a missing/undefined `ageMin` or `ageMax` as **needing backfill**, not as a wildcard — log a `TEMPLATE_MISSING_AGE_META` warning and exclude it from auto-select (explicit `templateId` lookups are unaffected). This is a deliberate behavior change from today's "empty meta = wildcard" rule, scoped to age only; keep wildcard behavior for `grades`/`subjects`/`topics`/`difficulty` at this stage.
- Output of Stage 1: `ageFiltered: WorksheetTemplate[]`. If empty → same `NO_TEMPLATE_FOUND` (404) behavior as today, with the age band included in the error payload.
- If `ageFiltered.length === 1` → skip Stage 2/3, return it directly (`selectionMode: 'deterministic'`, reason `single_age_match`).

### Stage 2 — Query intent + difficulty classification, then rerank

Only runs on `ageFiltered` (never the full catalog).

1. **Classify the request** into structured fields before touching the template list:
   - `theme` — which top-level topic bucket the query/topic falls under (e.g. `MY LITTLE WORLD`, `FARM TO FORK`, `PAWS CLAWS AND TAILS`, `MISSION: SPACE AND TIME`, `MATHS`, `LANGUAGE`, …). Use the taxonomy table below as the closed vocabulary for this classification, scoped to the age band resolved in Stage 1.
   - `subTopic` — the specific leaf topic inside that theme (e.g. `Table Manners`, `Farm animals`, `Number bonds`, `Rhyming words`).
   - `activityIntent` — the pedagogical activity type implied by the query (`matching`, `tracing`, `coloring`, `sorting`, `sequencing`, `fill-in-the-blank`, `counting`, `odd-one-out`, `maze/path`, `comprehension`, etc.) — reuse/extend the 15-item activity taxonomy already in the catalog (Trace & Write, Count & Circle, Match the Pairs, Sort into Two Boxes, What Comes Next, Fill Missing Numbers, Odd One Out, Color by Code, Connect the Dots, Maze/Path, Yes/No Judgement, Tally & Graph, Word Problem, Cut/Sort/Paste, Before/After/Between).
   - `difficulty` — `easy | medium | hard`, either taken directly from `request.difficulty` if present, or inferred from the query/topic complexity when absent (e.g. "missing numbers 1–20" skews harder than "big and small").
   - Implementation: one LLM call (cheap/fast model) with a strict JSON schema output (`theme`, `subTopic`, `activityIntent`, `difficulty`, `confidence`), given `request.query`, `request.topic`, the resolved age band, and the closed vocabularies as enums. This replaces the *current* free-form "select an id from allowedTemplateIds" prompt with an earlier, smaller, more constrained classification step.
   - This call must be independent of the template catalog — it should not need candidate IDs, so it can run in parallel with Stage 1.
2. **Rerank `ageFiltered`** using the classification output. Score starts at 0 for every survivor of Stage 1:
   - `theme`/`subTopic` matches `meta.topics` (or a new `meta.theme` / `meta.subTopics` field, see schema below): **+12**
   - `activityIntent` matches a new `meta.activityType` field: **+10**
   - `difficulty` (explicit or inferred) matches `meta.difficulty`: **+4**
   - `subject` exact match (unchanged from today): **+8**
   - Grade/stage exact match (not alias): **+6** (demoted from +10 — age is already guaranteed by Stage 1, so exact grade match is now a tiebreaker signal, not a primary filter)
   - Keep today's stable-sort tiebreak (newer `updatedAt` first, then `id` asc) for equal scores.
   - Do **not** hard-exclude on `topics`/`subjects`/`difficulty`/`grade` at this stage — they are scoring signals only, since Stage 1 already guarantees age fit and an over-eager hard filter here is what caused today's overshoot problem.

### Stage 3 — Select

- If the top-scored template's score is decisively ahead (define a `MIN_SCORE_MARGIN`, e.g. top score ≥ second score + 6) → return it directly. `selectionMode: 'deterministic'`.
- Otherwise (near-tie, or top score is 0 for everyone, e.g. all-wildcard templates) → call the existing LLM picker (`worksheet-template-selection-ai.service.ts`), but scope `allowedTemplateIds` to the **top N by rerank score** (e.g. top 5) instead of every deterministic survivor as today, and pass the Stage 2 classification (`theme`, `subTopic`, `activityIntent`, `difficulty`) into the LLM prompt as pre-computed hints rather than making the LLM re-derive them from raw `query`/`topic`. Keep all existing fallback reasons (`disabled`, `no_candidates`, `single_candidate`, `missing_api_key`, `circuit_open`, `malformed_json`, `invalid_id`, `low_confidence`, `timeout`, `provider_error`) — on any fallback, return the top of the rerank list, same as today's `eligible[0]` fallback.
- Log full stage-by-stage telemetry: `ageBand`, `ageFilteredCount`, `stage2Classification`, `rerankScores` (top 5), `selectionMode`, `scoreMargin`.

---

## Topic taxonomy to encode (closed vocabulary for Stage 2 classification)

This is real content structure across the three early-years stages we currently author for. Use it to (a) backfill `meta.theme` / `meta.subTopics` on existing templates where inferable, and (b) as the enum the Stage 2 classifier must choose from when the resolved age band falls in FS0–FS2. Grade 1–3 templates keep using free-form `meta.topics` as today until we author an equivalent taxonomy for them — do not force older-grade requests through this closed vocabulary.

Suggested canonical age bands (confirm against actual `ageMin`/`ageMax` values already in the DB before hardcoding):

| Stage | Typical age band |
| --- | --- |
| FS0 (Nursery/Pre-K) | 2–3 |
| FS1 (LKG) | 3–4 |
| FS2 (UKG) | 4–5 |

### FS0 — "My Little World"

- **This Is Me**: My Age, My Favourite Food, My Favourite Toy, My Body Parts, Healthy Habits, My Family, My House, My School, My Pet, My Friends
- **Fruity Fiesta**: Apple, Mango, Banana, Watermelon, Grapes
- **Crunchy Munchy Veggies**: Lady Finger, Peas, Potato, Onion, Carrots
- **Little Feet on the Farm**: Cow, Sheep, Goat, Hen, Dog, Bunny, Horse
- **Wiggle in the Wild**: Lion, Tiger, Monkey, Bear, Snake
- **Roll, Float and Fly**: Land (Car, Bus, Train, Motorbike), Air (Aeroplane), Water (Boat, Ship)
- **Maths — Pre-Maths Concepts**: Big/Small, Same/Different, Near/Far, Tall/Short, Long/Short, In/Out
- **Maths — Core**: Shapes (Rectangle, Square, Circle, Triangle), Numbers 1–10, Subitising 1–10, Missing Numbers 1–10, Colours (Red, Yellow, Blue, Black, White), Pattern, Coding with Colours

### FS1 — "Me, Myself"

- **This Is Me!**: My Birthday, How Old Am I?, My Body, My Senses, Hands at Work, How Do I Feel?, With My Loved Ones (Family/Friends/Pets), My House, My School
- **Farm to Fork**: Fruits, Vegetables, Table Manners
- **Animal World**: Farm Animals, Wild Animals, Insects and Bugs
- **Community Helpers**: Teacher, Doctor, Policeman, Fire Fighter, How They Help Us, Tools They Use
- **Modes of Transport**: Land, Water, Air
- **Maths — Pre-Maths Concepts**: Big/Small, Tall/Short, Long/Short, Heavy/Light, More/Less, Same/Different, One-on-One Difference, Near/Far
- **Maths — Core**: Shapes (Square, Rectangle, Triangle, Circle, Star, Heart), Numbers 1–10, Subitising 1–10

### FS2 — "The World As I See It"

- **Myself**: Myself, My Family, My Friends, My Home, My Neighbourhood, Safety (School/Home/Playground), Wonders of the World, Magic Words, Personal Hygiene, Activities I Do, Lifecycle of a Human
- **Tiny Seeds Mighty Trees**: Types of Plants, Parts of the Plant, Germination, Ideal Growth Conditions, Things We Get from Trees
- **Paws, Claws and Tails**: Farm Animals, Wild Animals, Baby Animals, Animal Sounds (text matching), Animal Habitats, Animal Care (animal + its food), Aquatic Animals
- **Eco Explorers**: Harmful Effects of Pollution, Reduce/Reuse/Recycle, Types of Trash (metal/plastic/organic)
- **Mission: Space and Time**: Solar System, Planetary Facts, Astronauts, Space Stations, Satellites, Space Scientists, Clocks/Time
- **Maths — Core**: Numbers 1–20, Number-Value Association, Before/After/Between, Descending Order 1–10, Number Sets, Subitising, Number Bonds, Addition (single digit), Missing Numbers 1–20, Ordinal Numbers, Backward Counting 1–20, Doubling, Fractions (Whole/Half/Quarter), 2D Shapes, Primary/Secondary Colours, Number Grouping, Full/Half/Empty, Volume, Graphs, Patterns, Days of the Week, Months of the Year, 3D Shapes, Subtraction (single digit)
- **Maths — Pre-Maths Concepts**: Big/Small, Heavy/Light, More/Less, Tall/Short, Long/Short, Large/Small, Up/Down, One/Many
- **Language**: Rhyming Words, Picture Sequencing, Public Speaking, Interviews, Riddles/Puzzle Solving, Hygiene/Self-Care Discussion, Simple Sentence Reading, Yes/No Comprehension, Onomatopoeia, Sequence Adverbs (First/Next/Then/Finally), Picture-Based Story Formation, Spot the Difference, Word Search, Thematic Art, Picture Talk, Missing Letters, Question-Based Art, Action Words, Story Narration (character/setting/problem/emotion), Wh- Questions, Rhyme-Based Sequential Actions, Text/Instruction-Based Art, Picture Decoding, Positional Words, Compound Words, Picture Discussion, Picture Comprehension, Text Sequencing, Decoding Words, Word Sequencing for Sentences, Time Progression (Today/Yesterday/Tomorrow), Descriptive Text Comprehension

---

## Schema changes needed (`WorksheetTemplateMeta`)

```ts
interface WorksheetTemplateMeta {
  grades?: string[];
  subjects?: string[];
  topics?: string[];        // keep for backward compat / grade1-3 templates
  theme?: string;           // NEW — one of the closed-vocabulary themes above, for FS0-FS2 templates
  subTopics?: string[];     // NEW — leaf topics under `theme`
  activityType?: string[];  // NEW — one or more of the 15-item activity taxonomy
  ageMin?: number;          // now REQUIRED for auto-select eligibility (see Stage 1)
  ageMax?: number;          // now REQUIRED for auto-select eligibility (see Stage 1)
  difficulty?: string[];
}
```

Write a one-off migration/backfill script that:
1. Flags every `ACTIVE` worksheet template missing `ageMin`/`ageMax`.
2. Where `grades` is set and unambiguous, backfills `ageMin`/`ageMax` from the grade→age table above.
3. Leaves `theme`/`subTopics`/`activityType` for manual/LLM-assisted backfill (can be a separate one-time script that runs the Stage 2 classifier prompt over each template's existing `name`/`description`/`topics` to suggest values for human review — do not auto-apply without review).

---

## Deliverables

1. Updated `worksheet-template-selection.service.ts` implementing Stage 1 (hard age filter) and the new Stage 2 rerank scoring, replacing `isEligible`/`score`.
2. New (or updated) prompt + schema in `worksheet-prompt.constants.ts` for the Stage 2 classification call (theme/subTopic/activityIntent/difficulty), separate from the existing Stage 3 "pick one template id" prompt.
3. Updated `worksheet-template-selection-ai.service.ts` Stage 3 call to accept pre-computed classification hints and a pre-narrowed `allowedTemplateIds` (top N by rerank score).
4. `WorksheetTemplateMeta` type + Prisma schema/migration for `theme`, `subTopics`, `activityType`, and NOT NULL-equivalent validation (or a runtime guard) on `ageMin`/`ageMax` for `ACTIVE` templates.
5. Backfill script (grade→age) + a review-only suggestion script (theme/subTopics/activityType).
6. Telemetry fields added to `completeMetadata`: `ageBand`, `ageFilteredCount`, `stage2Classification`, `rerankTopScores`, `scoreMargin`.
7. Unit tests:
   - Age Stage 1: point age inside/outside band; `ageGroup` range overlap (not first-digit truncation); template missing age meta is excluded from auto-select but still reachable via explicit `templateId`.
   - Stage 2 classification: sample queries per FS0/FS1/FS2 theme classify correctly; difficulty inference when `request.difficulty` is absent.
   - Stage 3: decisive top score short-circuits without an LLM call; near-tie triggers LLM with narrowed candidate list; all existing AI fallback reasons still produce the pre-AI top-of-list template.
   - Regression: existing explicit-`templateId` path (Path A) is completely unaffected.
8. Update `docs/worksheets/WORKSHEET_TEMPLATE_SELECTION.md` (or the equivalent doc) to describe the new three-stage flow, replacing the current single-stage description.

Do not change: the explicit `templateId` path, the renderer/asset-attachment steps after selection, or `generateSet`'s "one template for the whole batch" behavior.