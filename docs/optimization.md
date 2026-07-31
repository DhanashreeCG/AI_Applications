# Image Ingestion Pipeline — Token-Saving Implementation Priorities

## Priority 0 — Must Fix Before Spending Money

### 1. Stage-Level Idempotency ⭐⭐⭐⭐⭐

**Problem:** A worker can successfully call an AI provider, save the result, and then crash. A replay may call the provider again and create unnecessary cost.

**Required behavior:**

```text
Worker
  ↓
Check stage result
  ↓
Already exists?
  ├─ YES → Skip provider call
  └─ NO  → Call provider → Persist result
```

Apply this independently to every stage:

```text
Metadata exists?
  YES → Skip Gemini

Embedding exists?
  YES → Skip OpenAI
```

**Goal:** Replays must never regenerate completed stages.

---

### 2. Resume From Last Completed Stage ⭐⭐⭐⭐⭐

Track stage completion explicitly.

Example:

```text
S3 ✓
Metadata ✓
Embedding ✗

        ↓

Resume at embedding stage
```

Never restart from the beginning when previous stages are already complete.

Suggested state:

```text
DISCOVERED
DOWNLOADED
HASHED
UPLOADED
METADATA_COMPLETED
EMBEDDING_COMPLETED
COMPLETED
```

The worker should determine the next incomplete stage and continue from there.

---

### 3. Remove the Double Drive Download ⭐⭐⭐⭐☆

Current:

```text
Discovery
  ↓
Download image
  ↓
Worker
  ↓
Download image again
```

Preferred:

```text
Discovery
  ↓
Enumerate Drive metadata only
  ↓
Queue asset
  ↓
Worker
  ↓
Download image once
```

Discovery should not download image content unless required for a specific validation step.

---

### 4. Prevent AI Rebilling During Retries ⭐⭐⭐⭐⭐

Separate retries into two cases.

#### Case A — Failure before provider call

Safe to retry:

```text
Worker
 ↓
Validation / preparation
 ↓
Provider call
```

#### Case B — Provider succeeded, persistence failed

Do **not** blindly call the provider again.

Use durable stage state/provider request tracking:

```text
Provider call succeeded
        ↓
Persist result
        ↓
Worker crashes
        ↓
Replay
        ↓
Reuse existing provider result
```

The persistence strategy should make the provider call effectively idempotent from the pipeline's perspective.

---

# Priority 1 — Strongly Recommended

## 5. Add Dry-Run Mode

Before a large ingestion, support:

```text
Drive
 ↓
Enumerate
 ↓
Download
 ↓
Hash
 ↓
Duplicate detection
 ↓
STOP
```

Dry-run must perform **no**:

- S3 upload
- Gemini call
- OpenAI call
- Embedding generation

Output:

```text
Images discovered: 100
Duplicates: 18
Unique images: 82

Expected Gemini calls: 82
Expected embedding calls: 82

Estimated AI cost:
Gemini: $X.XX
OpenAI: $Y.YY
```

This should be available before every large ingestion.

---

## 6. Cost Estimation Before Execution

Calculate expected work from the actual asset state.

Example:

```text
Discovered: 100
Duplicates: 18
Already processed: 12
New assets: 70

Expected Gemini calls: 70
Expected embedding calls: 70
```

The estimator should account for existing completed stages.

**Important:** Do not estimate cost simply as:

```text
total images × AI cost
```

Instead:

```text
images requiring metadata × metadata cost
+
images requiring embeddings × embedding cost
```

---

## 7. Better Duplicate Detection Reporting

Do not only store:

```text
Duplicate
```

Store:

```text
Existing Asset: asset_123
New Source: drive_file_456
Reason: SHA-256 match
```

This makes duplicate detection auditable and proves that duplicate assets avoided unnecessary AI processing.

---

## 8. AI Usage Logging

For every provider call, record:

```text
Asset ID
Stage
Provider
Model
Start time
End time
Latency
Retry count
Input tokens (where available)
Output tokens (where available)
Total tokens (where available)
Estimated cost
Request status
```

Example:

```text
asset_123
stage: metadata
provider: Gemini
model: <model>
latency: 2.4s
retry_count: 0
input_tokens: 820
output_tokens: 180
estimated_cost: $X.XX
status: success
```

This enables accurate post-run cost analysis.

---

# Priority 2 — Operational Improvements

## 9. Provider-Side Rate Limiting

Do not rely only on worker concurrency.

Use configurable provider throttling:

```text
Workers
  ↓
Provider rate limiter
  ↓
Gemini / OpenAI
```

This lets you increase worker count without accidentally overwhelming providers.

Configuration should be adjustable without redeploying workers if possible.

---

## 10. Add Circuit Breakers

Example:

```text
Gemini
 ↓
429
 ↓
429
 ↓
429
 ↓
Circuit opens
 ↓
Pause Gemini requests
```

