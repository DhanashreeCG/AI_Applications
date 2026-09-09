export type TranslationProduct = 'flashcards' | 'worksheets';

export interface TranslationOptions {
  /** Canonical source language BCP-47 code. Defaults to `en`. */
  sourceLanguage?: string;
  /** When false, skip Redis fragment cache reads/writes. */
  useCache?: boolean;
  /**
   * Product tag for logging / future metering. Auth is shared service-account.
   * flashcards → POST /flashcards/translate
   * worksheets → POST /worksheets/translate
   */
  product?: TranslationProduct;
}

export interface TranslationProvider {
  isReady(product?: TranslationProduct): boolean;
  translateTexts(
    texts: string[],
    targetLanguage: string,
    sourceLanguage: string,
    mimeType?: 'text/plain' | 'text/html',
    product?: TranslationProduct,
  ): Promise<string[]>;
}

export const TRANSLATION_PROVIDER = Symbol('TRANSLATION_PROVIDER');

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface ExtractedTextRef {
  /** Index into the deduplicated text list. */
  textIndex: number;
  /** Dot/bracket path for debugging. */
  path: string;
}

export interface ExtractionResult {
  /** Deep-cloned content with placeholders replaced later via refs. */
  clone: JsonValue;
  /** Deduplicated source strings in extraction order (text/plain). */
  uniqueTexts: string[];
  /** Every location that should receive uniqueTexts[textIndex] translation. */
  refs: Array<{ pathSegments: Array<string | number>; textIndex: number }>;
  /** Optional pre-rendered HTML document to translate with text/html mime. */
  html?: string;
}
