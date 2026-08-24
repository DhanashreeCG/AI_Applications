# Flashcard Image Retrieval

How an image slot on a generated flashcard becomes a real asset from the library.

Flashcards never generate images. Every picture is **retrieved** from the ingested asset library by semantic vector search. This document covers the `IMAGE_QUERY_GENERATION` → `IMAGE_RETRIEVAL` stages of the generate pipeline, the query-shaping rules that make retrieval accurate, and the post-generation edit paths.

Primary implementation: [`flashcard-image-retrieval.service.ts`](../../src/modules/flashcards/services/flashcard-image-retrieval.service.ts)

---

## 1. The governing rule

> **One image slot = one LLM-written description = exactly one asset search.**

Retrieval never rewrites, enriches, expands, or cascades the description the LLM produced. It never runs a second query with different wording. This is deliberate, and the rest of the design follows from it.

Two earlier behaviours were removed because they violated it:

| Removed | Why |
|---|---|
| Cascade queries (`semantic_enriched`, `expected_objects`, `object_name`, `topic`, `unfiltered`) | Each miss fired another search with different wording, so 3 cards produced 6+ Assets searches and the retrieved image often matched a query the user never saw in the LLM output. |
| `uniquifyCardImageQueries` | Rewrote later cards' queries into invented text like `"different object not apple, banana"` — a description the LLM never wrote. |

Cross-card image uniqueness is now handled at the **asset** level (§5), not by rewriting queries.

---

## 2. Where it sits in the pipeline

```text
LLM_CONTENT_GENERATION
  → PROMPT_GENERATION        # image query rules injected here
  → LLM_REQUEST
  → CONTENT_VALIDATION       # query hygiene safety net runs here
IMAGE_QUERY_GENERATION       # telemetry marker; queries already exist on the payload
IMAGE_RETRIEVAL              # one SearchService call per image slot
RESPONSE_ASSEMBLY
```

`IMAGE_QUERY_GENERATION` is a telemetry-only stage. The queries are produced inside the content LLM call — there is no separate query-generation model.

Orchestration lives in [`flashcard-orchestrator.service.ts`](../../src/modules/flashcards/services/flashcard-orchestrator.service.ts): cards are assembled **sequentially**, and within a card the image slots run **concurrently** through `mapWithConcurrency` (bounded by `FLASHCARD_IMAGE_CONCURRENCY`).

---

## 3. The query contract

The content LLM returns one `ImageSearchQuery` per image `componentId`:

```ts
interface ImageSearchQuery {
  searchQuery: string;        // the ONLY field retrieval uses
  expectedObjects: string[];  // validation + sanitizer fallback
  preferredStyle?: string;    // metadata only
  preferredBackground?: string;
  orientation?: string;
  educationalUse?: string;
}
```

Only `searchQuery` reaches the vector search. `preferredStyle` and `preferredBackground` are carried for downstream consumers but do **not** influence retrieval — which is why the prompt requires the style word to appear inside `searchQuery` itself.

Slots are keyed by `componentId` and are fully independent. Two image components never share a query by position; `image-{x}` placeholders are expanded to the concrete ids the LLM returned (`image-1`..`image-N`) before retrieval.

---

## 4. Why query wording decides accuracy

This is the part that is easy to get wrong, so it is worth understanding the other side of the comparison.

During ingestion, [`search-description.builder.ts`](../../src/modules/ai/utils/search-description.builder.ts) flattens the vision model's metadata into one newline-joined `searchDescription`, and **that string is what gets embedded** ([`asset-pipeline.service.ts`](../../src/modules/pipeline/services/asset-pipeline.service.ts)). A real stored asset looks like:

```text
A cheerful cartoon brown ant smiling on a solid black background   <- caption
cartoon ant, insect, bug, antennae, legs, oval shape               <- objects (+ synonyms)
smiling, standing, looking up                                      <- actions
cartoon, digital illustration, vector style, child friendly        <- styles
brown, black, blue, pink                                           <- colors
solid black                                                        <- background
centered, single isolated character, close-up                      <- composition
nursery flashcards, LKG alphabet learning, insect unit study       <- educational_uses
cute ant, brown bug, letter a for ant, preschool bug activity      <- search_keywords
```

The first seven lines are **visual and discriminating**. The last two are **pedagogy boilerplate that nearly every asset carries**, so they match everything equally and contribute no signal — while still consuming similarity budget.

That produces the observed failure:

