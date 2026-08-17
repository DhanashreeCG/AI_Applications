import { LetterQueryDetectorService } from './letter-query-detector.service';
import { canonicalObjectStrings } from './letter-object-mapper';

describe('LetterQueryDetectorService', () => {
  const detector = new LetterQueryDetectorService();

  it('detects "Letter A" as uppercase A', () => {
    expect(detector.detect('Letter A')).toEqual({ letter: 'A', case: 'upper' });
  });

  it('detects "letter a" as lowercase A', () => {
    expect(detector.detect('letter a')).toEqual({ letter: 'A', case: 'lower' });
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
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').flatMap((letter) => [
      {
        query: `Letter ${letter}`,
        expected: { letter, case: 'upper' as const },
        objects: [`capital letter ${letter.toLowerCase()}`],
      },
      {
        query: `letter ${letter.toLowerCase()}`,
        expected: { letter, case: 'lower' as const },
        objects: [`lowercase letter ${letter.toLowerCase()}`],
      },
    ]),
  )('detects $query for all 26 letters × both cases', ({ query, expected, objects }) => {
    const entity = detector.detect(query);
    expect(entity).toEqual(expected);
    expect(canonicalObjectStrings(entity!)).toEqual(objects);
  });
});
