# Universal Template Generation

How `universal_template` turns a topic + age into a printable worksheet.

---

## Architecture (composition engine)

```text
LLM (educational designer)
  └─ activities[] + images[] (+ optional content_html)
        │
        ▼
buildUniversalWorksheetModel
  • parse activities[] OR content_html → semantic model
  • asset compatibility (color ↔ outline)
  • dedupe + age policy cap
  • age 2–3 single-activity enrichment
        │
        ▼
planUniversalComposition / allocateUniversalPageSpace
  • min / ideal / max heights
  • content-aware image sizes
        │
        ▼
composeUniversalContentHtml
  • emit deterministic semantic HTML
  • matching-columns, image grids, trace rows
        │
        ▼
WorksheetAssetService (unchanged semantic retrieval)
        │
        ▼
GenericWorksheetRenderer + Playwright validation
```

**LLM designs. Layout engine composes. Renderer outputs.**

No layout catalog. No equal-height `flex:1` activities.

---

## Age policy (unchanged source of truth)

`resolveUniversalActivityPolicy`

| Band | Max interactions | Prefer |
| --- | --- | --- |
| 2–3 | 1 | 1 **rich** activity (not one tiny icon) |
| 3–4 | 2 | 2 |
| 4–5+ | 4 | 3 excellent |

Activity count = different learning interactions, not page sparsity.

---

## Key files

| File | Role |
| --- | --- |
| `utils/universal-worksheet.model.ts` | Semantic types / primitives |
| `utils/universal-worksheet-compose.util.ts` | Model + compositor |
| `utils/universal-dynamic-layout.util.ts` | Space / image allocation |
| `utils/universal-layout-validate.util.ts` | Diagnostics + browser measure |
| `utils/universal-content-html.util.ts` | Sanitize + inject shell |
| `constants/worksheet-prompt.constants.ts` | Design-first prompt |
| `docs/worksheet/assets/universal_template.*` | Trusted shell + schema |

Sync DB shell after CSS changes:

```bash
npx ts-node -r tsconfig-paths/register scripts/update-universal-worksheet-template.ts
```
