# Component Validation Report

> **Last updated:** 2026-07-30  
> **Purpose:** Track manual real-service validation status for each pipeline component.  
> **Rule:** The coding agent marks implementation tasks COMPLETED; **real-service rows stay PENDING until you manually confirm.**

**Playbook:** See [Manual Component Validation Playbook](IMPLEMENTATION_PLAN.md#manual-component-validation-playbook) in `IMPLEMENTATION_PLAN.md`.

**Status values:** `PENDING` | `PASS` | `PASS_WITH_NOTES` | `FAIL` | `BLOCKED`

---

## Validation Summary

| Component | Validation | Result | Validated By | Date | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Google Drive | Real folder discovery | **PENDING** | | | `npm run validate:drive -- --folder-id <ID>` |
| Image Processing | Real image validation + hash | **PENDING** | | | `npm run validate:image -- --file <PATH>` |
| Duplicate Detection | Duplicate files reuse asset | **PENDING** | | | Ingest same image twice; verify single asset |
| S3 | Upload/download round-trip | **PENDING** | | | `npm run validate:s3 -- --file <PATH>` |
| Gemini Vision | Real image metadata | **PENDING** | | | `npm run validate:vision -- --file <PATH>` |
| Metadata DB | Persistence + versioning | **PENDING** | | | Query `AssetMetadata` after metadata stage |
| OpenAI Embedding | Real embedding generation | **PENDING** | | | `npm run validate:embedding -- --text "..."` |
| PGVector | Similarity search | **PENDING** | | | `npm run validate:vector -- --text "..." --top-k 5` |
| Semantic Search | Real queries | **PENDING** | | | `npm run validate:search -- --query "..."` |
| Metadata Filter | Filtered search | **PENDING** | | | `POST /search` with category/orientation filters |
| Redis | Cache miss/hit/flush | **PENDING** | | | `npm run validate:cache -- --query "..."` |
| SQS Worker | Real message processing | **PENDING** | | | Start app with workers; POST job; verify queue drain |
| Retry | Controlled transient failure | **PENDING** | | | Verify backoff + `ProcessingAttempt` records |
| DLQ | Permanent failure routing | **PENDING** | | | Verify single DLQ entry after max attempts |
| DLQ Replay | Replay from DLQ | **PENDING** | | | `POST /pipeline/dlq/replay` including VALIDATING stage |
| State Machine | Full state transitions | **PENDING** | | | Track asset through DISCOVERED → COMPLETED |
| Idempotency | Duplicate message handling | **PENDING** | | | Re-deliver message; no duplicate side effects |
| Observability | Asset trace in logs/metrics | **PENDING** | | | `GET /observability/metrics` + structured logs |

---

## Integration Validation (TASK-026)

| Test | Result | Validated By | Date | Notes |
| :--- | :--- | :--- | :--- | :--- |
| Full pipeline (3–5 real Drive images → search) | **PENDING** | | | See TASK-026 procedure in IMPLEMENTATION_PLAN.md |

---

## Production Readiness (TASK-027)

| Gate | Result | Approved By | Date | Notes |
| :--- | :--- | :--- | :--- | :--- |
| Infrastructure checklist | **PENDING** | | | |
| Pipeline checklist | **PENDING** | | | |
| Reliability checklist | **PENDING** | | | |
| Observability checklist | **PENDING** | | | |
| AI quality checklist | **PENDING** | | | |

---

## How to Update

1. Run the procedure from the playbook for each component.
2. Change **Result** to `PASS`, `PASS_WITH_NOTES`, `FAIL`, or `BLOCKED`.
3. Fill **Validated By**, **Date**, and **Notes** (include timings, costs, or issues).
4. After all components pass, run TASK-026 integration test and update that row.
5. Complete TASK-027 checklist and record approval before starting TASK-020 pilot migration.
