import { HttpStatus } from '@nestjs/common';
import {
  DEFAULT_LANGUAGE,
  DIFFICULTY_LEVELS,
  DifficultyLevel,
  GRADE_AGE_DEFAULTS,
  LEARNING_OBJECTIVES,
  LearningObjective,
  SUBJECTS,
} from '../constants/flashcard.constants';
import { FlashcardException } from '../errors/flashcard.exception';

const OBJECTIVE_KEYWORDS: Array<{
  objective: LearningObjective;
  keywords: string[];
}> = [
  { objective: 'counting', keywords: ['count', 'number', 'how many'] },
  { objective: 'matching', keywords: ['match', 'pair'] },
  { objective: 'sorting', keywords: ['sort', 'group'] },
  { objective: 'classification', keywords: ['classify', 'category', 'type of'] },
  { objective: 'comparison', keywords: ['compare', 'difference', 'vs'] },
  { objective: 'question_answer', keywords: ['quiz', 'question', 'ask'] },
  { objective: 'science_facts', keywords: ['fact', 'science', 'why'] },
  { objective: 'reading', keywords: ['read', 'sentence', 'story'] },
  {
    objective: 'phonics',
    keywords: ['phonics', 'pronounce', 'sound out', 'letter sound'],
  },
  { objective: 'recognition', keywords: ['recognize', 'spot', 'identify'] },
  { objective: 'vocabulary', keywords: ['word', 'vocab', 'learn'] },
  { objective: 'general_knowledge', keywords: ['know', 'about'] },
];

const SUBJECT_KEYWORDS: Array<{ subject: string; keywords: string[] }> = [
  {
    subject: 'EVS',
    keywords: [
      'evs',
      'environment',
      'vegetables',
      'fruits',
      'animals',
      'plants',
      'nature',
    ],
  },
  {
    subject: 'Math',
    keywords: ['math', 'maths', 'number', 'count', 'addition', 'subtract'],
  },
  {
    subject: 'English',
    keywords: ['english', 'alphabet', 'phonics', 'reading', 'grammar'],
  },
  {
    subject: 'Science',
    keywords: ['science', 'biology', 'physics', 'chemistry'],
  },
];

const DIFFICULTY_KEYWORDS: Array<{
  difficulty: DifficultyLevel;
  keywords: string[];
}> = [
  { difficulty: 'beginner', keywords: ['beginner', 'easy', 'basic', 'simple'] },
  {
    difficulty: 'intermediate',
    keywords: ['intermediate', 'medium', 'moderate'],
  },
  {
    difficulty: 'advanced',
    keywords: ['advanced', 'hard', 'difficult', 'challenging'],
  },
];

const LANGUAGE_KEYWORDS: Array<{ language: string; keywords: string[] }> = [
  { language: 'Hindi', keywords: ['hindi', 'हिंदी'] },
  { language: 'Spanish', keywords: ['spanish', 'español'] },
  { language: 'French', keywords: ['french', 'français'] },
  { language: 'English', keywords: ['english'] },
];

const QUERY_NOISE =
  /\b(generate|create|make|give|show|please|flash ?cards?|cards?|for|kids?|children|learners?|about|on|the|a|an|some|few|in)\b/gi;

export interface ParsedAgeGroup {
  ageMin: number;
  ageMax: number;
  label: string;
}

export interface ResolvedUserRequest {
  query: string;
  topic: string;
  ageMin: number;
  ageMax: number;
  ageGroup: string;
  grade: string | null;
  subject: string | null;
  difficulty: DifficultyLevel;
  language: string;
  learningObjective: LearningObjective;
  educationalIntent: LearningObjective;
}

/**
 * Accepts "3-4", "3–4", "3 to 4", "ages 3-4", etc.
 */
