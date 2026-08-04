---
name: Tracker Tokens Search UI
overview: Fix flashcard image retrieval to one search (limit 1), make pipeline-tracker token/duration accounting accurate for LLM and search-embedding calls, and persist/show flashcard AI responses on clickable stages in the monitoring UI.
todos:
  - id: single-search
    content: Collapse flashcard image retrieval to one SearchService call with limit 1; one tracker image-search event per card
    status: completed
  - id: tokens-timing
    content: Persist exact LLM/search-embedding tokens and durationMs; roll up totals on PipelineExecution metadata
    status: completed
  - id: ai-response-ui
    content: Always store flashcard LLM responsePayload; make stages clickable in pipeline-tracker.html to show AI response + stage metadata
    status: completed
  - id: tests
    content: Unit tests for single-search behavior and responsePayload persistence when storeAiPayload is false
    status: completed
isProject: false
---

# Accurate tokens, single image search, AI response in monitor

## Context (current gaps)

- Image retrieval in [`flashcard-image-retrieval.service.ts`](src/modules/flashcards/services/flashcard-image-retrieval.service.ts) runs a **4-attempt retry ladder** and calls search with `limit: 5` — that is why the tracker shows many image-search rows per card.
- LLM tokens/duration are emitted, but `PIPELINE_STORE_AI_PAYLOAD` defaults to **false**, so `responsePayload` is dropped and the UI only shows hashes.
- Search embeds the query via OpenAI inside [`SearchService`](src/modules/search/search.service.ts) but flashcard tracker never records that embedding’s tokens/latency.
- Tracker UI stages are not clickable; AI payloads are not shown.

Scope is the **flashcard generate workflow + pipeline-tracker UI** (not redesigning BullMQ ingestion). Ingestion already writes `AiUsage` for vision/embeddings.

---

## 1. Single image search per card

Change [`FlashcardImageRetrievalService.retrieveForCard`](src/modules/flashcards/services/flashcard-image-retrieval.service.ts):

- Remove the retry ladder (`simplified`, `object-only`, `unfiltered`).
- One call only: `searchService.search({ query: primaryQuery, limit: 1, filters: age filter if present })`.
- Use the single result (or null if none / already used). Prefer next unused asset only if `limit: 1` returned a duplicate of `usedAssetIds` — still **no second search**; mark `not_found` instead.
- Emit **one** `IMAGE_SEARCH_STARTED` / `IMAGE_SEARCH_COMPLETED` pair per card with accurate `durationMs`, `resultCount` (0 or 1), `selectedAssetId`, `cacheHit`.
- Drop `found_after_retry` status path for this flow (keep `found` | `not_found` | `timeout` | `error`).

Update unit expectations if any tests assumed multi-attempt behavior.

```mermaid
flowchart LR
  Card --> OneQuery
  OneQuery -->|"search limit=1"| SearchAPI
  SearchAPI --> AttachOrNull
```

---

## 2. Exact tokens and execution time in tracker

### LLM (Gemini flashcard content)

In [`flashcard-content.service.ts`](src/modules/flashcards/services/flashcard-content.service.ts):

- Keep reading Gemini `usageMetadata` for input/output/total tokens.
- Pass **explicit `durationMs`** on `emitAiCompleted` (wall clock around `generateContent`), and persist it in [`PipelineTrackerRepository.finishAiInvocation`](src/modules/pipeline-tracker/repository/pipeline-tracker.repository.ts) instead of only deriving from DB timestamps (avoids skew from async listener delay).
- On complete pipeline, roll up into execution `metadata`: `totalInputTokens`, `totalOutputTokens`, `totalTokens`, `llmDurationMs`, `imageSearchDurationMs`, `imageSearchCount`.

### Search embedding (OpenAI)

When flashcard image search runs (non-cache path), record a tracker AI invocation for the query embedding:

