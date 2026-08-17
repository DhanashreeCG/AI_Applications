# Letter-Aware Hybrid Search — Implementation Spec (NestJS / TypeScript)

## 1. Problem

Vector search alone misidentifies alphabet-tracing assets (e.g. "Letter A" returns "Letter L")
because the embedded text for every letter asset is ~90% identical boilerplate
("tracing guide," "LKG worksheet," "stroke order," "black background"...). Only 1–2 tokens
differ between assets, so the embedding barely encodes *which letter* — unrelated similarity
(color words, phrase structure) ends up dominating ranking.

**We are not re-embedding the corpus.** Every alphabet asset already has (or will have,
after manual cleanup — see §5) an `objects: string[]` field containing canonical identity
strings such as `"capital letter a"` / `"lowercase letter a"`. The fix lives entirely at the
**retrieval layer**, using `objects` as ground truth, not the embedding.

**Hard requirement:** the letter-detection layer must fire *only* on genuine alphabet-lookup
queries ("Letter A", "capital letter A tracing", "uppercase B worksheet") and must **not**
fire on generic content queries that merely happen to contain a single-letter word or article
("A cat", "a ball", "story about a dog", "A is for Apple picture"). A false positive here is
worse than a miss — it would forcibly filter unrelated searches down to alphabet assets.

---

## 2. Architecture: embed-then-filter (not filter-then-embed)

```
Query
  │
  ▼
[1] LetterQueryDetectorService
  │   Regex + guard rules, generic for A–Z (no per-letter code)
  │   → { letter: 'A', case: 'upper' | 'lower' | 'both' } | null
  ▼
[2] Existing vector search (unchanged) — top_k = 75 candidates
  │   Fast, ANN-indexed, always runs regardless of step 1's result
  ▼
[3] If entity detected in step 1:
  │     Filter the 75 candidates in-memory by `objects` match
  │   Else:
  │     Pass candidates through unfiltered (today's behavior)
  ▼
[4] If filtered result is EMPTY (correct asset wasn't inside top-K):
  │     Fallback: direct DB lookup on `objects` field (indexed),
  │     bypassing vector search entirely
  ▼
Return final list, capped to `limit`
```

**Why filter top-K instead of pre-filtering the whole DB:** vector search is already fast
and indexed; re-ranking ~75 in-memory candidates by an exact string check is essentially free
(microseconds). A full metadata pre-filter across the entire asset table before vector search
would need either filtered-ANN support or a second full scan — more moving parts for no
accuracy gain, since the correct asset is virtually always inside a top-75 window once
`objects` is clean. Step 4 exists purely as a safety net for the rare edge case where it isn't.

---

## 3. Step 1 — Letter Query Detector (generic, false-positive-guarded)

This is the piece that must never misfire. Design principle: **only trust an explicit
anchor keyword** (`letter` / `alphabet`), never a bare single character. A lone "A" or "a"
is a real English word/article and is not a safe signal on its own.

