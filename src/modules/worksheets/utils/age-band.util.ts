import { GRADE_TO_AGE_BAND } from '../constants/worksheet-template-taxonomy.constants';
import { GenerateWorksheetRequest } from '../types/worksheet.types';

export interface AgeBand {
  min: number;
  max: number;
  source: 'age' | 'ageGroup' | 'grade';
}

/**
 * Resolve request age into an inclusive [min, max] band.
 * Prefer point `age`, then full `ageGroup` range (both digits), then grade→band.
 */
export function resolveAgeBand(request: GenerateWorksheetRequest): AgeBand | null {
  if (typeof request.age === 'number' && Number.isFinite(request.age)) {
    return { min: request.age, max: request.age, source: 'age' };
  }

  const group = request.ageGroup?.trim();
  if (group) {
    const parsed = parseAgeGroupRange(group);
    if (parsed) {
      return { ...parsed, source: 'ageGroup' };
    }
  }

  const grade = request.grade?.trim().toLowerCase();
  if (grade) {
    const fromGrade = GRADE_TO_AGE_BAND[grade];
    if (fromGrade) {
      return { min: fromGrade.min, max: fromGrade.max, source: 'grade' };
    }
    // Loose "grade N" / "class N" fallback for 1–3
    const gradeNum = grade.match(/(?:grade|class|std)\s*(\d)/i)?.[1];
    if (gradeNum) {
      const key = `grade${gradeNum}`;
      const mapped = GRADE_TO_AGE_BAND[key];
      if (mapped) {
        return { min: mapped.min, max: mapped.max, source: 'grade' };
      }
    }
  }

  return null;
}

/** Parse `"4-5"`, `"2 – 3"`, `"ages 4 to 5"` into both endpoints (not first-digit only). */
export function parseAgeGroupRange(raw: string): { min: number; max: number } | null {
  const numbers = [...raw.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  if (!numbers.length) {
    return null;
  }
  if (numbers.length === 1) {
    return { min: numbers[0], max: numbers[0] };
  }
  const min = Math.min(numbers[0], numbers[1]);
  const max = Math.max(numbers[0], numbers[1]);
  return { min, max };
}

/** Inclusive overlap: templateAgeMin <= reqMax AND templateAgeMax >= reqMin */
export function ageBandsOverlap(
  templateMin: number,
  templateMax: number,
  reqMin: number,
  reqMax: number,
): boolean {
  return templateMin <= reqMax && templateMax >= reqMin;
}

export function templateHasAgeMeta(
  ageMin: number | undefined | null,
  ageMax: number | undefined | null,
): boolean {
  return (
    typeof ageMin === 'number' &&
    Number.isFinite(ageMin) &&
    typeof ageMax === 'number' &&
    Number.isFinite(ageMax)
  );
}

/** Returns inclusive age endpoints when both are finite numbers. */
export function readTemplateAgeRange(meta: {
  ageMin?: number | null;
  ageMax?: number | null;
}): { min: number; max: number } | null {
  if (!templateHasAgeMeta(meta.ageMin, meta.ageMax)) {
    return null;
  }
  return { min: meta.ageMin as number, max: meta.ageMax as number };
}