| Query | Result |
|---|---|
| `"cartoon ant insect"` | Correct ant. Almost every token matches the caption/objects/styles lines of the right asset. |
| `"ant insect on green leaf for letter tracing vocabulary learning"` | Wrong asset. Only 2 tokens describe the ant; `letter tracing`, `vocabulary`, `learning` match the boilerplate shared by tracing worksheets, which then outrank the actual ant. |

The LLM has no visibility into stored descriptions, so the prompt has to tell it what shape to write in.

### Prompt rules (`v7-asset-shaped-image-queries-line-art-gating`)

Defined in [`flashcard-prompt.constants.ts`](../../src/modules/flashcards/constants/flashcard-prompt.constants.ts) under *STANDARD image searchQuery fields*:

- Write the **visual** part of an asset description: art style → bare object noun → category noun. Typically **2–6 words**.
- Good: `cartoon ant insect`, `cartoon lion wild animal`, `cartoon strawberry fruit`.
- Forbidden — teaching-purpose/curriculum/audience words: `flashcard`, `educational`, `learning`, `teaching`, `lesson`, `vocabulary`, `recognition`, `practice`, `activity`, `worksheet`, `curriculum`, `study`, `for kids`, `preschool`, `nursery`, `LKG`, `UKG`, `toddler`.
- Forbidden — invented scenery/props/narrative: `on a green leaf`, `in a classroom`, `in the jungle`, `standing in grassland`.
- The category noun is the only extra noun allowed; it prevents sibling-topic collisions (fruit vs vegetable, letter glyph vs object starting with that letter).
- `BARE_EXACT_QUERY` slots (letter/number glyph images, e.g. `letterImage`) stay as the bare phrase — `"Letter Q"` — with no style words at all.

### Line-art gating

The library holds both finished coloured pictures and uncoloured line-art/outline drawings for tracing and colouring. Picking line art when the user wanted a normal picture is a visible defect, so the decision is **deterministic, not left to the model**.

`requestWantsLineArt()` in [`image-query.util.ts`](../../src/modules/flashcards/utils/image-query.util.ts) scans the user's `query`, `topic`, `learningObjective`, and `subject` for tracing/colouring/outline/sketch/handwriting intent, and the prompt gets one of two branches:

- **Not requested (default):** `searchQuery` must not contain `line art`, `lineart`, `outline`, `black and white`, `coloring`, `colouring`, `sketch`, `silhouette`, `trace`, `tracing`. Use `cartoon`.
- **Requested:** put exactly one line-art term on **only** the slots that must show the uncoloured drawing — never on every slot by default.

### Removal-only sanitizer (safety net)

Prompts drift, so [`sanitizeCardImageQueries()`](../../src/modules/flashcards/utils/image-query.util.ts) runs in `FlashcardContentService` right after content validation. It is strictly **removal-only** — it never invents wording:

1. Strips pedagogy phrases from each slot's own `searchQuery`.
2. Strips line-art terms unless `requestWantsLineArt()` is true.
3. Tidies dangling connectors (`for`, `on`, `with`, …) left behind.
4. If nothing visual survives, falls back to the LLM's own `expectedObjects[0]`; if that is empty too, keeps the original untouched.
5. Letter/number glyph queries (`Letter Q`, `number 9`) are skipped entirely.

Because it mutates the payload **before** assembly, the query stored on the card, shown in telemetry, and sent to asset search are guaranteed to be the same single string. Every change is logged:

```text
WARN [FlashcardContentService] Image query noise stripped on card 0 "hero":
  "cartoon ant insect for preschool vocabulary learning" -> "cartoon ant insect"
```

---

## 5. Retrieval algorithm

Per image slot, in `retrieveForCard()`:

```text
normalizeQuery(queries[0])
  └─ empty? → IMAGE_NOT_FOUND (no search performed)

searchOnce(searchQuery)
  ├─ emit IMAGE_SEARCH_STARTED
  ├─ searchWithEmbeddingRetry()          # same query only; see below
  ├─ emit embedding AI usage (skipped on cache hit)
  ├─ claimHit() → top-similarity asset not already used in this set
  │    └─ none? → emit COMPLETED(selectedAssetId: null) → IMAGE_NOT_FOUND
  ├─ getSignedUrl()                       # failure is non-fatal, logged
  ├─ loadAssetColors() + resolveFlashcardBrandColor()
  └─ emit IMAGE_SEARCH_COMPLETED → AssetReference{ status: 'found' }
```

