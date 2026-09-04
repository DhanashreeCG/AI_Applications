@DEFAULT_FLASHCARD_PROMPT_VERSION (or prompt builder file)

We have a bug where Title/Label components (such as `skillLabel`, `title`, or fields with `semanticRole: "phonics.skill.label"`) are generating full conversational sentences (e.g., "Numbers above ninety. Let us read them together.") instead of clean, concise 1–4 word domain titles (e.g., "Numbers 91 to 100").

### ROOT CAUSE:
1. Title/Label fields are currently being classified as `NARRATIVE` fields, which causes them to inherit `ageBandGuidance()` rules (e.g., "single word + one short simple sentence").
2. The prompt builder lacks explicit rules isolating Title/Label components from sentence-based age guidance.

### OBJECTIVE:
Refactor the prompt builder logic so that Title/Label components are cleanly categorized and formatted as clean domain labels without impacting raw grid values (`RAW_VALUE`), narrative descriptions, or any other fields across all current and future templates.

---

### REQUIRED CHANGES:

1. **Add Title/Label Classification Helpers:**
   - Define a set/pattern for Title and Skill Label roles and IDs:
     ```typescript
     const TITLE_LABEL_SEMANTIC_ROLES = new Set([
       'phonics.skill.label',
       'header.label',
       'title.label',
       'card.title',
       'skill.label'
     ]);

     const TITLE_LABEL_ID_PATTERN = /^(skillLabel|title|headerLabel|cardTitle)$/i;

     function isTitleLabelComponent(component: TemplateComponentDefinition): boolean {
       const role = (component as { semanticRole?: string }).semanticRole;
       if (role) return TITLE_LABEL_SEMANTIC_ROLES.has(role);
       return TITLE_LABEL_ID_PATTERN.test(component.componentId);
     }
     ```

2. **Isolate Title/Label Fields from Narrative Guidance:**
   - Update component filtering so narrative components exclude both `RAW_VALUE` components AND `Title/Label` components.
   - Title components must **never** be subject to `ageBandGuidance()`.

3. **Inject Explicit Title Rules into the Prompt:**
   - Create a dedicated `titleLabelRules` prompt instruction block:
     ```typescript
     const titleLabelRules = titleComponents.length > 0
       ? `
     TITLE / SKILL LABEL fields (e.g. ${titleComponents.map((c) => `"${c.componentId}"`).join(', ')}):
     - Output ONLY a clean, 1 to 4 word domain/topic title (e.g., "Numbers 91 to 100" or "Sight Words").
     - NEVER write full sentences, conversational filler, or instructions (FORBIDDEN: "Let us read", "Look at the", "Read together", "Carefully").
     - Ignore age-band sentence/narrative guidelines for these fields.`
       : '';
     ```
   - Make sure `${titleLabelRules}` is included in the returned prompt string.

4. **Preserve Compatibility:**
   - Do NOT alter `rawValueComponents` logic or standard `narrativeComponents` behavior for normal descriptive/fact text.
   - Do NOT change the JSON output structure or schema contract expected by Gemini.