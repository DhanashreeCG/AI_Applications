export const LEARNING_OBJECTIVES = [
  'vocabulary',
  'recognition',
  'reading',
  'classification',
  'comparison',
  'memory',
  'science_facts',
  'language_learning',
  'general_knowledge',
  'matching',
  'counting',
  'question_answer',
  'sorting',
  'identification',
] as const;

export type LearningObjective = (typeof LEARNING_OBJECTIVES)[number];

export const COMPONENT_TYPES = [
  'image',
  'title',
  'subtitle',
  'sentence',
  'fact',
  'question',
  'answer',
  'footer',
  'badge',
  'pronunciation',
  'phonics',
] as const;

export type ComponentType = (typeof COMPONENT_TYPES)[number];

export const FLASHCARD_CONTENT_STAGE = 'flashcard_content';
export const FLASHCARD_IMAGE_SEARCH_EMBEDDING_PURPOSE =
  'flashcard_image_search_embedding';
export const FLASHCARD_ASSET_IMAGE_PATH = '/flashcards/assets';
export const DEFAULT_FLASHCARD_COUNT = 5;
export const DEFAULT_IMAGE_CONCURRENCY = 3;
export const DEFAULT_SIGNED_URL_TTL_SECONDS = 3600;
/** Nearby embedding hits to choose from (unused-first) in one search call. */
export const DEFAULT_IMAGE_SEARCH_LIMIT = 5;
