# Cursor Prompt (v3 — supersedes v2) — Template Selection Profile Table + AI Layer Wiring

This replaces the earlier "cursor-prompt-template-selection-v2" deliverable list for the schema/AI-prompt pieces specifically. The three-stage pipeline (Stage 1 hard age filter → Stage 2 intent/difficulty classify+rerank → Stage 3 select) from v2 still stands — this prompt tells Cursor exactly what new table to add and how Stage 2/3 must consume it. Paste everything below into Cursor.

---

## Context

We're adding a **per-template selection profile** — structured "what this template is good for" metadata, authored per template, richer than the current flat `meta.topics` string array. Below is a real sample (9 of ~10+ templates; more will be added manually over time, so the schema must not assume a fixed/finite catalog).

Sample record shape (one entry per template):

```json
{
  "id": "sq0j4a",
  "template": {
    "templateName": "tracing",
    "templateType": "visual_tracing",
    "description": "A tracing activity where learners follow a line between corresponding objects..."
  },
  "topicFit": {
    "primaryUse": "Pre-math, visual correspondence and fine-motor tracing activities.",
    "canBeUsedFor": ["Big and small", "Tall and short", "..."],
    "exampleTopics": ["Small animal to small house", "..."],
    "adaptationNote": "Keep the dotted-line tracing interaction, but change the illustrated objects..."
  },
  "skillsPracticed": ["Fine motor skills", "Visual discrimination", "..."]
}
```

Important: the `id` field in this sample JSON (e.g. `sq0j4a`) is **not** a real database id — it's a throwaway key from wherever this JSON was generated. **Do not use it for anything.** The real identifiers live in our `WorksheetTemplate` table and are matched by `slug` (== `templateName` in the JSON), using this authoritative list:

| Real `WorksheetTemplate.id` (cuid) | `slug` |
| --- | --- |
| `cmswxebxm0028s4bg6clapv7x` | `number_names` |
| `cmsws6mrz0009l4bgdx3em709` | `answer_and_colour` |
| `cmtmu146d002ng8bgcae2bvj2` | `look_and_say_letters_and_sounds` |
| `cmthbu2zn002n0kbgfadaudre` | `circle_the_words` |
| `cmtqv0vtc003ho8bg01khunhe` | `matching_single_letter` |
| `cmtqx3d7w0048c4bg0i8fe9cy` | `look_and_say_circle_the_letters` |
| `cmtctkipl002lxcbg6wqtf6q3` | `circle_the_things` |
| `cmtqs9cbc002nnobgwtdins9u` | `tracing` |
| `cmthcnikx003yrobgnng3y2ka` | `match_the_pairs` |
| `cmts6roz3002n4obgkgehn7e1` | `storytime_maze` |

**Flag, do not silently resolve, these two slug mismatches between the sample JSON and the authoritative list before seeding:**

1. JSON `templateName: "number_names_matching"` vs. authoritative slug `number_names` — confirm with a human whether these are the same template before linking.
2. JSON `templateName: "look_and_say_letter_sounds"` vs. authoritative slug `look_and_say_letters_and_sounds` — same, confirm before linking.

`storytime_maze` has no profile entry in the sample JSON at all — leave it unseeded; a human will add its profile manually later, same as any future new template.

More templates and profiles will be added by hand over time — **the schema and the AI-layer code must both treat this as an open-ended, growing catalog, never a fixed list.**

---

## Part 1 — Prisma schema

Add a new model. First check `schema.prisma`'s `datasource` provider — the array fields below (`String[]`) require Postgres; if the provider is MySQL, use `Json` for those fields instead and adjust the seed/query code accordingly (call this out in your PR description either way).

```prisma
model WorksheetTemplateSelectionProfile {
  id              String   @id @default(cuid())
  templateId      String   @unique
  template        WorksheetTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)

  // denormalized for readability / drift detection — must equal template.slug at write time
  templateSlug    String
  templateType    String
  description     String   @db.Text

  primaryUse      String   @db.Text
  canBeUsedFor    String[]
  exampleTopics   String[]
  adaptationNote  String   @db.Text
  skillsPracticed String[]

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([templateSlug])
}
```

Add the inverse relation to the existing template model:

```prisma
model WorksheetTemplate {
  // ...existing fields...
  selectionProfile WorksheetTemplateSelectionProfile?
}
```

Notes for the migration:

