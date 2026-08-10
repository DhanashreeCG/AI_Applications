---
name: Flashcard Revised Engine
overview: Align the flashcard generation backend with FLASH_CARD_REVISED.md — richer deterministic request analysis, topic-free template ranking, structured image queries with cascade retrieval, per-card regen, and response/stage contract updates. Do not change Rendering Engine, Asset Library, Search Service, embeddings, or storage.
todos:
  - id: phase0-contract
    content: Lock stage names + response contract; extend PIPELINE_STAGES with revised aliases
    status: completed
  - id: phase1-request
    content: "Request analysis: grade/subject/difficulty/language + phonics intent; DTO + resolver"
    status: completed
  - id: phase2-selection
    content: Rewrite template selection ranking (grade→objective→subject→difficulty→age→version); topic ignored
    status: completed
  - id: phase3-content
    content: Prompt/schema/validator for structured image queries, age bands, diversity; per-card regen
    status: completed
  - id: phase4-images
    content: Image cascade fallbacks, top-N rotation, IMAGE_NOT_FOUND, per image component
    status: completed
  - id: phase5-response
    content: Response assembly/final validation; cardId/type aliases; orchestrator stage wiring
    status: completed
isProject: false
---

# Flashcard Engine → FLASH_CARD_REVISED.md

## Non-goals

- No changes to Search Service, Asset Library, embedding pipeline, S3, or rendering engine internals
- No LLM-driven template or intent selection
- No layout/styling generation in backend

## Gap summary

| Area | Today | Target |
|---|---|---|
| Request analysis | query + ageGroup | grade, age, subject, topic, intent, difficulty, language, count |
| Intent | keyword rules; extras | Fixed taxonomy + phonics; never LLM |
| Template selection | score + topics weighted | grade → objective → subject → difficulty → age → version; topic ignored |
| LLM image output | `string[]` queries | Structured searchQuery object |
| Image retrieval | single semantic call | Cascade + rotate top hits + per image component |
| Validation failure | retry entire set | regenerate only failed card |
| Pipeline stages | older names | revised stage list (aliases kept) |

## Phases

### Phase 0 — Contract
- Add revised stage keys; keep existing keys as aliases for tracker history
- Response remains backward compatible (`componentType` + `type`, `cardIndex` + `cardId`)

### Phase 1 — Request analysis
- Parse grade/subject/difficulty/language from query (+ optional DTO fields)
- Grade → age defaults when age omitted
- Deterministic educational objective (add `phonics`)

### Phase 2 — Template selection
- Remove topic from selection scoring
- Rank: exact grade → objective → subject → difficulty → age overlap → newest version
- Always return one template; reselect if template goes inactive mid-run

### Phase 3 — Content generation
- Prompt: learner profile, age-band rules, creative diversity
- Structured image query schema + validator
- Per-card regeneration on validation failure

### Phase 4 — Image retrieval
- Fallback: primary → expectedObjects → object name → topic → unfiltered
- Dedupe assets; rotate among top-N similarity
- `IMAGE_NOT_FOUND` / `not_found` on failure; never fail whole pipeline

### Phase 5 — Response + orchestration
- Wire new stages in orchestrator
- Final validation; lean metadata; rendering-ready JSON

## MVP order

Implement Phases 0→5 in one pass; defer full stage-replay persistence to a follow-up.
