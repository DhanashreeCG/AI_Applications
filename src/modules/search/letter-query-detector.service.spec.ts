import { LetterQueryDetectorService } from './letter-query-detector.service';
import { canonicalObjectStrings } from './letter-object-mapper';

describe('LetterQueryDetectorService', () => {
  const detector = new LetterQueryDetectorService();

  it('defaults "Letter A" to combined upper+lower', () => {
    expect(detector.detect('Letter A')).toEqual({ letter: 'A', case: 'both' });
  });

  it('defaults "letter a" to combined upper+lower', () => {
    expect(detector.detect('letter a')).toEqual({ letter: 'A', case: 'both' });
  });

  it('does not detect "Aa" alone', () => {
    expect(detector.detect('Aa')).toBeNull();
  });

  it('detects secondary-anchor "capital B worksheet"', () => {
    expect(detector.detect('capital B worksheet')).toEqual({
      letter: 'B',
      case: 'upper',
    });
  });

  it('detects explicit lowercase', () => {
    expect(detector.detect('lowercase letter a')).toEqual({
      letter: 'A',
      case: 'lower',
    });
  });

  it.each(['A cat', 'a ball', 'the dog and a cat story'])(
    'does not detect generic query "%s"',
    (query) => {
      expect(detector.detect(query)).toBeNull();
    },
  );

  it.each(['L is for Ladder', 'picture of the letter O'])(
    'suppresses object-intent query "%s"',
    (query) => {
      expect(detector.detect(query)).toBeNull();
    },
  );

  it.each(
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => ({
      query: `Letter ${letter}`,
      expected: { letter, case: 'both' as const },
      objects: [
        `capital letter ${letter.toLowerCase()}`,
        `lowercase letter ${letter.toLowerCase()}`,
      ],
    })),
  )('defaults $query to combined objects', ({ query, expected, objects }) => {
    const entity = detector.detect(query);
    expect(entity).toEqual(expected);
    expect(canonicalObjectStrings(entity!)).toEqual(objects);
  });
});
