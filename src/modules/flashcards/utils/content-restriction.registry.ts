import {
  CONTENT_RESTRICTION_GLOBAL_COUNTRY,
  DEFAULT_CONTENT_RESTRICTIONS,
  type ContentRestrictionRecord,
} from '../constants/content-restriction.defaults';

export interface CompiledCountryRestrictions {
  countryCode: string;
  bannedTerms: string[];
  restrictedTerms: string[];
  allTerms: string[];
  bannedRegex: RegExp | null;
  allRegex: RegExp | null;
}

const DEFAULT_INPUT_RATIO = 0.2;

let records: ContentRestrictionRecord[] = [...DEFAULT_CONTENT_RESTRICTIONS];
const compileCache = new Map<string, CompiledCountryRestrictions>();

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function uniqueSorted(terms: string[]): string[] {
  return [...new Set(terms.map((t) => t.trim().toLowerCase()).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
}

function buildTermRegex(terms: string[]): RegExp | null {
  if (terms.length === 0) return null;
  return new RegExp(`\\b(${terms.map(escapeRegExp).join('|')})\\b`, 'gi');
}

function inputRatioThreshold(): number {
  const raw = Number.parseFloat(process.env.CONTENT_RESTRICTION_INPUT_RATIO || '');
  if (Number.isFinite(raw) && raw > 0 && raw <= 1) {
    return raw;
  }
  return DEFAULT_INPUT_RATIO;
}

export function normalizeCountryCode(countryCode?: string | null): string | undefined {
  const trimmed = countryCode?.trim().toUpperCase();
  if (!trimmed || trimmed === CONTENT_RESTRICTION_GLOBAL_COUNTRY) {
    return undefined;
  }
  return trimmed;
}

function hydrateCountryCode(countryCode: string | undefined): string {
  const raw = (countryCode || CONTENT_RESTRICTION_GLOBAL_COUNTRY).trim();
  const upper = raw.toUpperCase();
  return upper === CONTENT_RESTRICTION_GLOBAL_COUNTRY
    ? CONTENT_RESTRICTION_GLOBAL_COUNTRY
    : upper;
}

export function hydrateContentRestrictions(rows: ContentRestrictionRecord[]): void {
  records = rows
    .filter((row) => row.active !== false)
    .map((row) => ({
      ...row,
      term: row.term.trim().toLowerCase(),
      countryCode: hydrateCountryCode(row.countryCode),
    }));
  compileCache.clear();
}

export function resetContentRestrictionsToDefaults(): void {
  hydrateContentRestrictions(DEFAULT_CONTENT_RESTRICTIONS);
}

export function getCompiledRestrictions(
  countryCode?: string | null,
): CompiledCountryRestrictions {
  const normalized = normalizeCountryCode(countryCode);
  const cacheKey = normalized ?? CONTENT_RESTRICTION_GLOBAL_COUNTRY;
  const cached = compileCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const applicable = records.filter(
    (row) =>
      row.countryCode === CONTENT_RESTRICTION_GLOBAL_COUNTRY ||
      (normalized !== undefined && row.countryCode === normalized),
  );

  const bannedTerms = uniqueSorted(
    applicable.filter((row) => row.severity === 'BANNED').map((row) => row.term),
  );
  const restrictedTerms = uniqueSorted(
    applicable.filter((row) => row.severity === 'RESTRICTED').map((row) => row.term),
  );
  const allTerms = uniqueSorted([...bannedTerms, ...restrictedTerms]);

  const compiled: CompiledCountryRestrictions = {
    countryCode: cacheKey,
    bannedTerms,
    restrictedTerms,
    allTerms,
    bannedRegex: buildTermRegex(bannedTerms),
    allRegex: buildTermRegex(allTerms),
  };
  compileCache.set(cacheKey, compiled);
  return compiled;
}

function firstRegexMatch(regex: RegExp | null, text: string): string | undefined {
  if (!regex || !text) return undefined;
  regex.lastIndex = 0;
  const match = regex.exec(text);
  return match?.[1]?.toLowerCase();
}

/** Returns the matched forbidden/restricted term if present, else undefined. */
export function containsForbiddenContent(
  text: string,
  countryCode?: string | null,
): string | undefined {
  if (!text) return undefined;
  const compiled = getCompiledRestrictions(countryCode);
  return firstRegexMatch(compiled.allRegex, text);
}

export function containsBannedContent(
  text: string,
  countryCode?: string | null,
): string | undefined {
  if (!text) return undefined;
  const compiled = getCompiledRestrictions(countryCode);
  return firstRegexMatch(compiled.bannedRegex, text);
}

/**
 * Ratio-based input guard: reject when banned terms make up a large share of
 * the request, including long queries (no word-count bypass).
 */
export function topicIsPrimarilyForbidden(
  text: string,
  countryCode?: string | null,
): string | undefined {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return undefined;

  const compiled = getCompiledRestrictions(countryCode);
  if (!compiled.bannedRegex) return undefined;

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0) return undefined;

  let hitCount = 0;
  let firstMatch: string | undefined;
  for (const word of words) {
    const cleaned = word.replace(/^[^a-z0-9']+|[^a-z0-9']+$/gi, '');
    if (!cleaned) continue;
    compiled.bannedRegex.lastIndex = 0;
    const match = compiled.bannedRegex.exec(cleaned);
    if (match) {
      hitCount += 1;
      firstMatch ??= match[1].toLowerCase();
    }
  }

  compiled.bannedRegex.lastIndex = 0;
  const fullMatch = compiled.bannedRegex.exec(normalized);
  if (fullMatch) {
    firstMatch ??= fullMatch[1].toLowerCase();
  }

  if (!firstMatch) return undefined;

  const ratio = hitCount / words.length;
  if (ratio >= inputRatioThreshold() || hitCount >= 2) {
    return firstMatch;
  }

  if (compiled.bannedTerms.length > 0) {
    const aboutPattern = new RegExp(
      `\\b(?:about|on|regarding|named|called)\\s+(?:the\\s+)?(?:${compiled.bannedTerms.map(escapeRegExp).join('|')})\\b`,
      'i',
    );
    const aboutMatch = aboutPattern.exec(normalized);
    if (aboutMatch) {
      return firstMatch;
    }
  }

  const compact = normalized.replace(/\s+/g, '');
  if (firstMatch.length / Math.max(compact.length, 1) >= 0.35) {
    return firstMatch;
  }

  return undefined;
}

export function buildCountryForbiddenPromptClause(
  countryCode?: string | null,
): string {
  const compiled = getCompiledRestrictions(countryCode);
  const regionLabel = normalizeCountryCode(countryCode)
    ? `this learner's country (${normalizeCountryCode(countryCode)})`
    : 'all regions';
  const bannedList =
    compiled.bannedTerms.length > 0
      ? compiled.bannedTerms.join(', ')
      : '(none configured)';
  const restrictedList =
    compiled.restrictedTerms.length > 0
      ? compiled.restrictedTerms.join(', ')
      : '(none configured)';

  return [
    `- STRICTLY FORBIDDEN CONTENT (${regionLabel}): never generate, name, describe, or depict any of the following in any field, no matter what the topic/query is.`,
    `  BANNED (hard block): ${bannedList}.`,
    `  RESTRICTED (skip for this region): ${restrictedList}.`,
    '- If the broader requested topic would normally include a banned or restricted item, silently skip only that item and continue generating the rest of the legitimate topic — do not mention the exclusion in the output, and do not replace it with another banned or restricted substitute.',
  ].join('\n');
}

export function getAllForbiddenTerms(countryCode?: string | null): string[] {
  return getCompiledRestrictions(countryCode).allTerms;
}
