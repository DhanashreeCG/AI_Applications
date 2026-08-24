# Progressive Card Delivery

Incremental flashcard generation: assemble cards concurrently, stream each one to the client as soon as it is ready, and paint it in the existing HTML grid instead of waiting for the whole set.

This is the working tracker. Update the status table as work lands.

---

## What we are building

```text
POST /flashcards/generate/stream   (NDJSON)
        │
        ├─ meta     template + layout + count     → UI can size the grid
        ├─ card     assembled card N              → replace that skeleton
        ├─ ping     heartbeat every 15s           → keep idle sockets alive
        ├─ done     full GenerateFlashcardsResponse (compat / save / download)
        └─ error    pipeline failure after 0..N cards
```

Constraints we will not break:

- One generate request, one `usedAssetIds` set. Cross-card image uniqueness stays server-side.
- The LLM still produces the whole set in one content call (outline-then-fan-out is later).
- `POST /flashcards/generate` remains the non-streaming JSON contract.
- Downstream save / edit / download keep reading the same `state.payload` shape.

---

## Status

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Concurrent image embedding + vector search across cards | **Done** | Sequential `for` over cards replaced with `mapWithConcurrency`. Slot-level concurrency was already in place. `claimHit` / `pickLock` keeps `usedAssetIds` race-free. |
| 2 | Card-level concurrency config | **Done** | `FLASHCARD_CARD_CONCURRENCY` (default 3) in `configuration.ts` + `DEFAULT_CARD_CONCURRENCY`. Worst-case in-flight searches ≈ card × image concurrency. |
| 3 | Orchestrator progress callbacks | **Done** | `onMeta` after template selection, `onCard` after each `assembleCard`. Failures in the callback never fail the pipeline. |
| 4 | NDJSON stream endpoint | **Done** | `POST /flashcards/generate/stream`. Events: `meta`, `card`, `done`, `error`, `ping`. `X-Accel-Buffering: no` + 15s heartbeat. |
| 5 | HTML progressive grid | **Done** | `generate()` reads the stream, keeps N skeleton slots, replaces each slot as its card arrives, tracks `received / count` in the toast. |
| 6 | Keep `POST /generate` working | **Done** | Unchanged JSON path. Streaming is additive. |
| 7 | Outline-then-fan-out LLM (first card before the big content call) | **Remaining** | Today `onMeta` is the only event before the single content LLM call finishes. First `card` still waits on that call. See §Next. |
| 8 | Partial-failure product decision | **Remaining** | If the stream errors after 3 of 5 cards the UI keeps what it has and shows a banner. Confirm whether we should discard, retry the missing slots, or persist a partial set. |
| 9 | Proxy / compression soak | **Remaining** | Verify the stream is not buffered by any reverse proxy in front of Nest in staging/prod. |
| 10 | Tests | **Remaining** | Orchestrator concurrency + stream event order. Frontend is static HTML — cover via a small controller/orchestrator spec. |

---

## What shipped in this change

### Concurrent image retrieval

Cards used to assemble one-by-one:

```ts
for (const card of llmPayload.cards) {
  cards.push(await assembleCard(card));
}
```

That serialised every embedding + pgvector search even though slots *inside* a card already ran through `mapWithConcurrency`. Now cards themselves run through the same helper, bounded by `FLASHCARD_CARD_CONCURRENCY`.

Image uniqueness is unchanged: `FlashcardImageRetrievalService.claimHit` serialises the `usedAssetIds.add` behind `pickLock`, so two in-flight cards cannot claim the same asset.

### Streaming delivery

`FlashcardOrchestratorService.generate(..., { progress })` is transport-agnostic. The stream controller writes NDJSON; a future job/polling path can reuse the same callbacks.

Event shapes:

```jsonc
{"type":"meta","count":5,"request":{...},"template":{...},"layoutDefinition":{...}}
{"type":"card","slotIndex":0,"card":{"cardId":"card-1","cardIndex":1,"components":[...]}}
{"type":"ping"}
{"type":"done","payload":{ /* full GenerateFlashcardsResponse */ }}
{"type":"error","code":"INVALID_LLM_OUTPUT","message":"..."}
```

`slotIndex` is the position in the LLM payload (stable even if cards finish out of order). The UI prefers `cardId`, then `slotIndex`, then the next empty skeleton.

### HTML loading match

- Before the request: N generic `.skeleton` tiles, toast `Generating 0/N`.
- On `meta`: same N slots, summary pills update from the real template/topic.
- On each `card`: that skeleton is replaced with a real `.tile` via `replaceSkeletonAt`. Toast becomes `Generating k/N`.
- On `done` / stream end: null slots are dropped, `renderGrid()` re-syncs pagination, toast `N cards ready`.
- On `error` with zero cards: grid resets. On `error` after some cards: keep what arrived.

Save / download / edit continue to use `state.payload` once the stream finishes.

---

## Next (do not start unless asked)

1. **Outline-then-fan-out content.** One cheap LLM call for N distinct subjects, then N parallel `regenerateCard`-style calls. That is the only remaining way to get card 1 onto the screen before the current ~content-call latency. `regenerateCard` already exists with `count: 1`.
2. **Partial set persistence.** Decide whether `POST /flashcards/save` accepts `cards.length < request.count`.
3. **Specs** for stream event order and concurrent `usedAssetIds` claiming.

---

## Code map

| Concern | Path |
|---|---|
| Card concurrency default | `src/modules/flashcards/constants/flashcard.constants.ts` |
| Env wiring | `src/config/configuration.ts` (`flashcards.cardConcurrency`) |
| Concurrent assemble + progress | `src/modules/flashcards/services/flashcard-orchestrator.service.ts` |
| Image claim lock | `src/modules/flashcards/services/flashcard-image-retrieval.service.ts` (`claimHit`) |
| NDJSON endpoint | `src/modules/flashcards/flashcards.controller.ts` (`POST generate/stream`) |
| Progressive UI | `public/flashcards.html` (`generate`, `readNdjsonStream`, `replaceSkeletonAt`) |
| Shared concurrency helper | `src/modules/flashcards/flashcard-renderer/utils/concurrency.util.ts` |
