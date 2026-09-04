/**
 * @deprecated The word-list based sanitization tested here is now kept only as
 * a fallback mechanism. The primary refinement path uses the dedicated
 * ImageQueryRefinementService.
 */
import {
  requestWantsLineArt,
  sanitizeCardImageQueries,
  sanitizeImageSearchQuery,
} from './image-query.util';
import { LlmCardContent } from '../interfaces/flashcard.interfaces';

describe('requestWantsLineArt', () => {
  it('is false for a normal picture request', () => {
    expect(
      requestWantsLineArt({ query: 'flashcards for animals', topic: 'animals' }),
    ).toBe(false);
  });

  it('is true when the user asks for tracing or colouring', () => {
    expect(requestWantsLineArt({ query: 'letter tracing cards' })).toBe(true);
    expect(requestWantsLineArt({ query: 'coloring pages of fruits' })).toBe(true);
    expect(requestWantsLineArt({ learningObjective: 'handwriting' })).toBe(true);
    expect(requestWantsLineArt({ topic: 'outline drawings of shapes' })).toBe(true);
  });
});

describe('sanitizeImageSearchQuery', () => {
  it('strips teaching-purpose noise and keeps the visual subject', () => {
    expect(
      sanitizeImageSearchQuery(
        'ant insect on green leaf for letter tracing vocabulary learning',
      ),
    ).toBe('ant insect on green leaf');
  });

  it('leaves an already visual query untouched', () => {
    expect(sanitizeImageSearchQuery('cartoon ant insect')).toBe(
      'cartoon ant insect',
    );
  });

  it('removes line-art terms when the request is not about tracing', () => {
    expect(sanitizeImageSearchQuery('black and white line art lion outline')).toBe(
      'lion',
    );
  });

  it('keeps line-art terms when the request is about tracing', () => {
    expect(
      sanitizeImageSearchQuery('line art lion outline', { allowLineArt: true }),
    ).toBe('line art lion outline');
  });

  it('never rewrites a letter glyph query', () => {
    expect(sanitizeImageSearchQuery('Letter Q')).toBe('Letter Q');
    expect(sanitizeImageSearchQuery('number 9')).toBe('number 9');
  });

  it('falls back to the LLM expected object when only noise remains', () => {
    expect(
      sanitizeImageSearchQuery('educational flashcard for kids', {
        fallback: 'strawberry',
      }),
    ).toBe('strawberry');
  });

  it('keeps the original when nothing survives and no fallback exists', () => {
    expect(sanitizeImageSearchQuery('flashcard learning')).toBe(
      'flashcard learning',
    );
  });

  it('does not strip colour words that merely look like colouring', () => {
    expect(sanitizeImageSearchQuery('colorful cartoon parrot bird')).toBe(
      'colorful cartoon parrot bird',
    );
  });
});

describe('sanitizeCardImageQueries', () => {
  const buildCards = (): LlmCardContent[] => [
    {
      cardIndex: 0,
      textComponents: { title: 'Ant' },
      imageComponents: {
        hero: {
          searchQuery: 'cartoon ant insect for preschool vocabulary learning',
          expectedObjects: ['ant'],
        },
      },
    },
    {
      cardIndex: 1,
      textComponents: { title: 'Lion' },
      imageComponents: {
        hero: {
          searchQuery: 'cartoon lion wild animal',
          expectedObjects: ['lion'],
        },
      },
    },
  ];

  it('cleans only the slots that carry noise and reports the change', () => {
    const cards = buildCards();
    const changes = sanitizeCardImageQueries(cards);

    expect(cards[0].imageComponents.hero.searchQuery).toBe('cartoon ant insect');
    expect(cards[1].imageComponents.hero.searchQuery).toBe(
      'cartoon lion wild animal',
    );
    expect(changes).toEqual([
      {
        cardIndex: 0,
        componentId: 'hero',
        from: 'cartoon ant insect for preschool vocabulary learning',
        to: 'cartoon ant insect',
      },
    ]);
  });

  it('preserves the other query fields', () => {
    const cards = buildCards();
    cards[0].imageComponents.hero.preferredStyle = 'cartoon';
    sanitizeCardImageQueries(cards);

    expect(cards[0].imageComponents.hero.preferredStyle).toBe('cartoon');
    expect(cards[0].imageComponents.hero.expectedObjects).toEqual(['ant']);
  });
});
