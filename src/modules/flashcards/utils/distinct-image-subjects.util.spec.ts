import { uniquifyCardImageQueries } from './distinct-image-subjects.util';
import { LlmCardContent } from '../interfaces/flashcard.interfaces';

function card(
  index: number,
  word: string,
  objects: string[],
): LlmCardContent {
  return {
    cardIndex: index,
    textComponents: { word },
    imageComponents: {
      hero: {
        searchQuery: objects[0],
        expectedObjects: objects,
      },
    },
  };
}

describe('uniquifyCardImageQueries', () => {
  it('leaves a single card unchanged', () => {
    const cards = [card(0, 'Apple', ['apple'])];
    uniquifyCardImageQueries(cards);
    expect(cards[0].imageComponents.hero.expectedObjects[0]).toBe('apple');
  });

  it('rewrites a duplicate subject using card text', () => {
    const cards = [card(0, 'Apple', ['apple']), card(1, 'Banana', ['apple'])];
    uniquifyCardImageQueries(cards);
    expect(cards[0].imageComponents.hero.expectedObjects[0]).toBe('apple');
    expect(cards[1].imageComponents.hero.expectedObjects[0]).toBe('banana');
    expect(cards[1].imageComponents.hero.searchQuery).toBe('banana');
  });

  it('does not rewrite letter-glyph subjects', () => {
    const cards = [
      {
        cardIndex: 0,
        textComponents: { letter: 'A' },
        imageComponents: {
          letterImage: {
            searchQuery: 'Letter A',
            expectedObjects: ['A'],
          },
        },
      },
      {
        cardIndex: 1,
        textComponents: { letter: 'A' },
        imageComponents: {
          letterImage: {
            searchQuery: 'Letter A',
            expectedObjects: ['A'],
          },
        },
      },
    ];
    uniquifyCardImageQueries(cards);
    expect(cards[1].imageComponents.letterImage.searchQuery).toBe('Letter A');
  });
});
