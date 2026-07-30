export const DEFAULT_GEMINI_VISION_MODEL = 'gemini-2.5-flash';
export const DEFAULT_VISION_PROMPT_VERSION = 'v1';

export const VISION_ANALYSIS_PROMPT = `Analyze this image and return structured JSON metadata optimized for semantic search and retrieval.

Requirements:
- Be concise and search-oriented.
- Use short phrases, not long paragraphs.
- Populate all required fields.
- Use empty arrays when nothing applies.
- orientation must be one of: portrait, landscape, square.

Return JSON with these fields:
- caption: short descriptive caption
- objects: visible objects or subjects
- actions: visible actions or poses
- styles: art or visual style tags
- colors: dominant colors
- background: background description
- composition: framing or layout notes
- orientation: portrait | landscape | square
- age_groups: suitable age groups if applicable
- educational_uses: educational use cases if applicable
- search_keywords: additional retrieval keywords`;

export const VISION_METADATA_JSON_SCHEMA = {
  type: 'object',
  properties: {
    caption: { type: 'string' },
    objects: { type: 'array', items: { type: 'string' } },
    actions: { type: 'array', items: { type: 'string' } },
    styles: { type: 'array', items: { type: 'string' } },
    colors: { type: 'array', items: { type: 'string' } },
    background: { type: 'string' },
    composition: { type: 'string' },
    orientation: { type: 'string' },
    age_groups: { type: 'array', items: { type: 'string' } },
    educational_uses: { type: 'array', items: { type: 'string' } },
    search_keywords: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'caption',
    'objects',
    'actions',
    'styles',
    'colors',
    'background',
    'composition',
    'orientation',
    'age_groups',
    'educational_uses',
    'search_keywords',
  ],
} as const;