```typescript
// letter-query-detector.service.ts
import { Injectable } from '@nestjs/common';

export type LetterCase = 'upper' | 'lower' | 'both';

export interface LetterEntity {
  letter: string;      // canonical uppercase, e.g. "A"
  case: LetterCase;
}

@Injectable()
export class LetterQueryDetectorService {
  // Primary anchor — REQUIRES the literal word "letter" or "alphabet".
  // This is the only pattern allowed to fire without a case word present,
  // because "letter"/"alphabet" is an unambiguous topic signal.
  private readonly PRIMARY_ANCHOR =
    /\b(?:letter|alphabet)\s+([a-zA-Z])\b/i;

  // Secondary anchor — case word directly adjacent to a single letter,
  // WITHOUT the word "letter" present (e.g. "uppercase A", "capital B").
  // Safe because "capital"/"uppercase"/"lowercase"/"small" immediately
  // followed by a lone letter is not natural English outside this domain.
  private readonly SECONDARY_ANCHOR =
    /\b(uppercase|capital|lowercase|small)\s+([a-zA-Z])\b(?!\w)/i;

  private readonly CASE_WORD = {
    upper: /\b(uppercase|capital|big|large)\b/i,
    lower: /\b(lowercase|small|tiny)\b/i,
  };

  // Phrases that indicate the query is actually about an OBJECT/topic,
  // not the letter glyph itself — even if a letter keyword is present.
  // e.g. "the letter A is for Apple, show me a picture of an apple"
  private readonly OBJECT_INTENT_GUARD =
    /\b(is for|starts? with|picture of|image of|photo of|clipart of|story about|photo|illustration of)\b/i;

  detect(query: string): LetterEntity | null {
    const trimmed = query.trim();
    if (!trimmed) return null;

    let match = this.PRIMARY_ANCHOR.exec(trimmed);
    let matchedViaPrimary = !!match;

    if (!match) {
      match = this.SECONDARY_ANCHOR.exec(trimmed);
      if (match) {
        // secondary anchor's letter is capture group 2, not 1
        match = [match[0], match[2]] as unknown as RegExpExecArray;
      }
    }

    if (!match) return null;

    const letterChar = match[1];

    // Guard: single-letter matches only. Reject if regex somehow
    // captured more than one character (defensive, shouldn't happen
    // given the pattern, but keeps this bulletproof).
    if (!/^[a-zA-Z]$/.test(letterChar)) return null;

    // Guard: if this came from the primary anchor, still check whether
    // the surrounding sentence indicates the query is about an object
    // the letter merely represents (e.g. "L is for Ladder").
    if (matchedViaPrimary && this.OBJECT_INTENT_GUARD.test(trimmed)) {
      return null;
    }

    // Guard: secondary anchor alone (no "letter"/"alphabet" word) is
    // rejected if the object-intent guard phrases are present too —
    // extra caution since this pattern has a slightly wider net.
    if (!matchedViaPrimary && this.OBJECT_INTENT_GUARD.test(trimmed)) {
      return null;
    }

    let caseResult: LetterCase;
    if (this.CASE_WORD.upper.test(trimmed)) {
      caseResult = 'upper';
    } else if (this.CASE_WORD.lower.test(trimmed)) {
      caseResult = 'lower';
    } else if (matchedViaPrimary) {
      // "letter A" / "letter a" with no explicit case word:
      // infer from the literal casing typed (LLM-generated queries in
      // this system always type explicit case per stated pipeline behavior)
      caseResult = letterChar === letterChar.toUpperCase() ? 'upper' : 'lower';
    } else {
      // Reached only via SECONDARY_ANCHOR, which by construction always
      // has a case word — unreachable in practice, kept for type-safety.
      caseResult = 'both';
    }

    return {
      letter: letterChar.toUpperCase(),
      case: caseResult,
    };
  }
}
```

### 3.1 Why this rejects "A cat" / "a ball" / generic sentences

| Query | PRIMARY_ANCHOR | SECONDARY_ANCHOR | Result |
|---|---|---|---|
| `"A cat"` | no ("letter"/"alphabet" absent) | no (no case word before "A") | `null` — safe |
| `"a ball"` | no | no | `null` — safe |
| `"story about a dog and a cat"` | no | no | `null` — safe |
| `"Letter A"` | yes, `letter="A"` | — | `{letter:'A', case:'upper'}` |
| `"letter a tracing worksheet"` | yes, `letter="a"` | — | `{letter:'A', case:'lower'}` |
| `"capital A worksheet"` | no | yes, `letter="A"` | `{letter:'A', case:'upper'}` |
| `"uppercase b flashcard"` | no | yes | `{letter:'B', case:'upper'}` |
| `"L is for Ladder"` | yes, but OBJECT_INTENT_GUARD hits ("is for") | — | `null` — safe |
| `"picture of the letter O"` | yes, but guard hits ("picture of") | — | `null` — safe |
| `"Aa tracing sheet"` | no (no space between letters and "tracing" matches nothing) | no | `null` — acceptable; see §3.2 |

### 3.2 Known non-goal
Queries like `"Aa"` alone (combined-letter shorthand, no explicit "letter" word) will **not**
trigger detection by design — this is intentional conservatism. Per your stated pipeline
behavior, the LLM-generated queries always spell out "Letter A" / "uppercase" / "lowercase"
explicitly, so this case shouldn't occur in practice. If it does turn out to occur, extend
`PRIMARY_ANCHOR` deliberately rather than loosening the single-letter fallback patterns —
looser single-letter matching is exactly what reintroduces the "A cat" false-positive risk.

---

## 4. Step 2 — Canonical object-string builder

```typescript
// letter-object-mapper.ts
import { LetterEntity } from './letter-query-detector.service';

export function canonicalObjectStrings(entity: LetterEntity): string[] {
  const l = entity.letter.toLowerCase();
  switch (entity.case) {
    case 'upper':
      return [`capital letter ${l}`];
    case 'lower':
      return [`lowercase letter ${l}`];
    case 'both':
    default:
      return [`capital letter ${l}`, `lowercase letter ${l}`];
  }
}
```

