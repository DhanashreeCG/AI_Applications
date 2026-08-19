export const LEARNING_OBJECTIVES = [
  'vocabulary',
  'recognition',
  'reading',
  'phonics',
  'classification',
  'comparison',
  'science_facts',
  'counting',
  'question_answer',
  'matching',
  'sorting',
  'general_knowledge',
  // legacy aliases kept for existing templates/rules
  'memory',
  'language_learning',
  'identification',
] as const;

export type LearningObjective = (typeof LEARNING_OBJECTIVES)[number];

export const DIFFICULTY_LEVELS = [
  'beginner',
  'intermediate',
  'advanced',
] as const;

export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number];

/** Normalize seed / legacy difficulty labels to the revised taxonomy. */
export function canonicalizeDifficulty(
  value: string | undefined | null,
): DifficultyLevel | null {
  if (!value?.trim()) return null;
  const key = value.trim().toLowerCase();
  if (key === 'easy' || key === 'basic' || key === 'simple' || key === 'beginner') {
    return 'beginner';
  }
  if (key === 'medium' || key === 'moderate' || key === 'intermediate') {
    return 'intermediate';
  }
  if (
    key === 'hard' ||
    key === 'difficult' ||
    key === 'challenging' ||
    key === 'advanced'
  ) {
    return 'advanced';
  }
  if ((DIFFICULTY_LEVELS as readonly string[]).includes(key)) {
    return key as DifficultyLevel;
  }
  return null;
}

export const SUBJECTS = [
  'evs',
  'math',
  'english',
  'science',
  'general',
] as const;

export type Subject = (typeof SUBJECTS)[number];

/** Grade label → typical age band used when ageGroup is omitted. */
export const GRADE_AGE_DEFAULTS: Record<
  string,
  { ageMin: number; ageMax: number; difficulty: DifficultyLevel }
> = {
  nursery: { ageMin: 2, ageMax: 3, difficulty: 'beginner' },
  preschool: { ageMin: 3, ageMax: 4, difficulty: 'beginner' },
  kg: { ageMin: 4, ageMax: 5, difficulty: 'beginner' },
  'grade 1': { ageMin: 5, ageMax: 6, difficulty: 'beginner' },
  'grade 2': { ageMin: 6, ageMax: 7, difficulty: 'beginner' },
  'grade 3': { ageMin: 7, ageMax: 8, difficulty: 'intermediate' },
  'grade 4': { ageMin: 8, ageMax: 9, difficulty: 'intermediate' },
  'grade 5': { ageMin: 9, ageMax: 10, difficulty: 'intermediate' },
  'grade 6': { ageMin: 10, ageMax: 11, difficulty: 'advanced' },
  'grade 7': { ageMin: 11, ageMax: 12, difficulty: 'advanced' },
  'grade 8': { ageMin: 12, ageMax: 13, difficulty: 'advanced' },
};

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
  'chips',
] as const;

export type ComponentType = (typeof COMPONENT_TYPES)[number];

export const FLASHCARD_CONTENT_STAGE = 'flashcard_content';
export const FLASHCARD_EDIT_STAGE = 'flashcard_edit';
export const FLASHCARD_WORKFLOW_EDIT = 'flashcards_edit';
export const FLASHCARD_IMAGE_SEARCH_EMBEDDING_PURPOSE =
  'flashcard_image_search_embedding';
export const FLASHCARD_ASSET_IMAGE_PATH = '/flashcards/assets';
export const DEFAULT_FLASHCARD_COUNT = 5;
export const FLASHCARD_USER_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const FLASHCARD_USER_UPLOAD_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
export const DEFAULT_IMAGE_CONCURRENCY = 3;
export const DEFAULT_SIGNED_URL_TTL_SECONDS = 3600;
/** Ranked hits from one query so later cards can take 2nd/3rd if top is already used. */
export const DEFAULT_IMAGE_SEARCH_LIMIT = 8;
/** Total embedding/search attempts for the same LLM query (1 + retries). */
export const DEFAULT_IMAGE_EMBEDDING_MAX_ATTEMPTS = 3;
export const DEFAULT_IMAGE_EMBEDDING_RETRY_DELAY_MS = 200;
export const DEFAULT_LANGUAGE = 'English';