### Ranked window, single call

The search runs once with `limit: FLASHCARD_IMAGE_SEARCH_LIMIT` (default **8**). The window is >1 not to allow retries, but so the **same** result list can supply a 2nd or 3rd choice for set-level dedupe. There is no similarity threshold — semantic search over a varied library essentially always returns something, and the top-ranked unused hit is taken.

Inside `SearchService`, the query is embedded (OpenAI), compared by pgvector cosine distance against the latest embedding per asset (`similarity = 1 - distance`), metadata-filtered, and sliced to `limit`. Letter queries take a dedicated canonical-object path via `LetterQueryDetectorService`.

### Set-level dedupe — never the same image twice

A single `usedAssetIds: Set<string>` is created once per generate request and threaded through every slot of every card.

`claimHit()` serialises selection behind a promise chain (`pickLock`) so concurrent slots cannot claim the same asset in a race. `selectTopUnusedHit()` then sorts the ranked list by similarity descending and returns **the first asset not already in `usedAssetIds`** — so if this query's top hit is already on another card, it takes 2nd, then 3rd, from that same result list. No second query is issued.

If every hit in the window is already used, the slot resolves to `IMAGE_NOT_FOUND` rather than duplicating an image.

### Embedding retry — failures only, never rewording

`searchWithEmbeddingRetry()` retries **the identical query string** when the embedding/search call *throws* (timeout, rate limit, provider 5xx):

- Up to `FLASHCARD_IMAGE_EMBEDDING_MAX_ATTEMPTS` (default **3**), spaced by `FLASHCARD_IMAGE_EMBEDDING_RETRY_DELAY_MS` (default **200ms**).
- An `HttpException` with status **< 500** (e.g. a content-restriction `400`) is rethrown immediately — retrying a rejected query is pointless.
- Exhausting retries yields status `error`, not `IMAGE_NOT_FOUND`.

A *successful* search returning zero results is **not** a failure and is never retried.

---

## 6. Outcomes

`AssetReference` returned per slot:

```jsonc
{
  "assetId": "…",
  "s3ObjectKey": "assets/…/original.png",
  "signedUrl": "https://…",                       // null if S3 presign failed
  "imageUrl": "/flashcards/assets/…/image",        // same-origin proxy, avoids CORS
  "userUploadedKey": null,
  "caption": "cartoon ant",
  "similarity": 0.91,
  "mimeType": "image/png",
  "status": "found",
  "queryUsed": "cartoon ant insect",               // exactly what was searched
  "attempts": ["semantic"],                        // always single-element now
  "colors": ["brown", "black"],
  "color": "#8B5A2B"                               // brand colour for card theming
}
```

| `status` | Meaning |
|---|---|
| `found` | Asset claimed and attached. |
| `IMAGE_NOT_FOUND` | Empty/missing query, zero results, or every ranked hit already used. |
| `error` | Search threw and embedding retries were exhausted. |

One failed slot never fails the set — the card is returned with an empty reference and `FINAL_VALIDATION` accepts it, since it only requires the reference **object** to exist.

`imageUrl` is the same-origin proxy path and is what renderers should prefer; `signedUrl` is a direct S3 URL that expires after `FLASHCARD_SIGNED_URL_TTL_SECONDS`.

---

## 7. Telemetry

All events carry `stageName: image_retrieval`.

| Event | Payload |
|---|---|
| `IMAGE_SEARCH_STARTED` | `searchId`, `query` |
| `IMAGE_SEARCH_COMPLETED` | `searchId`, `query`, `resultCount`, `selectedAssetId`, `cacheHit`, `failed`, `errorMessage?`, `durationMs` |
| `AI_STARTED` / `AI_COMPLETED` | purpose `flashcard_image_search_embedding`, provider `openai`, `inputTokens`, `totalTokens`, `durationMs` |

Because retrieval is one call per slot, **the number of `IMAGE_SEARCH_*` pairs equals the number of image components across the set.** 3 cards × 1 image = 3 searches. Anything more means a cascade has been reintroduced.

Redis-cached searches return `fromCache: true` with zeroed usage, and the embedding AI events are skipped so token accounting is not inflated by cache hits.

---

## 8. Configuration