- `templateId` is `@unique` — this is a strict one-to-one (one profile per template). If we ever need versioned/multiple profiles per template, that's a separate future migration — don't build for it speculatively now.
- A template with **no** row in this table must remain fully functional everywhere (selection, generation, rendering). Every read of this table is a `LEFT JOIN` / optional relation, never a required join. Templates without a profile fall back to whatever `meta.topics`/`meta.subjects` etc. already provide.
- Write a data-integrity check (can be a simple script, doesn't need to be a DB constraint) that flags any `WorksheetTemplateSelectionProfile.templateSlug` that no longer matches its linked `WorksheetTemplate.slug`, so renamed templates don't silently go stale.

## Part 2 — Seed script

Write a one-off, idempotent (`upsert` by `templateId`) seed script that:

1. Reads the sample JSON (paste the 9-entry payload into a fixture file, e.g. `./seed-data.json`).
2. Resolves each entry's `template.templateName` to a real `WorksheetTemplate.id` using the authoritative id/slug table above (hardcode that lookup table in the script — do not query by name/fuzzy match).
3. For the two flagged mismatches, **do not guess** — either skip them with a loud `console.warn` naming both the JSON slug and the closest authoritative slug, or read the resolution from a small manual override map at the top of the script (`{"number_names_matching": "number_names", "look_and_say_letter_sounds": "look_and_say_letters_and_sounds"}`) that a human fills in before running. Default to skip-and-warn.
4. Upserts one `WorksheetTemplateSelectionProfile` row per resolved entry.
5. Logs a summary: rows created/updated, rows skipped (with reason), and any authoritative slugs from the id table that had **no** matching JSON entry (e.g. `storytime_maze`) so it's obvious what's still missing.

## Part 3 — Wire this into the AI selection layer

This is the part that actually changes template-selection *behavior*, not just storage. Touch `worksheet-template-selection.service.ts`, `worksheet-template-selection-ai.service.ts`, and `worksheet-prompt.constants.ts`.

### 3a. Catalog block sent to the LLM

Today the catalog block built for the Stage 3 (final pick) LLM call is:

```text
{ id, name, category, subjects, topics, difficulty, ageMin, ageMax }
```

Extend it, for any template that has a `selectionProfile`, to:

```text
{
  id, name, category, subjects, topics, difficulty, ageMin, ageMax,
  primaryUse,        // from selectionProfile, if present
  canBeUsedFor,      // from selectionProfile, if present
  exampleTopics,     // from selectionProfile, if present
  skillsPracticed    // from selectionProfile, if present
}
```

Templates without a profile keep the old shape (omit the four new keys entirely rather than sending them as `null`/`[]`, so the LLM isn't misled into thinking "this template has no use cases").

### 3b. Update the selection system prompt

In `WORKSHEET_TEMPLATE_SELECTION_SYSTEM_PROMPT`, add explicit instructions that:

- `canBeUsedFor` and `exampleTopics` are **illustrative, not exhaustive** — a request topic that isn't literally listed can still be a great fit if it matches the same underlying pattern (state this directly, mirroring each template's own `adaptationNote` intent, e.g. "circle_the_things can be used for any visual classification task, not only the categories listed").
- Prefer matching the request's topic/intent against `primaryUse` first (the general pedagogical purpose), then `canBeUsedFor`/`exampleTopics` (specific instances) as confirming evidence — this stops the LLM from string-matching example topics too literally.
- `skillsPracticed` should factor in only when the request explicitly cares about a skill (e.g. "fine motor," "phonics") or when two templates are otherwise tied.
- Do not expose `adaptationNote` as a selection criterion — it's authoring guidance for *how to fill in* a chosen template, not a reason to pick it. Keep it out of the Stage 3 prompt; instead, pass the chosen template's `adaptationNote` (if present) downstream into the **content generation** prompt (`WorksheetContentService`) so it actually gets used at the right stage.

### 3c. Deterministic pre-LLM scoring (Stage 2 rerank, from v2)

Add one more scoring signal to the Stage 2 rerank described in v2, for templates that have a `selectionProfile`:

- Case-insensitive substring/keyword overlap between `request.query`/`request.topic` and any entry in `canBeUsedFor` or `exampleTopics`: **+6** (lower weight than the structured `theme`/`activityType` matches from v2, since this is a fuzzy text match, not a classified/validated field).
- This is a cheap pre-filter to help pick the top-N shortlist handed to the Stage 3 LLM when the age-filtered pool is large — it is not a substitute for the LLM's own semantic judgment in 3b.

### 3d. Content generation handoff

After a template is selected, `WorksheetContentService` should look up `selectionProfile.adaptationNote` (if present) for the chosen template and include it as guidance in the content-generation prompt (e.g. "keep the dotted-line tracing interaction, but change illustrated objects per topic"). This is new: today nothing downstream of selection reads this table.

---

## Deliverables

1. Prisma schema migration for `WorksheetTemplateSelectionProfile` (Part 1), with the MySQL-vs-Postgres array caveat resolved for our actual `datasource`.
2. Seed fixture (`./seed-data.json`, the 9 entries) + idempotent seed script (Part 2), including the mismatch-handling behavior and the summary log.
3. Updated catalog-building code + `WORKSHEET_TEMPLATE_SELECTION_SYSTEM_PROMPT` (Part 3a/3b).
4. Updated Stage 2 rerank scoring to add the `canBeUsedFor`/`exampleTopics` fuzzy-match signal (Part 3c), on top of (not replacing) the v2 theme/activityType/difficulty scoring.
5. `WorksheetContentService` change to read and pass through `adaptationNote` for the selected template (Part 3d).
6. Tests:
   - Seed script: correctly resolves all unambiguous slugs, skips/warns on the two flagged mismatches by default, reports `storytime_maze` as missing a profile, analyze the meta and necessary thing from the worksheet template in db and generate one row for it to seed into db for new fields.
   - Selection: a template **without** a profile is still selectable and unaffected in scoring/prompting.
   - Selection: a query whose wording isn't a literal `exampleTopics` string but matches the `primaryUse` pattern still gets a fair shot at being picked (write a concrete test case using `tracing`'s "Small animal to small house" example vs. a paraphrased query like "match each big elephant to its big house").
   - Content generation: `adaptationNote` shows up in the prompt sent for a template that has one, and generation still works normally for a template that doesn't.
7. Update the template-selection doc to mention this new table and the Part 3 flow additions.

Do not change the explicit `templateId` path, and do not make `selectionProfile` a required relation anywhere — it must degrade gracefully to today's behavior for any template that doesn't have one yet.