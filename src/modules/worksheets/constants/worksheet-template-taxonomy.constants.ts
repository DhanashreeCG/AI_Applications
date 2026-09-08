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

/** 15-item activity taxonomy used on templates and for Stage 2 classification. */
export const WORKSHEET_ACTIVITY_TYPES = [
  'Trace & Write',
  'Count & Circle',
  'Match the Pairs',
  'Sort into Two Boxes',
  'What Comes Next',
  'Fill Missing Numbers',
  'Odd One Out',
  'Color by Code',
  'Connect the Dots',
  'Maze/Path',
  'Yes/No Judgement',
  'Tally & Graph',
  'Word Problem',
  'Cut/Sort/Paste',
  'Before/After/Between',
] as const;

export type WorksheetActivityType = (typeof WORKSHEET_ACTIVITY_TYPES)[number];

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
