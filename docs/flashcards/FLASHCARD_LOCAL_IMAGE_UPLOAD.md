# Flashcard local image (upload from computer)

How the demo UI (`public/flashcards.html`) handles **Upload from computer**, how the image stays visible after card save, and how **Save all / Save selected** send it through render-and-notify.

This is **not** generation-time asset retrieval. Retrieval still uses the library only — see [`FLASHCARD_IMAGE_RETRIEVAL.md`](./FLASHCARD_IMAGE_RETRIEVAL.md).

---

## What changed

Previously the picker stored a `blob:` URL on `assetReference.imageUrl`. After **Save** on the card, `renderGrid()` rebuilt figures via `imageSourceFor`, which only treated `http` as absolute. `blob:` / `data:` were prefixed with `apiBase()` (`http://localhost:5000blob:…`), so the image vanished on every template.

`POST /flashcards/render-and-notify` also could not use `blob:` URLs: Playwright capture runs on the server and cannot resolve a browser blob.

The picker now reads the file as a **data URL** and leaves it on the in-memory card payload. Relative library paths still get `apiBase()`. Absolute `http(s):`, `data:`, and `blob:` are used as-is (`imageSourceFor` in the HTML; `resolveImageSource` in the renderer).

---

## Contract

The user’s file is **not** uploaded to the app asset library or `flashcards/uploads`.

| Step | What is stored |
|---|---|
| Pick file / apply to card | Data URL on `assetReference.imageUrl` (and `signedUrl`) in `state.payload` only |
| Card Save | Same data URL kept on the card; grid re-renders from payload |
| Save all / Save selected | JSON payload (including data URLs) → `POST /flashcards/render-and-notify` |
| After notify | Only the **rendered card PNG** is uploaded to Gyan `/api/gyan/V1/media/upload-media` |
| Parent | Existing `postMessage`: `grade`, `flowType`, `cards` (media rows), `query` |

`assetId` and `userUploadedKey` stay `null` on this path. The optional API `POST /flashcards/:id/images/upload` (S3 user-upload prefix) is unused by this picker.

---

## Client flow (`public/flashcards.html`)

1. Camera / picker while editing → Search tab (library) or Upload tab.
2. File chosen → size cap **10MB** (`LOCAL_IMAGE_MAX_BYTES`, same as `FLASHCARD_USER_UPLOAD_MAX_BYTES`) → `FileReader.readAsDataURL`.
3. Preview and `selectedSearchItem` hold that data URL.
4. Select image writes `assetReference`:
   - `status: 'found'`
   - `imageUrl` / `signedUrl`: data URL
   - `assetId: null`, `userUploadedKey: null`
   - `queryUsed` / search prefill: card title or paired text — **not** the file name when it is a camera dump (`IMG_….jpg`, screenshots, UUIDs). Re-opening the picker searches that card text.
5. `state.imageCache` maps the data URL to itself so preload does not `fetch()` it.
6. Card Save reapplies pending replacements and `renderGrid()`. Data URLs survive because `imageSourceFor` does not prefix them.
7. Cancel / discard restores the pre-edit snapshot (local image dropped if not saved).

Library picks are unchanged: `assetId` + `/flashcards/assets/{id}/image`.

---

## Save all / Save selected

`saveAndNotify` POSTs the in-memory payload (selected cards only) plus `grade` and `auth` query token.

`FlashcardsController.renderAndNotify`:

1. For each card, `downloadFromPayload` → Playwright on `/flashcards.html` with `__FLASHCARD_CAPTURE__`.
2. Capture uses the same `imageSourceFor`, so data URLs paint in the screenshot.
3. PNG is POSTed to `flashcards.upload.apiUrl` (default Gyan `upload-media`).
4. Response `cards` are `{ url, signedUrl, s3Key, folder, fileName, mediaId }` for those **card** files.

Nest JSON / urlencoded body limit is **20mb** in `src/main.ts` so a few data-URL slots fit.

---

## Cases

| Case | Client | Notify |
|---|---|---|
| Library pick | Proxy `imageUrl` | Capture fetches proxy, uploads card PNG |
| Computer pick (≤10MB) | Data URL in payload | Capture paints data URL, uploads card PNG |
| File &gt; 10MB | Toast; not applied | — |
| FileReader fail | Toast; not applied | — |
| Apply then card Cancel | Snapshot restored | — |
| Retrieval miss (`IMAGE_NOT_FOUND` / `error`) | Placeholder | Card PNG still uploaded |
| Selection mode, no cards | Toast; no request | — |
| Reload / new generate | Memory cleared; local images gone | — |

---

## Code map

| Concern | Path |
|---|---|
| Picker, data URL, `imageSourceFor`, save-and-notify | `public/flashcards.html` |
| Absolute URL rule (Playwright HTML renderer) | `src/modules/flashcards/flashcard-renderer/utils/image-source.util.ts` |
| Capture + PNG | `src/modules/flashcards/services/flashcard-download.service.ts`, `flashcard-pdf.service.ts` |
| Upload-media + postMessage payload | `src/modules/flashcards/flashcards.controller.ts` (`renderAndNotify`) |
| JSON body limit | `src/main.ts` |
| Unused by this UI path (API S3 user upload) | `FlashcardEditService.uploadImage` / `uploadUserImage()` |

---

## Related

- [`FLASHCARD_IMAGE_RETRIEVAL.md`](./FLASHCARD_IMAGE_RETRIEVAL.md) — generate-time library search
- [`FLASHCARD_GENERATION_ARCHITECTURE.md`](./FLASHCARD_GENERATION_ARCHITECTURE.md) — pipeline boundaries
- [`PROGRESSIVE_CARD_DELIVERY.md`](./PROGRESSIVE_CARD_DELIVERY.md) — stream generate (unchanged by local upload)
