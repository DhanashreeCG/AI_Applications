# How WorksheetMaker templates work

This describes the referenced WorksheetMaker project
(`WorksheetMakerMain_localhost/backend/templates/`), not flashcards.

## Folder layout

Templates live under `backend/templates/<category>/<slug>/`.
`backend/templates/registry.json` lists type, category, slug, grades, and subjects.

A folder can include:

| File | Role |
|---|---|
| `template.html` | Page markup. Tokens like `{{TOPIC}}`, `{{ROWS}}`, `{{GOAT_IMAGE}}`. |
| `structure.json` | Content shape: topic, rows/questions, `editable_fields`, `ai_config`. |
| `renderer.js` | Server render: fills HTML from structure + image map. |
| `editor.js` | Sidebar field list (`getEditableFields` / `applyEditorChanges`). |
| `meta.json` | Grades, subjects, difficulty. |
| `background.png` / `sample.png` | Page background and catalog thumbnail. |
| `ai-edit-popup.html` | Structured **Generate new worksheet** form (`[data-field]` inputs). |
| `ai-edit-config.js` | Defines `buildInstruction(values)` from those fields. |
| `ai-edit-system-prompt.txt` | System prompt for full regenerate. |
| `field-prompts.json` | Per-field rewrite prompts, labels, `auto_regenerate_after`. |
| `field-editor.js` | Maps keys like `question_1` onto JSON (`resolveField`, linked fields). |
| `ai-edit-panel.js` | Optional custom **AI Edit** modal (Answer and Colour only in the pack). |

Not every template has every file. `circle_the_things` and `match_the_pairs` have layout/editor/renderer only.

## Two AI Edit UIs

`frontend/ai-editor.js` on **AI Edit**:

1. **Panel** — `GET /ai-edit/panel/:type` returns `ai-edit-panel.js`. If present, that script is executed and `openAiPanel()` runs. Answer and Colour uses this: per-question cards (current text, prompt, Re-Generate), Q3 linked options, grammar/save, then a generate form at the bottom.
2. **Popup fallback** — `GET /ai-edit/popup/:type` returns `ai-edit-popup.html` + `ai-edit-config.js`. Generic templates (circle the words, number names) get this structured generate form only.
3. **Generic fallback** — free-text instruction box if neither file exists.

Pencil icons on the worksheet call `field-editor.js` + `POST /ai-edit/field` for a single field.

## Field keys

`data-editable="question_1"` is 1-based. JSON is 0-based (`questions[0].question`).
`field-editor.js` translates keys. Linked fields: regenerating `question_3` also regenerates `option_1` / `option_2` using `{PARENT_TEXT}` in `field-prompts.json`.

## Mapping in this repo

| WorksheetMaker file | `WorksheetTemplate` column |
|---|---|
| `template.html` | `templateHtml` |
| `structure.json` | `structureDefinition` |
| `meta.json` | `meta` |
| `field-prompts.json` | `fieldPrompts` |
| `ai-edit-system-prompt.txt` | `aiSystemPrompt` |
| `ai-edit-popup.html` | `aiEditPopupHtml` |
| `ai-edit-config.js` | `aiEditConfigJs` |
| `ai-edit-panel.js` | `aiEditPanelJs` |
| `editor.js` / `field-editor.js` / `renderer.js` | `editorJs` / `fieldEditorJs` / `rendererJs` |

Seed: `npx ts-node -r tsconfig-paths/register scripts/db/seed-worksheet-template-ai-files.ts`

Our UI:

- If the structure has `questions` (or `aiEditPanelJs` is set), **AI Edit** shows in-place question cards + Re-Generate (our `/edit` API), then the DB popup form if present.
- If only `aiEditPopupHtml` exists, show that generate form.
- If neither exists, keep the generic field cards + freeform regenerate box.
