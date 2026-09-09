# Flashcard / Worksheet Translation

Orthogonal localization layer on top of English-canonical generation.
Uses **Google Cloud Translation — Basic (v2)**.

## Auth (pick one)

### 1. Standard GCP API key (preferred)

Cloud Translation **Basic (v2)** supports API keys. Advanced (v3) does not.

| Variable | Purpose |
|---|---|
| `GOOGLE_TRANSLATION_API_KEY` | GCP Console API key with Cloud Translation API enabled |
| `GOOGLE_TRANSLATION_PROJECT_ID` | Project used for billing / quota |

**Not** a Google AI Studio / Gemini key (`AQ.…`). Use a key from  
Google Cloud Console → APIs & Services → Credentials → API key.

### 2. Service account (fallback)

Used only when `GOOGLE_TRANSLATION_API_KEY` is empty.

| Variable | Purpose |
|---|---|
| `GOOGLE_TRANSLATION_CREDENTIALS_PATH` | SA JSON path |
| `GOOGLE_TRANSLATION_CLIENT_EMAIL` / `PRIVATE_KEY` | SA credentials |
| or `GOOGLE_DRIVE_*` | Same SA already used for Drive |

## Flow

```text
POST /flashcards/translate | /worksheets/translate
  → extract translatable strings
  → GCP Translation v2 (batched)
  → reconstruct JSON
```

Generation and image retrieval are never re-run.

## Other config

| Variable | Default |
|---|---|
| `TRANSLATION_ENABLED` | `true` |
| `TRANSLATION_MAX_BATCH_SIZE` | `100` |
| `TRANSLATION_MAX_BATCH_CODE_UNITS` | `25000` |
| `REDIS_TRANSLATION_CACHE_TTL_SECONDS` | `86400` |

## Code

| Piece | Path |
|---|---|
| Provider | `src/modules/translation/providers/gcp-translation.provider.ts` |
| Service | `src/modules/translation/translation.service.ts` |
| Endpoints | `POST /flashcards/translate`, `POST /worksheets/translate` |