export function parseAgeGroup(ageGroup: string): ParsedAgeGroup {
  const raw = ageGroup?.trim();
  if (!raw) {
    throw new FlashcardException(
      'UNSUPPORTED_AGE',
      'ageGroup is required',
      HttpStatus.BAD_REQUEST,
    );
  }

  const normalized = raw
    .toLowerCase()
    .replace(/ages?/g, '')
    .replace(/[–—]/g, '-')
    .replace(/\s+to\s+/g, '-')
    .replace(/\s+/g, '')
    .trim();

  const match = normalized.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!match) {
    throw new FlashcardException(
      'UNSUPPORTED_AGE',
      `Invalid ageGroup "${ageGroup}". Expected format like "3-4"`,
      HttpStatus.BAD_REQUEST,
      { ageGroup },
    );
  }

  const ageMin = Number(match[1]);
  const ageMax = Number(match[2]);
  if (ageMin > ageMax) {
    throw new FlashcardException(
      'UNSUPPORTED_AGE',
      `Invalid ageGroup "${ageGroup}": min age cannot exceed max age`,
      HttpStatus.BAD_REQUEST,
      { ageMin, ageMax },
    );
  }

  return {
    ageMin,
    ageMax,
    label: `${ageMin}-${ageMax}`,
  };
}

/**
 * Normalize "Grade 1", "grade1", "G1", "1st grade", "nursery", etc.
 */
export function parseGrade(raw: string | undefined | null): string | null {
  if (!raw?.trim()) {
    return null;
  }

  const text = raw.trim().toLowerCase();

  if (/\bnursery\b/.test(text)) return 'Nursery';
  if (/\bpre[-\s]?school\b/.test(text)) return 'Preschool';
  if (/\b(kg|kindergarten)\b/.test(text)) return 'KG';

  const numbered =
    text.match(/\b(?:grade|class|std|standard)\s*[-:]?\s*(\d{1,2})\b/) ||
    text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:grade|class|std|standard)\b/) ||
    text.match(/\bg\s*[-:]?\s*(\d{1,2})\b/);

  if (numbered) {
    return `Grade ${Number(numbered[1])}`;
  }

  return null;
}

export function extractGradeFromQuery(query: string): string | null {
  return parseGrade(query);
}

function gradeKey(grade: string): string {
  return grade.trim().toLowerCase();
}

export function ageDefaultsForGrade(
  grade: string,
): { ageMin: number; ageMax: number; difficulty: DifficultyLevel } | null {
  return GRADE_AGE_DEFAULTS[gradeKey(grade)] ?? null;
}

function difficultyFromAge(ageMin: number, ageMax: number): DifficultyLevel {
  const midpoint = (ageMin + ageMax) / 2;
  if (midpoint <= 6) return 'beginner';
  if (midpoint <= 10) return 'intermediate';
  return 'advanced';
}

function objectiveFromAge(ageMin: number, ageMax: number): LearningObjective {
  const midpoint = (ageMin + ageMax) / 2;
  if (midpoint <= 3) return 'recognition';
  if (midpoint <= 6) return 'vocabulary';
  if (midpoint <= 8) return 'question_answer';
  return 'general_knowledge';
}

export function resolveLearningObjectiveFromQuery(
  query: string,
  ageMin: number,
  ageMax: number,
): LearningObjective {
  const haystack = query.toLowerCase();

  for (const entry of OBJECTIVE_KEYWORDS) {
    if (entry.keywords.some((keyword) => haystack.includes(keyword))) {
      return entry.objective;
    }
  }

  return objectiveFromAge(ageMin, ageMax);
}

export function resolveSubjectFromQuery(query: string): string | null {
  const haystack = query.toLowerCase();
  for (const entry of SUBJECT_KEYWORDS) {
    if (entry.keywords.some((keyword) => haystack.includes(keyword))) {
      return entry.subject;
    }
  }
  return null;
}

export function resolveDifficultyFromQuery(
  query: string,
): DifficultyLevel | null {
  const haystack = query.toLowerCase();
  for (const entry of DIFFICULTY_KEYWORDS) {
    if (entry.keywords.some((keyword) => haystack.includes(keyword))) {
      return entry.difficulty;
    }
  }
  return null;
}

export function resolveLanguageFromQuery(query: string): string | null {
  const haystack = query.toLowerCase();
  for (const entry of LANGUAGE_KEYWORDS) {
    if (entry.keywords.some((keyword) => haystack.includes(keyword))) {
      return entry.language;
    }
  }
  return null;
}

