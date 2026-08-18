import { LetterEntity } from './letter-query-detector.service';

export function canonicalObjectStrings(entity: LetterEntity): string[] {
  const l = entity.letter.toLowerCase();
  switch (entity.case) {
    case 'upper':
      return [`capital letter ${l}`];
    case 'lower':
      return [`lowercase letter ${l}`];
    case 'both':
    default:
      return [`capital letter ${l}`, `lowercase letter ${l}`];
  }
}

/** Combined (Aa) assets carry both labels; single-case assets carry exactly one. */
export function matchesCanonicalLetterObjects(
  objects: string[] | undefined,
  entity: LetterEntity,
): boolean {
  const objs = (objects ?? []).map((o) => o.toLowerCase());
  const letter = entity.letter.toLowerCase();
  const capital = `capital letter ${letter}`;
  const lower = `lowercase letter ${letter}`;
  const hasCapital = objs.includes(capital);
  const hasLower = objs.includes(lower);

  switch (entity.case) {
    case 'upper':
      return hasCapital && !hasLower;
    case 'lower':
      return hasLower && !hasCapital;
    case 'both':
    default:
      return hasCapital && hasLower;
  }
}
