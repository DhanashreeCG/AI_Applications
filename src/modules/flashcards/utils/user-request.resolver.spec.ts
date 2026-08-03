import { parseAgeGroup, resolveUserRequest } from './user-request.resolver';
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

describe('resolveUserRequest', () => {
  it('derives topic and age-based objective from a sentence', () => {
    const resolved = resolveUserRequest({
      query: 'Generate flashcards on vegetables',
      ageGroup: '3-4',
    });

    expect(resolved.topic.toLowerCase()).toContain('vegetables');
    expect(resolved.ageGroup).toBe('3-4');
    expect(resolved.learningObjective).toBe('vocabulary');
  });

  it('infers objective keywords from the query', () => {
    const resolved = resolveUserRequest({
      query: 'Make a quiz about animals',
      ageGroup: '6-8',
    });

    expect(resolved.learningObjective).toBe('question_answer');
    expect(resolved.topic.toLowerCase()).toContain('animals');
  });

  it('requires query', () => {
    expect(() =>
      resolveUserRequest({ query: '  ', ageGroup: '3-4' }),
    ).toThrow(FlashcardException);
  });
});
