import { HttpException, HttpStatus } from '@nestjs/common';
import {
  containsForbiddenContent,
  topicIsPrimarilyForbidden,
} from '../../modules/flashcards/utils/content-restriction.registry';

export function resolveRequestCountryCode(
  requested?: string | null,
  envDefault?: string | null,
): string | undefined {
  const fromRequest = requested?.trim().toUpperCase();
  if (fromRequest && /^[A-Z]{2}$/.test(fromRequest)) {
    return fromRequest;
  }
  const fromEnv = (envDefault || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(fromEnv) ? fromEnv : undefined;
}

export function throwContentNotAllowed(
  matchedTerm: string,
  field: string,
  countryCode?: string,
): never {
  throw new HttpException(
    {
      error: {
        code: 'CONTENT_NOT_ALLOWED',
        message: `Requested content is not allowed: "${matchedTerm}" (found in ${field}).`,
        details: { matchedTerm, field, countryCode: countryCode ?? null },
      },
    },
    HttpStatus.BAD_REQUEST,
  );
}

/** Any banned/restricted term in a user search string — used before embeddings. */
export function assertSearchQueryAllowed(
  query: string,
  countryCode?: string,
  field = 'query',
): void {
  if (!query?.trim()) return;
  const matched = containsForbiddenContent(query, countryCode);
  if (matched) {
    throwContentNotAllowed(matched, field, countryCode);
  }
}

/** Topic-centered generation guard — used before template/content LLMs. */
export function assertGenerationRequestAllowed(input: {
  query?: string;
  topic?: string;
  countryCode?: string;
}): void {
  const candidates: Array<{ field: string; value?: string }> = [
    { field: 'topic', value: input.topic },
    { field: 'query', value: input.query },
  ];
  for (const candidate of candidates) {
    if (!candidate.value) continue;
    const matched = topicIsPrimarilyForbidden(
      candidate.value,
      input.countryCode,
    );
    if (matched) {
      throwContentNotAllowed(matched, candidate.field, input.countryCode);
    }
  }
}
