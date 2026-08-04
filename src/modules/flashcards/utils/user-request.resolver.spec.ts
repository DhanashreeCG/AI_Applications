import {
  extractGradeFromQuery,
  parseAgeGroup,
  parseGrade,
  resolveUserRequest,
} from './user-request.resolver';
import { FlashcardException } from '../errors/flashcard.exception';

describe('parseAgeGroup', () => {
  it('parses hyphenated age groups', () => {
    expect(parseAgeGroup('3-4')).toEqual({
      ageMin: 3,
      ageMax: 4,
      label: '3-4',
    });
  });

  it('parses en-dash and "to" forms', () => {
    expect(parseAgeGroup('3–4').label).toBe('3-4');
    expect(parseAgeGroup('ages 5 to 6')).toEqual({
      ageMin: 5,
      ageMax: 6,
      label: '5-6',
    });
  });

  it('rejects invalid age groups', () => {
    expect(() => parseAgeGroup('kids')).toThrow(FlashcardException);
    expect(() => parseAgeGroup('6-3')).toThrow(FlashcardException);
  });
});

describe('parseGrade / extractGradeFromQuery', () => {
  it('parses Grade 1 variants', () => {
    expect(parseGrade('Grade 1')).toBe('Grade 1');
    expect(extractGradeFromQuery('flashcards for grade 1')).toBe('Grade 1');
    expect(extractGradeFromQuery('1st grade vegetables')).toBe('Grade 1');
    expect(extractGradeFromQuery('G1 math')).toBe('Grade 1');
  });
});

describe('resolveUserRequest', () => {
  it('derives topic and age-based objective from a sentence', () => {
    const resolved = resolveUserRequest({
      query: 'Generate flashcards on vegetables',
      ageGroup: '3-4',
    });

    expect(resolved.topic.toLowerCase()).toContain('vegetables');
    expect(resolved.ageGroup).toBe('3-4');
    expect(resolved.learningObjective).toBe('vocabulary');
    expect(resolved.difficulty).toBe('beginner');
    expect(resolved.language).toBe('English');
  });

  it('extracts grade, subject, and age defaults from Grade 1 vegetables request', () => {
    const resolved = resolveUserRequest({
      query: 'Generate 12 flashcards on vegetables for Grade 1',
    });

    expect(resolved.grade).toBe('Grade 1');
    expect(resolved.ageGroup).toBe('5-6');
    expect(resolved.subject).toBe('EVS');
    expect(resolved.difficulty).toBe('beginner');
    expect(resolved.topic.toLowerCase()).toContain('vegetables');
    expect(resolved.educationalIntent).toBe(resolved.learningObjective);
  });

  it('infers objective keywords from the query', () => {
    const resolved = resolveUserRequest({
      query: 'Make a quiz about animals',
      ageGroup: '6-8',
    });

    expect(resolved.learningObjective).toBe('question_answer');
    expect(resolved.topic.toLowerCase()).toContain('animals');
  });

  it('infers phonics intent deterministically', () => {
    const resolved = resolveUserRequest({
      query: 'Generate phonics flashcards for alphabet',
      ageGroup: '4-5',
    });
    expect(resolved.learningObjective).toBe('phonics');
  });

  it('requires query', () => {
    expect(() =>
      resolveUserRequest({ query: '  ', ageGroup: '3-4' }),
    ).toThrow(FlashcardException);
  });

  it('requires ageGroup or grade', () => {
    expect(() =>
      resolveUserRequest({ query: 'flashcards on fruits' }),
    ).toThrow(FlashcardException);
  });
});