This assumes `objects` will consistently use the exact phrasing `"capital letter {x}"` /
`"lowercase letter {x}"` after your manual cleanup (§5). Keep this mapping in one place —
if you ever rename the convention, this is the single file to update.

---

## 5. Step 3–4 — Hybrid search orchestration

```typescript
// hybrid-letter-search.service.ts
import { Injectable } from '@nestjs/common';
import { LetterQueryDetectorService } from './letter-query-detector.service';
import { canonicalObjectStrings } from './letter-object-mapper';
import { VectorSearchService } from './vector-search.service'; // your existing service
import { AssetRepository } from './asset.repository';           // your existing DB layer

interface SearchAsset {
  assetid: string;
  objects: string[];
  [key: string]: unknown;
}

interface SearchRequest {
  query: string;
  limit?: number;
  filters?: Record<string, unknown>;
  bypassCache?: boolean;
}

const CANDIDATE_K = 75; // tune against corpus size / observed similarity spread

@Injectable()
export class HybridLetterSearchService {
  constructor(
    private readonly detector: LetterQueryDetectorService,
    private readonly vectorSearch: VectorSearchService,
    private readonly assetRepo: AssetRepository,
  ) {}

  async search(req: SearchRequest): Promise<SearchAsset[]> {
    const limit = req.limit ?? 10;
    const entity = this.detector.detect(req.query);

    // Always run vector search — unchanged behavior when no entity detected.
    const candidates = await this.vectorSearch.search({
      query: req.query,
      limit: entity ? CANDIDATE_K : limit,
      filters: req.filters,
      bypassCache: req.bypassCache,
    });

    if (!entity) {
      return candidates.slice(0, limit);
    }

    const targets = canonicalObjectStrings(entity).map((s) => s.toLowerCase());

    const filtered = candidates.filter((asset) => {
      const objs = (asset.objects ?? []).map((o) => o.toLowerCase());
      return targets.some((t) => objs.includes(t));
    });

    if (filtered.length > 0) {
      return filtered.slice(0, limit);
    }

    // Fallback: correct asset wasn't inside the top-K vector window.
    // Direct DB lookup on `objects`, bypassing vectors entirely.
    return this.assetRepo.findByObjects(targets, limit);
  }
}
```

```typescript
// asset.repository.ts (fallback query — adapt to your ORM)
// If using TypeORM with a Postgres text[]/jsonb `objects` column:
//
//   async findByObjects(targets: string[], limit: number) {
//     return this.repo
//       .createQueryBuilder('asset')
//       .where('asset.objects && ARRAY[:...targets]', { targets })
//       .limit(limit)
//       .getMany();
//   }
//
// Requires a GIN index on the `objects` column for this to stay fast:
//   CREATE INDEX idx_asset_objects ON assets USING GIN (objects);
```

---

## 6. Integration points

Implement the two services above once, then wire them into **both** call sites — do not
duplicate detection logic:

1. **Public search API** (`POST /search`): controller calls `HybridLetterSearchService.search()`
   instead of calling `VectorSearchService` directly. Request/response shape is unchanged.
2. **Flashcard / worksheet generation pipeline**: wherever it internally resolves an asset for
   a specific letter (e.g. "fetch tracing image for Letter M" during worksheet assembly),
   route that internal call through the same `HybridLetterSearchService.search()` rather than
   calling the embedding search directly. This guarantees the generator gets the exact correct
   letter/case every time, not just the user-facing search box.

---

## 7. Testing checklist

- [ ] `"Letter A"` → only `capital letter a` assets returned.
- [ ] `"letter a"` → only `lowercase letter a` assets returned.
- [ ] `"Aa"` alone → falls through to plain vector search (no false detection).
- [ ] `"capital B worksheet"` → detected via secondary anchor, `capital letter b` only.
- [ ] `"A cat"`, `"a ball"`, `"the dog and a cat story"` → detector returns `null`, no filtering applied, normal vector results.
- [ ] `"L is for Ladder"`, `"picture of the letter O"` → OBJECT_INTENT_GUARD suppresses detection.
- [ ] All 26 letters × both cases (52 total) run through one parametrized test — logic is generic, do not write 26 separate test cases by hand.
- [ ] Force `CANDIDATE_K` down to 3 in a test to simulate a top-K miss, confirm the DB fallback path still returns the correct asset.
- [ ] Confirm each of the 9 corrected assets in §8 passes post-cleanup and would have failed pre-cleanup (regression guard).

