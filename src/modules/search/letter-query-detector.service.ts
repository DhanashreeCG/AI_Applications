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

  // Secondary anchor — case word directly adjacent to a single letter.
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

    let match = this.PRIMARY_ANCHOR.exec(trimmed);
    const matchedViaPrimary = !!match;

    if (!match) {
      match = this.SECONDARY_ANCHOR.exec(trimmed);
      if (match) {
        match = [match[0], match[2]] as unknown as RegExpExecArray;
      }
    }

    if (!match) return null;

    const letterChar = match[1];
    if (!letterChar || !/^[a-zA-Z]$/.test(letterChar)) return null;

    if (this.OBJECT_INTENT_GUARD.test(trimmed)) {
      return null;
    }

    let caseResult: LetterCase;
    if (this.CASE_WORD.upper.test(trimmed)) {
      caseResult = 'upper';
    } else if (this.CASE_WORD.lower.test(trimmed)) {
      caseResult = 'lower';
    } else if (matchedViaPrimary) {
      caseResult = letterChar === letterChar.toUpperCase() ? 'upper' : 'lower';
    } else {
      caseResult = 'both';
    }

    return {
      letter: letterChar.toUpperCase(),
      case: caseResult,
    };
  }
}
