# Assets & Search

## Asset (after successful FULL ingestion)

| Field | Notes |
|---|---|
| `id` | Asset id |
| `contentHash` | SHA-256; unique; used for dedup |
| `mimeType`, `fileSize`, `width`, `height` | From validation |
| `s3Bucket`, `s3ObjectKey` | Canonical image in S3 |
| `status` | Pipeline state (`STORED_IN_S3` … `COMPLETED`, `DEAD_LETTER`, …) |
| `metadata` | Gemini output (1:1) |
| `embeddings` | OpenAI vector(s) (pgvector 1536) |
| `sources` | Drive (or other) links; `linkReason` e.g. `SHA256_MATCH` on duplicates |

**Metadata fields:** `caption`, `objects`, `actions`, `styles`, `colors`, `background`, `composition`, `orientation`, `ageGroups`, `grades`, `educationalUses`, `searchKeywords`, `searchDescription`

Search only returns assets that have **both** metadata and an embedding.

---

## How to search

`POST /search`

```json
{
  "query": "cartoon elephant",
  "limit": 10,
  "filters": {
    "orientation": "landscape",
    "colors": ["blue"],
    "styles": ["cartoon"],
    "objects": ["elephant"],
    "actions": [],
    "ageGroups": [],
    "grades": [],
    "educationalUses": [],
    "background": "white"
  },
  "bypassCache": false
}
```

| Body field | Required | Notes |
|---|---|---|
| `query` | yes | Embedded with OpenAI; compared via pgvector |
| `limit` | no | Default 10 |
| `filters` | no | All optional; AND-style match on metadata |
| `bypassCache` | no | Skip Redis search cache |

`POST /search/cache/flush` — optional body `{ "scope": "search" | "asset-metadata" | "all" }`

---

## Search result

```json
{
  "query": "cartoon elephant",
  "total": 1,
  "fromCache": false,
  "results": [
    {
      "assetId": "...",
      "similarity": 0.87,
      "distance": 0.13,
      "caption": "...",
      "orientation": "landscape",
      "colors": ["blue"],
      "styles": ["cartoon"],
      "objects": ["elephant"],
      "actions": [],
      "ageGroups": [],
      "grades": [],
      "searchDescription": "...",
      "s3ObjectKey": "assets/.../original/....png",
      "mimeType": "image/png"
    }
  ]
}
```

| Response field | Meaning |
|---|---|
| `query` | Echo of request query |
| `total` | Number of items in `results` |
| `fromCache` | Present when served from Redis |
| `results[].similarity` / `distance` | Vector similarity scores |
| `results[].s3ObjectKey` | Path to image in the configured S3 bucket |
| other `results[]` fields | From `AssetMetadata` + asset mime type |
