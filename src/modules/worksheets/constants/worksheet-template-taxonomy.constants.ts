/** Stage 1 / Stage 2 scoring and selection knobs. */
export const TEMPLATE_SELECTION_MIN_SCORE_MARGIN = 6;
export const TEMPLATE_SELECTION_AI_TOP_N = 5;

/** Canonical grade/stage → age band for Stage 1 hard filter. */
export const GRADE_TO_AGE_BAND: Record<string, { min: number; max: number }> = {
  fs0: { min: 2, max: 3 },
  nursery: { min: 2, max: 3 },
  'pre-k': { min: 2, max: 3 },
  prek: { min: 2, max: 3 },
  fs1: { min: 3, max: 4 },
  lkg: { min: 3, max: 4 },
  kg1: { min: 3, max: 4 },
  preschool: { min: 3, max: 4 },
  fs2: { min: 4, max: 5 },
  ukg: { min: 4, max: 5 },
  kg2: { min: 4, max: 5 },
  kindergarten: { min: 4, max: 5 },
  grade1: { min: 5, max: 6 },
  'grade 1': { min: 5, max: 6 },
  '1st grade': { min: 5, max: 6 },
  'class 1': { min: 5, max: 6 },
  grade2: { min: 6, max: 7 },
  'grade 2': { min: 6, max: 7 },
  '2nd grade': { min: 6, max: 7 },
  'class 2': { min: 6, max: 7 },
  grade3: { min: 7, max: 8 },
  'grade 3': { min: 7, max: 8 },
  '3rd grade': { min: 7, max: 8 },
  'class 3': { min: 7, max: 8 },
};

/**
 * Canonical activity identities for Stage 2 classification.
 * Prefer specialized pedagogical formats over generic verbs (match/circle/trace/identify).
 */
export const WORKSHEET_ACTIVITY_TYPES = [
  'Alphabet Craft',
  'Number Before After',
  'Picture Graph',
  'Match the Pairs',
  'Comparative Line Tracing',
  'Visual Classification',
  'Beginning Sound Identification',
  'Story Maze',
  'Letter Matching',
  'Sight Word Identification',
  'Letter Sound Association',
  'Story Comprehension and Colouring',
  'Number Name Matching',
] as const;

export type WorksheetActivityType = (typeof WORKSHEET_ACTIVITY_TYPES)[number];

/** Map Stage 2 activityIntent labels → specialized template slugs. */
export const ACTIVITY_INTENT_TO_SLUG: Record<string, string> = {
  'alphabet craft': 'letters_craft',
  'number before after': 'numbers_after_and_before',
  'picture graph': 'picture_graph',
  'match the pairs': 'match_the_pairs',
  'comparative line tracing': 'tracing',
  'visual classification': 'circle_the_things',
  'circle the things': 'circle_the_things',
  'beginning sound identification': 'look_and_say_circle_the_letters',
  'story maze': 'storytime_maze',
  'letter matching': 'matching_single_letter',
  'sight word identification': 'circle_the_words',
  'letter sound association': 'look_and_say_letters_and_sounds',
  'story comprehension and colouring': 'answer_and_colour',
  'story comprehension and coloring': 'answer_and_colour',
  'number name matching': 'number_names',
};

/**
 * Explicit activity-format phrases in the user request.
 * Generic lone tokens (match/circle/trace/identify) are intentionally insufficient.
 */
