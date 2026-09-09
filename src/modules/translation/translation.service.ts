import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisCacheService } from '../cache/redis-cache.service';
import { buildTranslationFragmentCacheKey } from '../cache/utils/cache-key.util';
import { TranslationException } from './errors/translation.exception';
import {
  TranslationOptions,
  TranslationProduct,
} from './interfaces/translation.interfaces';
import { GcpTranslationProvider } from './providers/gcp-translation.provider';
import {
  applyTranslations,
  chunkTextsForTranslation,
  extractTranslatableFields,
  isValidLanguageCode,
  normalizeLanguageCode,
} from './utils/translatable-fields.util';

const DEFAULT_SOURCE_LANGUAGE = 'en';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);

  constructor(
    private readonly provider: GcpTranslationProvider,
    private readonly configService: ConfigService,
    private readonly cache: RedisCacheService,
  ) {}

  /**
   * Translate user-facing text in flashcard/worksheet JSON via GCP Translation.
   * Auth prefers GOOGLE_TRANSLATION_API_KEY, else service-account credentials.
   * Never mutates the input object.
   */
  async translateContent(
    content: unknown,
    targetLanguage: string,
    options: TranslationOptions = {},
  ): Promise<unknown> {
    if (content === null || content === undefined) {
      throw new TranslationException(
        'INVALID_REQUEST',
        'content is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (typeof content !== 'object') {
      throw new TranslationException(
        'INVALID_REQUEST',
        'content must be a JSON object or array',
        HttpStatus.BAD_REQUEST,
      );
    }

    const enabled =
      this.configService.get<boolean>('translation.enabled') !== false;
    if (!enabled) {
      throw new TranslationException(
        'TRANSLATION_DISABLED',
        'Translation is disabled',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (!targetLanguage || typeof targetLanguage !== 'string') {
      throw new TranslationException(
        'INVALID_LANGUAGE',
        'language is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const product: TranslationProduct =
      options.product === 'worksheets' ? 'worksheets' : 'flashcards';

    const sourceLanguage = normalizeLanguageCode(
      options.sourceLanguage || DEFAULT_SOURCE_LANGUAGE,
    );
    const normalizedTarget = normalizeLanguageCode(targetLanguage);

    if (!isValidLanguageCode(normalizedTarget)) {
      throw new TranslationException(
        'INVALID_LANGUAGE',
        `Invalid target language: ${targetLanguage}`,
        HttpStatus.BAD_REQUEST,
        { language: targetLanguage },
      );
    }

    // English → English: no GCP call; return a deep clone for safety.
    if (
      normalizedTarget === sourceLanguage ||
      normalizedTarget === 'en' ||
      normalizedTarget.startsWith('en-')
    ) {
      return structuredClone(content);
    }

    const { clone, uniqueTexts, refs, html } =
      extractTranslatableFields(content);

    if (!uniqueTexts.length && !html) {
      return clone;
    }

    const useCache = options.useCache !== false;
    const translations = uniqueTexts.length
      ? await this.translateUniqueTexts(
          uniqueTexts,
          sourceLanguage,
          normalizedTarget,
          useCache,
          'text/plain',
          product,
        )
      : [];

    const translated = applyTranslations(clone, refs, translations);

    if (html && isRecord(translated)) {
      const [translatedHtml] = await this.translateUniqueTexts(
        [html],
        sourceLanguage,
        normalizedTarget,
        useCache,
        'text/html',
        product,
      );
      translated.html = translatedHtml;
    }

    return translated;
  }

  /**
   * Translates already-extracted unique strings with caching + chunking.
   * Uses GCP Cloud Translation (service-account auth).
   */
  async translateUniqueTexts(
    uniqueTexts: string[],
    sourceLanguage: string,
    targetLanguage: string,
    useCache = true,
    mimeType: 'text/plain' | 'text/html' = 'text/plain',
    product: TranslationProduct = 'flashcards',
  ): Promise<string[]> {
    const results: string[] = new Array(uniqueTexts.length);
    const missingIndexes: number[] = [];
    const missingTexts: string[] = [];

    for (let index = 0; index < uniqueTexts.length; index += 1) {
      const text = uniqueTexts[index];
      if (useCache) {
        const key = buildTranslationFragmentCacheKey(
          sourceLanguage,
          targetLanguage,
          text,
          mimeType,
        );
        const cached = await this.cache.get<string>(key);
        if (typeof cached === 'string') {
          results[index] = cached;
          continue;
        }
      }
      missingIndexes.push(index);
      missingTexts.push(text);
    }

    if (!missingTexts.length) {
      return results;
    }

    this.assertProviderReady(product);

    const maxBatchSize =
      this.configService.get<number>('translation.maxBatchSize') ?? 100;
    const maxBatchCodeUnits =
      this.configService.get<number>('translation.maxBatchCodeUnits') ?? 25_000;
    const batches = chunkTextsForTranslation(
      missingTexts,
      maxBatchSize,
      maxBatchCodeUnits,
    );

    let cursor = 0;
    try {
      for (const batch of batches) {
        const translatedBatch = await this.provider.translateTexts(
          batch,
          targetLanguage,
          sourceLanguage,
          mimeType,
          product,
        );
        if (translatedBatch.length !== batch.length) {
          throw new Error(
            `Batch size mismatch: expected ${batch.length}, got ${translatedBatch.length}`,
          );
        }

        for (let i = 0; i < batch.length; i += 1) {
          const originalIndex = missingIndexes[cursor + i];
          const translated = translatedBatch[i];
          results[originalIndex] = translated;

          if (useCache) {
            const key = buildTranslationFragmentCacheKey(
              sourceLanguage,
              targetLanguage,
              uniqueTexts[originalIndex],
              mimeType,
            );
            const ttl =
              this.configService.get<number>(
                'redis.translationCacheTtlSeconds',
              ) ?? 86_400;
            void this.cache.set(key, translated, ttl);
          }
        }
        cursor += batch.length;
      }
    } catch (error) {
      if (error instanceof TranslationException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Translation failed: ${message}`);
      throw new TranslationException(
        'TRANSLATION_FAILED',
        'Failed to translate content',
        HttpStatus.BAD_GATEWAY,
        { reason: message },
      );
    }

    return results;
  }

  private assertProviderReady(product: TranslationProduct): void {
    if (!this.provider.isReady(product)) {
      throw new TranslationException(
        'TRANSLATION_UNAVAILABLE',
        'Translation provider is not configured. Set GOOGLE_TRANSLATION_API_KEY (preferred) or GOOGLE_TRANSLATION_* / GOOGLE_DRIVE service-account credentials, and enable Cloud Translation API.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
