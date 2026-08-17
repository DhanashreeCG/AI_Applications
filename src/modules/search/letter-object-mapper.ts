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