export const ACTIVITY_FORMAT_PHRASES: Array<{
  slug: string;
  phrases: string[];
}> = [
  {
    slug: 'numbers_after_and_before',
    phrases: [
      'before and after',
      'after and before',
      'number before',
      'number after',
      'numbers before',
      'numbers after',
      'before/after',
      'what comes before',
      'what comes after',
    ],
  },
  {
    slug: 'letters_craft',
    phrases: ['alphabet craft', 'letter craft', 'letters craft', 'craft worksheet'],
  },
  {
    slug: 'picture_graph',
    phrases: [
      'picture graph',
      'picture graphs',
      'bar graph',
      'count and graph',
      'most and fewest',
      'most and least',
      'how many there are',
      'read a graph',
      'graph-based',
    ],
  },
  {
    slug: 'match_the_pairs',
    phrases: [
      'match the pairs',
      'match pairs',
      'matching pairs',
      'things that belong together',
      'match things that belong',
      'connect related',
      'two column match',
      'two-column match',
    ],
  },
  {
    slug: 'tracing',
    phrases: [
      'comparative line tracing',
      'line tracing',
      'trace lines between',
      'trace between matching',
      'trace matching',
      'big and small',
      'big vs small',
      'big vs. small',
    ],
  },
  {
    slug: 'circle_the_things',
    phrases: [
      'find and circle',
      'circle the things',
      'circle items',
      'circle the pictures',
      'visual classification',
      'circle all the',
    ],
  },
  {
    slug: 'look_and_say_circle_the_letters',
    phrases: [
      'beginning sound',
      'beginning sounds',
      'initial sound',
      'circle the letters',
      'pictures and letters',
    ],
  },
  {
    slug: 'storytime_maze',
    phrases: [
      'picture maze',
      'story maze',
      'storytime maze',
      'reach their destination',
      'reach the destination',
      'help a character',
      'through a maze',
    ],
  },
  {
    slug: 'matching_single_letter',
    phrases: [
      'capital letters to identical',
      'identical capital',
      'match capital letters',
      'uppercase to lowercase',
      'letter matching',
      'matching single letter',
    ],
  },
  {
    slug: 'circle_the_words',
    phrases: [
      'find and circle specific words',
      'circle specific words',
      'circle the words',
      'sight word',
      'sight words',
      'circle target words',
    ],
  },
  {
    slug: 'look_and_say_letters_and_sounds',
    phrases: [
      'look at a letter',
      'say it and practice',
      'say it and practise',
      'practice its sound',
      'practise its sound',
      'letter sound association',
      'look and say letters',
      'letters and sounds',
    ],
  },
  {
    slug: 'answer_and_colour',
    phrases: [
      'followed by a colouring',
      'followed by a coloring',
      'followed by colouring',
      'followed by coloring',
      'answer and colour',
      'answer and color',
      'questions and colour',
      'questions and color',
      'comprehension and colouring',
      'comprehension and coloring',
    ],
  },
  {
    slug: 'number_names',
    phrases: [
      'number to the correct word',
      'number to number word',
      'number names',
      'numeral to word',
      'connect a number',
      'number name matching',
      'written number names',
    ],
  },
];

export const WORKSHEET_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

export type WorksheetDifficulty = (typeof WORKSHEET_DIFFICULTIES)[number];

export interface TaxonomyTheme {
  theme: string;
  subTopics: string[];
}

/** Closed vocabulary for FS0–FS2 Stage 2 classification (age bands 2–5). */
export const FS0_TAXONOMY: TaxonomyTheme[] = [
  {
    theme: 'This Is Me',
    subTopics: [
      'My Age',
      'My Favourite Food',
      'My Favourite Toy',
      'My Body Parts',
      'Healthy Habits',
      'My Family',
      'My House',
      'My School',
      'My Pet',
      'My Friends',
    ],
  },
  {
    theme: 'Fruity Fiesta',
    subTopics: ['Apple', 'Mango', 'Banana', 'Watermelon', 'Grapes'],
  },
  {
    theme: 'Crunchy Munchy Veggies',
    subTopics: ['Lady Finger', 'Peas', 'Potato', 'Onion', 'Carrots'],
  },
  {
    theme: 'Little Feet on the Farm',
    subTopics: ['Cow', 'Sheep', 'Goat', 'Hen', 'Dog', 'Bunny', 'Horse'],
  },
  {
    theme: 'Wiggle in the Wild',
    subTopics: ['Lion', 'Tiger', 'Monkey', 'Bear', 'Snake'],
  },
  {
    theme: 'Roll, Float and Fly',
    subTopics: [
      'Land (Car, Bus, Train, Motorbike)',
      'Air (Aeroplane)',
      'Water (Boat, Ship)',
    ],
  },
  {
    theme: 'Maths — Pre-Maths Concepts',
    subTopics: [
      'Big/Small',
      'Same/Different',
      'Near/Far',
      'Tall/Short',
      'Long/Short',
      'In/Out',
    ],
  },
  {
    theme: 'Maths — Core',
    subTopics: [
      'Shapes (Rectangle, Square, Circle, Triangle)',
      'Numbers 1–10',
      'Subitising 1–10',
      'Missing Numbers 1–10',
      'Colours (Red, Yellow, Blue, Black, White)',
      'Pattern',
      'Coding with Colours',
    ],
  },
];

export const FS1_TAXONOMY: TaxonomyTheme[] = [
  {
    theme: 'This Is Me!',
    subTopics: [
      'My Birthday',
      'How Old Am I?',
      'My Body',
      'My Senses',
      'Hands at Work',
      'How Do I Feel?',
      'With My Loved Ones (Family/Friends/Pets)',
      'My House',
      'My School',
    ],
  },
  {
    theme: 'Farm to Fork',
    subTopics: ['Fruits', 'Vegetables', 'Table Manners'],
  },
  {
    theme: 'Animal World',
    subTopics: ['Farm Animals', 'Wild Animals', 'Insects and Bugs'],
  },
  {
    theme: 'Community Helpers',
    subTopics: [
      'Teacher',
      'Doctor',
      'Policeman',
      'Fire Fighter',
      'How They Help Us',
      'Tools They Use',
    ],
  },
  {
    theme: 'Modes of Transport',
    subTopics: ['Land', 'Water', 'Air'],
  },
  {
    theme: 'Maths — Pre-Maths Concepts',
    subTopics: [
      'Big/Small',
      'Tall/Short',
      'Long/Short',
      'Heavy/Light',
      'More/Less',
      'Same/Different',
      'One-on-One Difference',
      'Near/Far',
    ],
  },
  {
    theme: 'Maths — Core',
    subTopics: [
      'Shapes (Square, Rectangle, Triangle, Circle, Star, Heart)',
      'Numbers 1–10',
      'Subitising 1–10',
    ],
  },
];

