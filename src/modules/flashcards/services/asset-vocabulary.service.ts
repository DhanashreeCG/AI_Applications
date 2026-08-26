import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { DEFAULT_IMAGE_QUERY_VOCABULARY_LIMIT } from '../constants/flashcard.constants';

/**
 * Provides a compact vocabulary summary from the asset database for the
 * image query refinement prompt. Cached in memory with a configurable TTL
 * so the DB query runs at most once every few minutes, not per request.
 *
 * The vocabulary tells the intent-extraction LLM what canonical terminology
 * exists in the library (e.g. "cartoon ant insect" vs "bug illustration"),
 * but it must NEVER be used to substitute concepts — the flashcard_fixes.md
 * rules forbid overfitting to available assets.
 */
export interface AssetVocabulary {
  /** Top N distinct primary objects (first entry of `objects` array). */
  objects: string[];
  /** Distinct art styles found in the library. */
  styles: string[];
  /** Total asset count for context. */
  totalAssets: number;
}

@Injectable()
export class AssetVocabularyService {
  private readonly logger = new Logger(AssetVocabularyService.name);
  private readonly enabled: boolean;
  private readonly limit: number;
  private readonly cacheTtlMs = 10 * 60 * 1000; // 10 minutes

  private cachedVocabulary: AssetVocabulary | null = null;
  private cacheExpiresAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.enabled =
      this.configService.get<boolean>(
        'flashcards.imageQueryRefinement.assetVocabularyEnabled',
      ) === true;
    this.limit =
      this.configService.get<number>(
        'flashcards.imageQueryRefinement.assetVocabularyLimit',
      ) ?? DEFAULT_IMAGE_QUERY_VOCABULARY_LIMIT;
  }

  /**
   * Returns a compact text block suitable for prompt injection, or `undefined`
   * if asset vocabulary is disabled. Uses in-memory cache with 10-min TTL.
   */
  public async getVocabularyPromptBlock(): Promise<string | undefined> {
    if (!this.enabled) return undefined;

    const vocabulary = await this.loadVocabulary();
    if (!vocabulary || vocabulary.objects.length === 0) return undefined;

    const lines: string[] = [];
    lines.push(`Asset library contains ${vocabulary.totalAssets} images.`);

    if (vocabulary.objects.length > 0) {
      lines.push('');
      lines.push('Known objects (canonical terms):');
      lines.push(vocabulary.objects.join(', '));
    }

    if (vocabulary.styles.length > 0) {
      lines.push('');
      lines.push('Known styles:');
      lines.push(vocabulary.styles.join(', '));
    }

    return lines.join('\n');
  }

  private async loadVocabulary(): Promise<AssetVocabulary | null> {
    if (this.cachedVocabulary && Date.now() < this.cacheExpiresAt) {
      return this.cachedVocabulary;
    }

    try {
      // Count total assets that have metadata
      const totalAssets = await this.prisma.assetMetadata.count();

      // Fetch distinct objects — take the first element from each asset's
      // `objects` array and aggregate the most common ones. Prisma doesn't
      // support array element access natively, so we fetch raw rows and
      // aggregate in JS. Limited to avoid pulling the whole table.
      const rows = await this.prisma.assetMetadata.findMany({
        select: { objects: true, styles: true },
        take: this.limit * 5, // overfetch to get good coverage
        orderBy: { createdAt: 'desc' },
      });

      // Count object frequency — primary object = first element
      const objectCounts = new Map<string, number>();
      const styleCounts = new Map<string, number>();

      for (const row of rows) {
        if (Array.isArray(row.objects)) {
          // Take only the first 2 objects per asset (most specific)
          for (const obj of row.objects.slice(0, 2)) {
            const key = obj.trim().toLowerCase();
            if (key && key.length > 1 && key.length < 50) {
              objectCounts.set(key, (objectCounts.get(key) ?? 0) + 1);
            }
          }
        }
        if (Array.isArray(row.styles)) {
          for (const style of row.styles) {
            const key = style.trim().toLowerCase();
            if (key && key.length > 1) {
              styleCounts.set(key, (styleCounts.get(key) ?? 0) + 1);
            }
          }
        }
      }

      // Sort by frequency, take top N
      const objects = [...objectCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, this.limit)
        .map(([key]) => key);

      const styles = [...styleCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([key]) => key);

      this.cachedVocabulary = { objects, styles, totalAssets };
      this.cacheExpiresAt = Date.now() + this.cacheTtlMs;

      this.logger.log(
        `Asset vocabulary loaded: ${objects.length} objects, ${styles.length} styles from ${totalAssets} assets`,
      );

      return this.cachedVocabulary;
    } catch (error) {
      this.logger.warn(
        `Failed to load asset vocabulary: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
