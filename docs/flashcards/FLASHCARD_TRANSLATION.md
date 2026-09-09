# Flashcard / Worksheet Translation

Orthogonal localization layer on top of English-canonical generation.
Uses **Google Cloud Translation (v2)** with **service-account credentials** (same pattern as Google Drive).

## Flow

```text
POST /flashcards/generate  →  English JSON + images
Frontend language change   →  POST /flashcards/translate { language, content }
                           →  GCP Cloud Translation (service account)
                           →  Translated JSON
```

Same for `POST /worksheets/translate`. Generation and image retrieval are never re-run.

## Auth

Cloud Translation does **not** accept AI Studio / Gemini API keys. Use a service account:

| Variable | Purpose |
|---|---|
| `GOOGLE_TRANSLATION_CREDENTIALS_PATH` | Optional dedicated SA JSON |
| `GOOGLE_TRANSLATION_CLIENT_EMAIL` / `PRIVATE_KEY` | Optional dedicated SA |
| `GOOGLE_TRANSLATION_PROJECT_ID` | Optional; else from SA JSON / `GOOGLE_CLOUD_PROJECT` |

If translation-specific vars are unset, credentials fall back to `GOOGLE_DRIVE_*` (already used in this repo).

Enable **Cloud Translation API** on the GCP project and grant the service account access (e.g. Cloud Translation User).

## Other config

| Variable | Purpose |
|---|---|
| `TRANSLATION_ENABLED` | Default `true` |
| `TRANSLATION_MAX_BATCH_SIZE` | Default `100` |
| `TRANSLATION_MAX_BATCH_CODE_UNITS` | Default `25000` |
| `REDIS_TRANSLATION_CACHE_TTL_SECONDS` | Fragment cache TTL |

## Code

| Piece | Path |
|---|---|
| Provider | `src/modules/translation/providers/gcp-translation.provider.ts` |
| Service | `src/modules/translation/translation.service.ts` |
| Endpoints | `POST /flashcards/translate`, `POST /worksheets/translate` |