---

## 8. Manual work required — fixing the `objects` field

You said you'll handle this manually. Below is the exact, minimal, confirmed list — no need
to touch anything else. Convention going forward: every alphabet asset's `objects` array must
contain **exactly** `"capital letter {x}"`, `"lowercase letter {x}"`, or **both** for
combined assets — never a bare `"letter {x}"` with no case, since that string can't be
filtered against reliably.

| Filename | assetid | driveFileId | Current (wrong) | Fix |
|---|---|---|---|---|
| `c` | `234cb9f9-1baa-4ebe-b8d3-f34c14563bb0` | `1PN622ffGr9ezP_I-X9q1TL3iM-JzbkUd` | `"capital letter C"` | Replace with `"lowercase letter c"` |
| `o` | `80947114-71e1-4330-964f-be0474916fbb` | `1ni58Ac624C-bZrQT9M1_1LFcdiu29ui-` | `"capital letter O"`, `"number 0"` | Replace with `"lowercase letter o"`. **Verify visually first** — this asset may genuinely be a generic circle usable for O/o/0; if so, keep it out of the alphabet index or duplicate it as a separate correctly-labeled number-0 asset instead of overloading one entry. |
| `s` | `2ceca41b-c4f9-4a58-aadd-c9d4b882f2cc` | `1RG97yf6rGHSAk9ma8K1pVZQJ3OTBDjGT` | `"capital letter S"` | Replace with `"lowercase letter s"` |
| `z` | `6b04037b-3414-47ee-9885-aa952d0130a9` | `1Pu2lYB-iVefKy6otFYfJY-6SvzlwLXTe` | `"capital letter Z"` | Replace with `"lowercase letter z"` |
| `Y` | `dd451a9e-c680-426a-9886-ad49c3a455b9` | `1Xoj5WiMxJqJ6d_mxbTbNsbGoq60njon0` | `"lowercase letter y"` | Replace with `"capital letter y"` |
| `D` (duplicate) | `2c4732ff-7852-426a-9592-ed5adcbf10e2` | `1ZxV8SXboXJ7NUwEXln9vommOMZwrn-I2` | `"lowercase letter d"` | Replace with `"capital letter d"`. **Also flag for dedup review** — a separate, correctly-labeled capital-D asset already exists (`f080caae-ac7d-4f0e-9e95-064326bcf1ae`); decide whether to keep both (if the artwork genuinely differs) or archive this duplicate. |
| `l` | `166cee96-5498-430f-b4d1-f9553e452051` | `1XRW-LxxdPAsB_zsu7pT39We8-hLCuUeC` | No letter reference at all — only `"purple capsule shape"`, `"white circle"`, etc. | **Visually confirm this asset actually depicts letter "l" first** (it currently reads as a generic vertical-stroke template, not obviously letter-specific). If confirmed, add `"lowercase letter l"` to `objects`. If it's genuinely a generic pre-writing-stroke asset unrelated to a specific letter, exclude it from alphabet-letter search entirely rather than mislabeling it. |
| `w` | `bc7c52ef-5a8b-4450-9157-61058b011d9b` | `18kwOaJy6Tu303q_0hmymJL2z1s_p2h1r` | `"letter W"` (case-ambiguous); `searchKeywords` also lists `"capital letter W"` | In `objects`, replace `"letter W"` with `"lowercase letter w"` only. In `searchKeywords`, remove `"capital letter W"` (this file is lowercase-only; the separate uppercase `W` asset already exists at `b04b854e-16f4-48fc-8952-7456a1e25cda`). |
| `v` | `b917b824-c340-4000-9635-d4193587ed34` | `1RGQPQP4vXAGBpAnHhgqDjuB9GH1CN5L-` | `"letter V"` (redundant/ambiguous) alongside `"lowercase letter v"` | Remove the bare `"letter V"` entry from `objects`, keep only `"lowercase letter v"`. |

**Everything else** (A/a/Aa, B/b/Bb, E/e/Ee, F/f/Ff, G/g/Gg, H/h/Hh, I/i/Ii, J/j/Jj, K/k/Kk,
L/Ll, M/m/Mm, N/n/Nn, O/Oo, P/p/Pp, Q/q/Qq, R/r/Rr, T/t/Tt, U/u/Uu, V/v/Vv... except `v`
above, X/x/Xx, Z/Zz) already carries correct case-labeled `objects` entries and needs no
change.