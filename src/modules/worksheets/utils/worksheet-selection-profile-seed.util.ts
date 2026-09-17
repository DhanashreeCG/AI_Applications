/** Authoritative WorksheetTemplate id ↔ slug (do not fuzzy-match). */
export const AUTHORITATIVE_TEMPLATE_IDS: Record<string, string> = {
  number_names: 'cmswxebxm0028s4bg6clapv7x',
  answer_and_colour: 'cmsws6mrz0009l4bgdx3em709',
  look_and_say_letters_and_sounds: 'cmtmu146d002ng8bgcae2bvj2',
  circle_the_words: 'cmthbu2zn002n0kbgfadaudre',
  matching_single_letter: 'cmtqv0vtc003ho8bg01khunhe',
  look_and_say_circle_the_letters: 'cmtqx3d7w0048c4bg0i8fe9cy',
  circle_the_things: 'cmtctkipl002lxcbg6wqtf6q3',
  tracing: 'cmtqs9cbc002nnobgwtdins9u',
  match_the_pairs: 'cmthcnikx003yrobgnng3y2ka',
  storytime_maze: 'cmts6roz3002n4obgkgehn7e1',
  picture_graph: 'cmtsndfnn002n6cbg6o6ny7t3',
  letters_craft: 'cmtv2l36g002n0kbgdd6r6t7z',
  numbers_after_and_before: 'cmtsdzoj50032ngbgewvpccu6',
  universal_template: 'cmtveqj0x002ltobgwe7d4brc',
};

/**
 * Human-filled map: JSON templateName → authoritative slug.
 * Empty by default → skip-and-warn for known mismatches in the main seed.
 * Confirmed links are used by the missing-profile seed script.
 */
export const MANUAL_SLUG_OVERRIDES: Record<string, string> = {};

/** Confirmed after DB review — used by seed-missing-worksheet-template-selection-profiles. */
export const CONFIRMED_JSON_SLUG_LINKS: Record<string, string> = {
  number_names_matching: 'number_names',
  look_and_say_letter_sounds: 'look_and_say_letters_and_sounds',
};

const KNOWN_MISMATCHES: Record<string, string> = {
  number_names_matching: 'number_names',
  look_and_say_letter_sounds: 'look_and_say_letters_and_sounds',
};

export function resolveAuthoritativeSlug(
  jsonSlug: string,
  overrides: Record<string, string> = MANUAL_SLUG_OVERRIDES,
): { slug: string } | { skip: true; reason: string } {
  if (AUTHORITATIVE_TEMPLATE_IDS[jsonSlug]) {
    return { slug: jsonSlug };
  }
  const override = overrides[jsonSlug]?.trim();
  if (override && AUTHORITATIVE_TEMPLATE_IDS[override]) {
    return { slug: override };
  }
  const closest = KNOWN_MISMATCHES[jsonSlug];
  if (closest) {
    return {
      skip: true,
      reason: `flagged mismatch JSON slug="${jsonSlug}" closest authoritative="${closest}" (set MANUAL_SLUG_OVERRIDES to link)`,
    };
  }
  return {
    skip: true,
    reason: `no authoritative id for JSON slug="${jsonSlug}"`,
  };
}

export interface SelectionProfileSeedPayload {
  templateSlug: string;
  templateType: string;
  description: string;
  primaryUse: string;
  canBeUsedFor: string[];
  exampleTopics: string[];
  adaptationNote: string;
  skillsPracticed: string[];
}

export interface SeedTopicFitEntry {
  template: {
    templateType: string;
    description: string;
  };
  topicFit: {
    primaryUse: string;
    canBeUsedFor: string[];
    exampleTopics: string[];
    adaptationNote: string;
  };
  skillsPracticed: string[];
}

export function profilePayloadFromSeedEntry(
  entry: SeedTopicFitEntry,
  templateSlug: string,
): SelectionProfileSeedPayload {
  return {
    templateSlug,
    templateType: entry.template.templateType,
    description: entry.template.description,
    primaryUse: entry.topicFit.primaryUse,
    canBeUsedFor: entry.topicFit.canBeUsedFor ?? [],
    exampleTopics: entry.topicFit.exampleTopics ?? [],
    adaptationNote: entry.topicFit.adaptationNote,
    skillsPracticed: entry.skillsPracticed ?? [],
  };
}

/**
 * Author selection profile for storytime_maze from DB template fields.
 * (No entry in docs/worksheet/seed-data.json.)
 */