| Env var | Default | Purpose |
|---|---|---|
| `FLASHCARD_IMAGE_SEARCH_LIMIT` | `8` | Ranked hits per query; supplies 2nd/3rd choice for dedupe. Setting `1` breaks dedupe. |
| `FLASHCARD_IMAGE_CONCURRENCY` | `3` | Parallel image slots within one card. |
| `FLASHCARD_IMAGE_EMBEDDING_MAX_ATTEMPTS` | `3` | Total attempts for the same query on failure. |
| `FLASHCARD_IMAGE_EMBEDDING_RETRY_DELAY_MS` | `200` | Delay between those attempts. |
| `FLASHCARD_IMAGE_PICKER_LIMIT` | `10` | Results for the manual library picker. |
| `FLASHCARD_SIGNED_URL_TTL_SECONDS` | `3600` | S3 presign lifetime. |
| `FLASHCARD_USER_UPLOAD_S3_PREFIX` | `flashcards/uploads` | Prefix for user-uploaded replacements. |

Typed in [`configuration.ts`](../../src/config/configuration.ts) under `flashcards.*`; defaults mirrored in [`flashcard.constants.ts`](../../src/modules/flashcards/constants/flashcard.constants.ts).

---

## 9. Post-generation image paths

Handled by [`flashcard-edit.service.ts`](../../src/modules/flashcards/services/flashcard-edit.service.ts), all reusing the same retrieval service:

| Action | Path |
|---|---|
| Regenerate an image from a natural-language instruction | LLM produces a new `ImageSearchQuery` (seeded with the current `queryUsed`) → `retrieveForCard()`. Still one search. |
| Browse the library | `searchCandidates(query, limit)` → up to `imagePickerLimit` results with caption, `searchDescription`, and colours. |
| Pick a specific asset | `resolveLibraryAsset(assetId)` — direct DB lookup, no search. |
| Upload a replacement | `uploadUserImage()` → S3 under the upload prefix; `applyUserUploadedImage()` sets `userUploadedKey` and a proxy `imageUrl`, clearing `assetId`. |

Note these edit paths pass no `usedAssetIds`, so a manual regenerate may legitimately land on an image already used elsewhere in the set.

## 10. Country restrictions

`countryCode` flows from the request through `retrieveForCard()` into `SearchService.search()`, which calls `assertSearchQueryAllowed(query, countryCode)`. A restricted query raises a `4xx` that bypasses embedding retries and surfaces as `error`. The default comes from `flashcards.defaultCountryCode`.

---

## 11. Troubleshooting

| Symptom | Likely cause |
|---|---|
| More Assets searches than image components | A cascade/rewrite was reintroduced. `attempts` should always be `["semantic"]`. |
| Retrieved image doesn't match the card's word | Pedagogy or scenery words in `searchQuery`. Check the `Image query noise stripped` warnings and the raw LLM payload in the tracker. |
| Line art returned for a normal request | `requestWantsLineArt()` matched something in query/topic/objective/subject, or the term survived sanitising. |
| Same image on multiple cards | `FLASHCARD_IMAGE_SEARCH_LIMIT=1` leaves no alternates, or the slots ran through separate requests (no shared `usedAssetIds`). |
| `IMAGE_NOT_FOUND` on a common object | Query still carries boilerplate, or every ranked hit was already claimed earlier in the set. |
| `error` status | Embedding/search threw. Check for a `4xx` (content restriction) versus exhausted retries in the logs. |

---

## 12. Code map

| Concern | Path |
|---|---|
| Retrieval service | `src/modules/flashcards/services/flashcard-image-retrieval.service.ts` |
| Orchestration + shared `usedAssetIds` | `src/modules/flashcards/services/flashcard-orchestrator.service.ts` |
| Query hygiene + line-art intent | `src/modules/flashcards/utils/image-query.util.ts` |
| Prompt image rules | `src/modules/flashcards/constants/flashcard-prompt.constants.ts` |
| Sanitizer wiring | `src/modules/flashcards/services/flashcard-content.service.ts` |
| Semantic search | `src/modules/search/search.service.ts`, `vector-storage.service.ts` |
| Asset description that gets embedded | `src/modules/ai/utils/search-description.builder.ts` |
| Edit / picker / upload | `src/modules/flashcards/services/flashcard-edit.service.ts` |

Tests: `flashcard-image-retrieval.service.spec.ts` (single search, top-unused selection, retry semantics), `image-query.util.spec.ts` (sanitising, line-art intent), `flashcard-prompt.constants.spec.ts` (prompt rules and line-art branches).
