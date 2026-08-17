import { Injectable } from '@nestjs/common';

export type LetterCase = 'upper' | 'lower' | 'both';

export interface LetterEntity {
  letter: string;
  case: LetterCase;
}

@Injectable()
export class LetterQueryDetectorService {
  // Primary anchor — REQUIRES the literal word "letter" or "alphabet".
  private readonly PRIMARY_ANCHOR = /\b(?:letter|alphabet)\s+([a-zA-Z])\b/i;

  // Secondary anchor — case word directly adjacent to a single letter,
  // without the word "letter"/"alphabet" present.
  private readonly SECONDARY_ANCHOR =
    /\b(uppercase|capital|lowercase|small)\s+([a-zA-Z])\b(?!\w)/i;

  private readonly CASE_WORD = {
    upper: /\b(uppercase|capital|big|large)\b/i,
    lower: /\b(lowercase|small|tiny)\b/i,
  };

  private readonly OBJECT_INTENT_GUARD =
    /\b(is for|starts? with|picture of|image of|photo of|clipart of|story about|photo|illustration of)\b/i;

  detect(query: string): LetterEntity | null {
    const trimmed = query.trim();
    if (!trimmed) return null;

    let letterChar: string | undefined;

    const primary = this.PRIMARY_ANCHOR.exec(trimmed);
    if (primary) {
      letterChar = primary[1];
    } else {
      const secondary = this.SECONDARY_ANCHOR.exec(trimmed);
      if (secondary) {
        letterChar = secondary[2];
      }
    }

    if (!letterChar || !/^[a-zA-Z]$/.test(letterChar)) return null;

    if (this.OBJECT_INTENT_GUARD.test(trimmed)) {
      return null;
    }

    const hasUpper = this.CASE_WORD.upper.test(trimmed);
    const hasLower = this.CASE_WORD.lower.test(trimmed);

    let caseResult: LetterCase;
    if (hasUpper && hasLower) {
      // Explicit request for both, e.g. "uppercase and lowercase letter A"
      caseResult = 'both';
    } else if (hasUpper) {
      caseResult = 'upper';
    } else if (hasLower) {
      caseResult = 'lower';
    } else {
      // No explicit case word ANYWHERE in the query -> fetch both cases.
      // Deliberately NOT inferring from the literal typed casing of the
      // letter itself ("letter A" vs "letter a") — only an explicit case
      // word (uppercase/capital/lowercase/small/etc.) narrows to one case.
      caseResult = 'both';
    }

    return {
      letter: letterChar.toUpperCase(),
      case: caseResult,
    };
  }
}