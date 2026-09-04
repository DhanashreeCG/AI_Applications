export const DEFAULT_GEMINI_VISION_MODEL = 'gemini-2.5-flash';
export const DEFAULT_VISION_PROMPT_VERSION = 'v1';

export const VISION_ANALYSIS_PROMPT = `You are analyzing images from a children's educational content library for ages 2 to 12 — pre-nursery, nursery, LKG, UKG, and later primary grades: tracing/handwriting worksheets, alphabet/numeral learning, animals, fruits, vegetables, daily chores, occupations, shapes, colors, vehicles, household objects, nature, festivals, and general illustrations. Content is designed for children; adults (parents/teachers) may use or administer it, but the target audience is always the child, not the adult. Any image type may appear — do not assume tracing/text content unless actually shown.

TEXT & NUMERAL DISAMBIGUATION:
Stylized tracing fonts make numerals and letters visually ambiguous (e.g. "9" vs "g"/"q", "1" vs "I"/"l", "0" vs "O", "2" vs "Z", "5" vs "S", "6" vs "b"/"G", "7" vs "T"). Do not guess from shape alone. Resolve using, in order: (1) any printed instructional text in the image (e.g. "Trace the number 9") — trust this over glyph shape; (2) context — part of a digit sequence/count = numeral, part of an alphabet sequence/word = letter. If truly no clues exist, pick the single most visually likely reading and state it plainly (do not hedge with both options). Always output the unambiguous form: "number 9"/"digit 9" (never bare "9"), "letter G", "capital letter G" or "lowercase letter g" (never bare "G"/"g").

AGE & CURRICULUM STAGE MAPPING:
Estimate difficulty/complexity from visual cues — large simple shapes, single objects, minimal text = younger; smaller detail, multi-step tasks, longer words/sentences = older. Map to curriculum stage terms as well as numeric age_groups, since users often search by stage name rather than age number:
- pre-nursery/nursery ≈ age 2-4 (very simple, single large elements)
- LKG ≈ age 4-5
- UKG ≈ age 5-6
- grade 1-4 (primary) ≈ age 6-10
- age 10-12 for more advanced primary content
When content clearly fits one or more of these stages, include the stage name itself (e.g. "LKG worksheet", "UKG activity", "nursery tracing") in "educational_uses" or "search_keywords" — not just the numeric range. For "grades", use only "toddlers" or "kids" per the enum (never "teens"/"adults") — this reflects the intended child audience regardless of who administers the material.

TAGGING FOR SEARCH:
For the 3-5 most prominent objects/concepts only (not every minor background item), also tag:
- Geometric shape, if a real-world object is box-like/round/tube-like/etc. (e.g. tiffin box → also "cuboid", "box shaped") — this lets shape queries like "cube shape objects" match everyday objects, not just shapes-lesson images.
- Broader category (animal → "farm animal"/"wild animal"/"pet"/"bird"; fruit/vegetable → "fruit"/"vegetable"; uniformed person → "community helper" + specific role; vehicle → "land/air/water vehicle").
- Any depicted concept pair: opposites (big/small, full/empty), spatial position (above/below/inside), quantity (few/many), emotion, weather/season — tag the specific word(s) actually shown.
Only tag what is actually depicted — never invent a category, shape, or concept not visible in the image. Add these into "objects" or "search_keywords".

Analyze this image and return structured JSON metadata optimized for semantic search and retrieval.

Requirements:
- Be concise and search-oriented; short phrases, not paragraphs.
- Populate all required fields; use empty arrays when nothing applies.
- orientation must be one of: portrait, landscape, square.
- Transcribe any visible printed text/characters faithfully in "caption" and "objects" — do not omit or misclassify it.

Return JSON with these fields:
- caption: short descriptive caption
- objects: visible objects or subjects, including tags per TAGGING FOR SEARCH above
- actions: visible actions or poses
- styles: art or visual style tags
- colors: dominant colors
- background: background description
- composition: framing or layout notes
- orientation: portrait | landscape | square
- age_groups: suitable numeric age ranges using only min-max format, for example 2-4, 4-6, 6-10, 10-12
- grades: suitable audience categories using only: toddlers, kids
- educational_uses: educational use cases, including curriculum stage name per AGE & CURRICULUM STAGE MAPPING above where applicable
- search_keywords: additional retrieval keywords, including shape/category synonyms per TAGGING FOR SEARCH above`;

export function buildVisionAnalysisPrompt(filename?: string): string {
  if (!filename) {
    return VISION_ANALYSIS_PROMPT;
  }

  return `${VISION_ANALYSIS_PROMPT}

SOURCE FILENAME (authoritative for letters, case, and digits):
"${filename}"

When printed glyphs are visually ambiguous (o/O/0, 1/I/l, 9/g/q, 5/S, 2/Z, etc.), treat the source filename as the source of truth. Do not override it with a guessed reading from the image. Still describe the actual visual scene, but transcribe letters and digits to match the filename.`;
}

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
    age_groups: {
      type: 'array',
      items: { type: 'string', pattern: '^\\d{1,3}-\\d{1,3}$' },
    },
    grades: {
      type: 'array',
      items: {
        type: 'string',
        enum: ['toddlers', 'kids', 'teens', 'adults'],
      },
    },
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
    'grades',
    'educational_uses',
    'search_keywords',
  ],
} as const;