- Extend search response lightly: add optional `usage?: { inputTokens?, totalTokens?, latencyMs?, model?, fromCache? }` from `OpenAiEmbeddingProvider.getLastUsage()` inside `SearchService.executeSearch` (and `fromCache: true` with zero tokens on cache hit). Do **not** change the public search contract beyond additive optional fields.
- In image retrieval, on each (now single) search complete, if usage present and not cache-only, `emitAiStarted`/`emitAiCompleted` with `purpose: 'flashcard_image_search_embedding'`, tokens + `durationMs`.

### Stage timing

- Ensure stage `durationMs` remains from stage start/complete (already tracked).
- Attach compact stage `metadata` on LLM/image stages: e.g. `{ inputTokens, outputTokens, totalTokens }` / `{ resultCount, selectedAssetId, embeddingTokens, durationMs }` so the UI can show them when a stage is clicked.

### Metrics

- [`PipelineTrackerMetricsService`](src/modules/pipeline-tracker/services/pipeline-tracker-metrics.service.ts): continue recording LLM/image durations from completed events; include embedding AI calls in `aiCalls` / `llmDuration` only for true content LLM — track embedding under image-search metrics or a separate counter `embeddingCalls` to avoid mixing averages.

### UI summary

- In [`pipeline-tracker.html`](public/pipeline-tracker.html) execution header, show rolled-up totals from metadata: total tokens, LLM time, image-search time.

---

## 3. Show AI flashcard response on stage click

### Persistence

- Always persist **flashcard LLM `responsePayload`** (parsed cards JSON) into `PipelineAiInvocation.responsePayload`, independent of full prompt storage.
- Keep prompts hash-only unless `PIPELINE_STORE_AI_PAYLOAD=true` (prompts can be large).
- Change tracker service: `responsePayload` always written for successful flashcard content invocations; `promptPayload` still gated by the flag.

Also store a short copy on the `llm_response_validation` (or `llm_request`) stage `metadata.responsePreview` / link via `stageExecutionId` (already set when AI start finds open LLM stage).

### UI

Update [`public/pipeline-tracker.html`](public/pipeline-tracker.html):

- Make each stage row clickable.
- On click, expand an inline panel (or right-side sub-panel) showing:
  - Stage status, duration, retry count, stage metadata
  - Linked AI invocation(s) for that stage (`stageExecutionId` match, or `stageName` match): provider, model, tokens, duration, and **pretty-printed `responsePayload`** (flashcard cards JSON)
  - Linked image-search rows for `image_search` stage
- Non-AI stages show metadata only (e.g. template id).

No new API required if detail endpoint already returns `stages`, `aiInvocations` (with payloads), `imageSearches` — verify Prisma select includes `responsePayload` (full find already does).

---

## Files to touch

| File | Change |
|---|---|
| [`flashcard-image-retrieval.service.ts`](src/modules/flashcards/services/flashcard-image-retrieval.service.ts) | Single search, limit 1; emit embedding AI events from search usage |
| [`search.service.ts`](src/modules/search/search.service.ts) + search result interface | Optional `usage` / timing fields on response |
| [`flashcard-content.service.ts`](src/modules/flashcards/services/flashcard-content.service.ts) | Explicit durationMs; stage metadata tokens |
| [`pipeline-tracker.service.ts`](src/modules/pipeline-tracker/services/pipeline-tracker.service.ts) / repository | Always store responsePayload; accept durationMs; rollups on complete |
| [`pipeline-tracker.events.ts`](src/common/events/pipeline-tracker.events.ts) | Add optional `durationMs` on AI completed payload if missing |
| [`pipeline-tracker.html`](public/pipeline-tracker.html) | Clickable stages + payload viewer; totals |
| Specs for image retrieval / tracker / content | Cover single-search + payload persistence |

## Tests

- Image retrieval: one `search` call with `limit: 1`; no further calls when empty.
- Tracker: `responsePayload` saved when `storeAiPayload` is false; tokens + durationMs persisted.
- UI not unit-tested; manual check via `/pipeline-tracker.html` after generate.

## Out of scope

- Changing asset-ingestion BullMQ monitoring UI
- Multi-image components per card
- Storing full prompts by default