function normalizeDifficulty(value: string | undefined): DifficultyLevel | null {
  if (!value?.trim()) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'easy' || normalized === 'basic' || normalized === 'simple') {
    return 'beginner';
  }
  if (normalized === 'medium' || normalized === 'moderate') {
    return 'intermediate';
  }
  if (
    normalized === 'hard' ||
    normalized === 'difficult' ||
    normalized === 'challenging'
  ) {
    return 'advanced';
  }
  if ((DIFFICULTY_LEVELS as readonly string[]).includes(normalized)) {
    return normalized as DifficultyLevel;
  }
  return null;
}

function normalizeSubject(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  const known = SUBJECTS.find((item) => item === lower);
  if (known) {
    return known === 'evs'
      ? 'EVS'
      : known.charAt(0).toUpperCase() + known.slice(1);
  }
  return trimmed;
}

export function extractTopicFromQuery(query: string): string {
  let topic = query
    .replace(QUERY_NOISE, ' ')
    .replace(/\bages?\s*\d{1,2}\s*[-–—to]+\s*\d{1,2}\b/gi, ' ')
    .replace(/\b\d{1,2}\s*[-–—]\s*\d{1,2}\b/g, ' ')
    .replace(/\b(?:grade|class|std|standard)\s*[-:]?\s*\d{1,2}\b/gi, ' ')
    .replace(/\b\d{1,2}(?:st|nd|rd|th)?\s*(?:grade|class)\b/gi, ' ')
    .replace(/\b(?:beginner|intermediate|advanced|easy|hard)\b/gi, ' ')
    .replace(/\b(?:evs|math|maths|english|science|hindi)\b/gi, ' ')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!topic) {
    topic = query.trim();
  }

  return topic;
}

export function resolveUserRequest(input: {
  query: string;
  ageGroup?: string;
  grade?: string;
  subject?: string;
  difficulty?: string;
  language?: string;
}): ResolvedUserRequest {
  const query = input.query?.trim();
  if (!query) {
    throw new FlashcardException(
      'INVALID_REQUEST',
      'query is required',
      HttpStatus.BAD_REQUEST,
    );
  }

  const grade =
    parseGrade(input.grade) ?? extractGradeFromQuery(query) ?? null;

  let ageMin: number;
  let ageMax: number;
  let ageGroup: string;

  if (input.ageGroup?.trim()) {
    const age = parseAgeGroup(input.ageGroup);
    ageMin = age.ageMin;
    ageMax = age.ageMax;
    ageGroup = age.label;
  } else if (grade) {
    const defaults = ageDefaultsForGrade(grade);
    if (!defaults) {
      throw new FlashcardException(
        'UNSUPPORTED_AGE',
        `No default age band for grade "${grade}". Provide ageGroup.`,
        HttpStatus.BAD_REQUEST,
        { grade },
      );
    }
    ageMin = defaults.ageMin;
    ageMax = defaults.ageMax;
    ageGroup = `${defaults.ageMin}-${defaults.ageMax}`;
  } else {
    throw new FlashcardException(
      'UNSUPPORTED_AGE',
      'Provide ageGroup or a recognizable grade in the query',
      HttpStatus.BAD_REQUEST,
    );
  }

  const learningObjective = resolveLearningObjectiveFromQuery(
    query,
    ageMin,
    ageMax,
  );

  if (!(LEARNING_OBJECTIVES as readonly string[]).includes(learningObjective)) {
    throw new FlashcardException(
      'UNKNOWN_LEARNING_OBJECTIVE',
      `Could not resolve a learning objective from query`,
    );
  }

  const difficulty =
    normalizeDifficulty(input.difficulty) ??
    resolveDifficultyFromQuery(query) ??
    (grade ? ageDefaultsForGrade(grade)?.difficulty : null) ??
    difficultyFromAge(ageMin, ageMax);

  const subject =
    normalizeSubject(input.subject) ?? resolveSubjectFromQuery(query);

  const language =
    input.language?.trim() ||
    resolveLanguageFromQuery(query) ||
    DEFAULT_LANGUAGE;

  return {
    query,
    topic: extractTopicFromQuery(query),
    ageMin,
    ageMax,
    ageGroup,
    grade,
    subject,
    difficulty,
    language,
    learningObjective,
    educationalIntent: learningObjective,
  };
}
