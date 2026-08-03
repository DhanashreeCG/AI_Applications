import { HttpStatus } from '@nestjs/common';
import {
  LEARNING_OBJECTIVES,
  LearningObjective,
} from '../constants/flashcard.constants';
import { FlashcardException } from '../errors/flashcard.exception';

const OBJECTIVE_KEYWORDS: Array<{
  objective: LearningObjective;
  keywords: string[];
}> = [
  { objective: 'counting', keywords: ['count', 'number', 'how many'] },
  { objective: 'matching', keywords: ['match', 'pair'] },
  { objective: 'sorting', keywords: ['sort', 'group', 'classify'] },
  { objective: 'classification', keywords: ['classify', 'category', 'type of'] },
  { objective: 'comparison', keywords: ['compare', 'difference', 'vs'] },
  { objective: 'question_answer', keywords: ['quiz', 'question', 'ask'] },
  { objective: 'science_facts', keywords: ['fact', 'science', 'why'] },
  { objective: 'reading', keywords: ['read', 'sentence', 'story'] },
  {
    objective: 'language_learning',
    keywords: ['pronounce', 'phonics', 'language'],
  },
  { objective: 'memory', keywords: ['memory', 'remember'] },
  { objective: 'identification', keywords: ['identify', 'what is', 'name'] },
  { objective: 'recognition', keywords: ['recognize', 'spot'] },
  { objective: 'vocabulary', keywords: ['word', 'vocab', 'learn'] },
  { objective: 'general_knowledge', keywords: ['know', 'about'] },
];

const QUERY_NOISE =
  /\b(generate|create|make|give|show|please|flash ?cards?|cards?|for|kids?|children|learners?|about|on|the|a|an|some|few)\b/gi;

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
  learningObjective: LearningObjective;
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

function objectiveFromAge(ageMin: number, ageMax: number): LearningObjective {
  const midpoint = (ageMin + ageMax) / 2;
  if (midpoint <= 3) return 'recognition';
  if (midpoint <= 4) return 'vocabulary';
  if (midpoint <= 6) return 'science_facts';
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

export function extractTopicFromQuery(query: string): string {
  let topic = query
    .replace(QUERY_NOISE, ' ')
    .replace(/\bages?\s*\d{1,2}\s*[-–—to]+\s*\d{1,2}\b/gi, ' ')
    .replace(/\b\d{1,2}\s*[-–—]\s*\d{1,2}\b/g, ' ')
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
  ageGroup: string;
}): ResolvedUserRequest {
  const query = input.query?.trim();
  if (!query) {
    throw new FlashcardException(
      'INVALID_REQUEST',
      'query is required',
      HttpStatus.BAD_REQUEST,
    );
  }

  const age = parseAgeGroup(input.ageGroup);
  const learningObjective = resolveLearningObjectiveFromQuery(
    query,
    age.ageMin,
    age.ageMax,
  );

  if (!(LEARNING_OBJECTIVES as readonly string[]).includes(learningObjective)) {
    throw new FlashcardException(
      'UNKNOWN_LEARNING_OBJECTIVE',
      `Could not resolve a learning objective from query`,
    );
  }

  return {
    query,
    topic: extractTopicFromQuery(query),
    ageMin: age.ageMin,
    ageMax: age.ageMax,
    ageGroup: age.label,
    learningObjective,
  };
}