export function buildStorytimeMazeSelectionProfile(template: {
  slug: string;
  name?: string | null;
  category?: string | null;
  description?: string | null;
  meta?: unknown;
}): SelectionProfileSeedPayload {
  const meta =
    template.meta && typeof template.meta === 'object' && !Array.isArray(template.meta)
      ? (template.meta as Record<string, unknown>)
      : {};
  const metaDescription =
    typeof meta.description === 'string' && meta.description.trim()
      ? meta.description.trim()
      : null;
  const tags = Array.isArray(meta.tags)
    ? meta.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    : [];

  const description =
    template.description?.trim() ||
    metaDescription ||
    'Story-based maze where learners guide a character through a path to the finish.';

  return {
    templateSlug: template.slug,
    templateType:
      typeof meta.type === 'string' && meta.type.trim()
        ? meta.type.trim()
        : 'storytime_maze',
    description,
    primaryUse:
      'Story comprehension, narrative sequencing and fine-motor path-tracing through a maze.',
    canBeUsedFor: [
      'Story time',
      'Fables and folk tales',
      'Listen and comprehend',
      'Character journeys',
      'Animal stories',
      'Narrative sequencing',
      'Beginning-middle-end',
      'Problem and solution in a story',
      'Path tracing',
      'Fine-motor maze activities',
      ...tags.filter(
        (t) =>
          !['maze', 'story', 'comprehension', 'fine-motor', 'path tracing'].includes(
            t.toLowerCase(),
          ),
      ),
    ],
    exampleTopics: [
      'Help the rabbit reach the carrot garden',
      'Guide the lost duckling back to the pond',
      'Follow the ant to its anthill',
      'Lead the story hero to the finish line',
      'Navigate the forest path in a fable',
      'Character reaches home after an adventure',
    ],
    adaptationNote:
      'Keep the maze path-tracing interaction and a clear start→finish goal. Change the story character, setting, obstacles and finish illustration to match the selected story or theme; do not turn it into a non-maze activity.',
    skillsPracticed: [
      'Listening comprehension',
      'Story comprehension',
      'Narrative sequencing',
      'Fine motor skills',
      'Hand-eye coordination',
      'Visual tracking',
      'Problem solving',
    ],
  };
}

/**
 * Picture Graph selection profile (missing from seed-data.json).
 * Do NOT create a Universal profile — Universal is fallback-only.
 */
export function buildPictureGraphSelectionProfile(template: {
  slug: string;
}): SelectionProfileSeedPayload {
  return {
    templateSlug: template.slug,
    templateType: 'picture_graph',
    description:
      'A picture-graph activity where children read quantities represented by pictures or bars, compare counts, and answer a simple question about the graph.',
    primaryUse:
      'A picture-graph activity where children read quantities represented by pictures or bars, compare counts, and answer a simple question about the graph.',
    canBeUsedFor: [
      'Picture graph',
      'Picture graphs',
      'Picture-based graph',
      'Picture chart',
      'Count and graph',
      'Read a picture graph',
      'Interpret a picture graph',
      'Compare quantities in a graph',
      'Count pictures in a graph',
      'Most and least in a graph',
      'Which has more',
      'Which has fewer',
      'Graph-based counting',
      'Graph-based comparison',
      'Tally and graph for young learners',
    ],
    exampleTopics: [
      'Count fruits in a picture graph',
      'Count animals in a picture graph',
      'Compare vehicles in a picture graph',
      'Which fruit has the most',
      'Which animal has the fewest',
      'Read a graph about insects',
      'Count and compare objects in a picture graph',
      'Find the most common item in a graph',
      'Find the least common item in a graph',
      'Answer questions from a picture graph',
    ],
    adaptationNote:
      'Keep the picture/bar graph interaction and comparison question. Change theme objects and counts to match the topic; do not turn it into a non-graph counting sheet.',
    skillsPracticed: [
      'Counting',
      'Data interpretation',
      'Quantity comparison',
      'Visual reasoning',
      'Graph reading',
      'One-to-one correspondence',
      'More and less',
    ],
  };
}

/**
 * Tracing profile aligned to the live template contract:
 * comparative line-tracing between left/right paired images (big/small, animal/home),
 * NOT freehand pre-writing curves/zigzags.
 */
export function buildTracingComparativeSelectionProfile(template: {
  slug: string;
}): SelectionProfileSeedPayload {
  return {
    templateSlug: template.slug,
    templateType: 'visual_tracing',
    description:
      'A tracing activity where learners follow a line between corresponding objects, especially useful for comparing size, quantity, position or other visual relationships.',
    primaryUse:
      'Pre-math, visual correspondence and fine-motor tracing activities between paired images.',
    canBeUsedFor: [
      'Big and small',
      'Tall and short',
      'Long and short',
      'Heavy and light',
      'More and less',
      'Same and different',
      'Near and far',
      'One and many',
      'Up and down',
      'Animal matching',
      'Object matching',
      'Picture-to-picture correspondence',
      'Size comparison',
      'Quantity comparison',
      'Comparative line tracing',
    ],
    exampleTopics: [
      'Small animal to small house',
      'Big fruit to big basket',
      'Tall plant to tall pot',
      'Large vehicle to large parking space',
      'Same animal pairs',
      'Animal and its home',
      'Big and small objects',
      'More and fewer objects',
    ],
    adaptationNote:
      'Keep the dotted-line tracing interaction between left and right images. Change illustrated objects and the compare/match relationship per topic. Preserve exactly 4 pairs across two sections.',
    skillsPracticed: [
      'Fine motor skills',
      'Visual discrimination',
      'Matching',
      'Comparison',
      'Hand-eye coordination',
      'Pre-writing skills',
    ],
  };
}