After a cooldown:

```text
Half-open
 ↓
Test request
 ↓
Success → Resume
Failure → Keep circuit open
```

This prevents repeated failed calls and unnecessary retries.

---

## 11. Validate Queue Visibility Timeout

Make sure the queue visibility timeout is longer than the maximum expected processing time.

Example:

```text
Message visibility timeout
        >
download
+
Gemini
+
embedding
+
persistence
+
safety margin
```

Otherwise, another worker may receive the same message while the first worker is still processing it.

That can create duplicate work and potentially duplicate AI calls.

---

## 12. Better Retry Classification

### Retry

- 429 rate limit
- Network timeout
- Temporary 5xx
- Temporary provider unavailable
- Transient S3/DB failure

### Do not retry automatically

- Invalid image
- Unsupported MIME type
- Authentication/configuration errors
- Malformed request
- Permanent validation failure

Example:

```text
429 → exponential backoff → retry
Timeout → exponential backoff → retry
500 → exponential backoff → retry

401 → STOP + alert
400 malformed request → STOP
Invalid image → mark failed
```

---

# Priority 3 — Search Quality

## 13. Review Gemini Metadata Before Large Ingestion

Before processing thousands of images:

1. Process a small sample.
2. Manually inspect 20–30 images.
3. Evaluate generated metadata.

Ask:

- Would these terms actually be used for search?
- Are important objects missing?
- Are visual attributes captured?
- Is the educational context useful?
- Are descriptions too generic?
- Are irrelevant terms being generated?

Improve the prompt before running the full ingestion.

---

## 14. Verify Embedding Quality

Test representative searches:

```text
elephant
cartoon elephant
grey elephant
animal holding balloon
```

Check whether returned images are consistently relevant.

Do not scale to thousands of images until retrieval quality is acceptable.

---

# Priority 4 — Performance Instrumentation

Track:

```text
Per-stage latency
Queue depth
Retry count
DLQ count
Worker utilization
AI request count
Successful AI request count
Failed AI request count
Estimated cost
Actual recorded provider usage
Duplicate count
Cache hit rate
```

Recommended pipeline view:

```text
                    ┌───────────────┐
                    │    Drive      │
                    └───────┬───────┘
                            ↓
                    ┌───────────────┐
                    │  Discovery    │
                    │ metadata only │
                    └───────┬───────┘
                            ↓
                    ┌───────────────┐
                    │ Queue / Worker│
                    └───────┬───────┘
                            ↓
                    ┌───────────────┐
                    │ Hash / Dedup  │
                    └───────┬───────┘
                            ↓
                  ┌─────────┴─────────┐
                  │                   │
             Duplicate             New
                  │                   │
                  ↓                   ↓
                STOP              S3 Upload
                                      ↓
                               Metadata Check
                                      ↓
                               Gemini if missing
                                      ↓
                              Embedding Check
                                      ↓
                              OpenAI if missing
                                      ↓
                                  COMPLETED
```

# Critical Design Rule

The most important rule for the entire ingestion system is:

> **Every expensive stage must be independently idempotent and resumable.**

That means:

```text
                Asset
                  ↓
        ┌─────────────────┐
        │ Stage State     │
        └────────┬────────┘
                 ↓
       ┌─────────────────────┐
       │ Result already      │
       │ exists?             │
       └─────────┬───────────┘
                 │
          ┌──────┴──────┐
         YES            NO
          │              │
        SKIP        Execute stage
                         ↓
                    Persist result
                         ↓
                      Mark done
```

This protects against:

- Worker crashes
- Queue retries
- Worker restarts
- Visibility timeout duplication
- Application crashes
- Partial processing
- Manual replay
- DLQ replay
- Deployment interruptions

## Recommended Minimum Database Tracking

At minimum, maintain per-asset stage state:

```text
asset_id
source_file_id
source_hash
s3_key

metadata_status
metadata_completed_at

embedding_status
embedding_completed_at

overall_status
last_error
retry_count

created_at
updated_at
```

For stronger auditing, maintain a separate AI usage table:

```text
ai_usage
---------
id
asset_id
stage
provider
model
request_id
started_at
completed_at
latency_ms
input_tokens
output_tokens
total_tokens
estimated_cost
status
retry_count
error_type
```

## Execution Strategy

For a large ingestion:

```text
1. DRY RUN
      ↓
2. Review duplicate count
      ↓
3. Review expected AI calls
      ↓
4. Review estimated cost
      ↓
5. Process small sample
      ↓
6. Validate metadata quality
      ↓
7. Validate embedding/search quality
      ↓
8. Start full ingestion
      ↓
9. Monitor queue + errors + cost
```

**Do not start a 10k+ image ingestion until stages 1–4 and stage-level idempotency are implemented.**