export const FS2_TAXONOMY: TaxonomyTheme[] = [
  {
    theme: 'Myself',
    subTopics: [
      'Myself',
      'My Family',
      'My Friends',
      'My Home',
      'My Neighbourhood',
      'Safety (School/Home/Playground)',
      'Wonders of the World',
      'Magic Words',
      'Personal Hygiene',
      'Activities I Do',
      'Lifecycle of a Human',
    ],
  },
  {
    theme: 'Tiny Seeds Mighty Trees',
    subTopics: [
      'Types of Plants',
      'Parts of the Plant',
      'Germination',
      'Ideal Growth Conditions',
      'Things We Get from Trees',
    ],
  },
  {
    theme: 'Paws, Claws and Tails',
    subTopics: [
      'Farm Animals',
      'Wild Animals',
      'Baby Animals',
      'Animal Sounds (text matching)',
      'Animal Habitats',
      'Animal Care (animal + its food)',
      'Aquatic Animals',
    ],
  },
  {
    theme: 'Eco Explorers',
    subTopics: [
      'Harmful Effects of Pollution',
      'Reduce/Reuse/Recycle',
      'Types of Trash (metal/plastic/organic)',
    ],
  },
  {
    theme: 'Mission: Space and Time',
    subTopics: [
      'Solar System',
      'Planetary Facts',
      'Astronauts',
      'Space Stations',
      'Satellites',
      'Space Scientists',
      'Clocks/Time',
    ],
  },
  {
    theme: 'Maths — Core',
    subTopics: [
      'Numbers 1–20',
      'Number-Value Association',
      'Before/After/Between',
      'Descending Order 1–10',
      'Number Sets',
      'Subitising',
      'Number Bonds',
      'Addition (single digit)',
      'Missing Numbers 1–20',
      'Ordinal Numbers',
      'Backward Counting 1–20',
      'Doubling',
      'Fractions (Whole/Half/Quarter)',
      '2D Shapes',
      'Primary/Secondary Colours',
      'Number Grouping',
      'Full/Half/Empty',
      'Volume',
      'Graphs',
      'Patterns',
      'Days of the Week',
      'Months of the Year',
      '3D Shapes',
      'Subtraction (single digit)',
    ],
  },
  {
    theme: 'Maths — Pre-Maths Concepts',
    subTopics: [
      'Big/Small',
      'Heavy/Light',
      'More/Less',
      'Tall/Short',
      'Long/Short',
      'Large/Small',
      'Up/Down',
      'One/Many',
    ],
  },
  {
    theme: 'Language',
    subTopics: [
      'Rhyming Words',
      'Picture Sequencing',
      'Public Speaking',
      'Interviews',
      'Riddles/Puzzle Solving',
      'Hygiene/Self-Care Discussion',
      'Simple Sentence Reading',
      'Yes/No Comprehension',
      'Onomatopoeia',
      'Sequence Adverbs (First/Next/Then/Finally)',
      'Picture-Based Story Formation',
      'Spot the Difference',
      'Word Search',
      'Thematic Art',
      'Picture Talk',
      'Missing Letters',
      'Question-Based Art',
      'Action Words',
      'Story Narration (character/setting/problem/emotion)',
      'Wh- Questions',
      'Rhyme-Based Sequential Actions',
      'Text/Instruction-Based Art',
      'Picture Decoding',
      'Positional Words',
      'Compound Words',
      'Picture Discussion',
      'Picture Comprehension',
      'Text Sequencing',
      'Decoding Words',
      'Word Sequencing for Sentences',
      'Time Progression (Today/Yesterday/Tomorrow)',
      'Descriptive Text Comprehension',
    ],
  },
];

export function taxonomyForAgeBand(min: number, max: number): TaxonomyTheme[] | null {
  // FS0 2–3, FS1 3–4, FS2 4–5 — pick the stage whose band overlaps the request most.
  const mid = (min + max) / 2;
  if (mid < 3) return FS0_TAXONOMY;
  if (mid < 4) return FS1_TAXONOMY;
  if (mid <= 5) return FS2_TAXONOMY;
  return null; // Grade 1+ — free-form topics
}

export function flattenTaxonomyThemes(taxonomy: TaxonomyTheme[]): string[] {
  return taxonomy.map((t) => t.theme);
}

export function flattenTaxonomySubTopics(taxonomy: TaxonomyTheme[]): string[] {
  return taxonomy.flatMap((t) => t.subTopics);
}
