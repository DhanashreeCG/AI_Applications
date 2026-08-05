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

### Objective keyword map

| Objective | Keywords |
|---|---|
| `counting` | count, number, how many |
| `matching` | match, pair |
| `sorting` | sort, group |
| `classification` | classify, category, type of |
| `comparison` | compare, difference, vs |
| `question_answer` | quiz, question, ask |
| `science_facts` | fact, science, why |
| `reading` | read, sentence, story |
| `phonics` | phonics, pronounce, sound out, letter sound |
| `recognition` | recognize, spot, identify |
| `vocabulary` | word, vocab, learn |
| `general_knowledge` | know, about |

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

1. **Objective relevance** (highest weight)
   - `3` exact objective on template or rule
   - `2` related objective fallback
   - `1` generic fallback (`vocabulary` / `recognition` / `general_knowledge`)
   - `0` no useful objective signal
2. Exact age-group match
3. Exact grade match
4. Exact subject match
5. Exact difficulty match
6. Newer `templateVersion`
7. Higher rule `priority`
8. Stable rule id

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
2. Build cascade queries:
   1. `searchQuery` (semantic)
   2. enriched (`searchQuery` + style + background)
   3. `expectedObjects` joined
   4. first expected object name
   5. topic
   6. unfiltered fallback
3. Call Search Service with **`limit: 1`**
4. Keep the **single top similarity / least-distance** hit
5. No random rotation among top-N
6. Attach signed URL / proxy `imageUrl`
7. On miss after cascade → `assetReference: null`, status `IMAGE_NOT_FOUND`
8. One image failure does not fail the whole pipeline

Important: image slots are independent. Two image components never share one query by position; each uses its own keyed description.

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
- Image cascade + top-1 similarity selection

Adding a new flashcard layout should only require template + selection-rule configuration, not orchestrator/prompt/image-pipeline rewrites, as long as component types stay within the supported set.

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
  → search top-1 image per image component
  → assemble template-shaped response JSON
```

Example path for `"Compare fruits"` / `3-4`:

1. Objective = `comparison`
2. Prefer comparison template supporting `3-4`
3. Prompt lists that template’s component IDs
4. LLM returns text + per-image search queries keyed by those IDs
5. Image retrieval runs one top-similarity search per image slot
6. Response returns the comparison template JSON with filled components
