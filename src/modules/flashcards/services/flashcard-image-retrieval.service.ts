import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { getErrorMessage } from '../../../common/utils/error-message';
import {
  PIPELINE_STAGES,
  PipelineTelemetryContext,
} from '../../../common/events/pipeline-tracker.events';
import { SearchService } from '../../search/search.service';
import type {
  SearchAssetsResponse,
  SearchResultItem,
} from '../../search/interfaces/search-result.interface';
import {
  S3StorageService,
  sanitizeUploadFilename,
} from '../../storage/s3-storage.service';
import { PrismaService } from '../../database/prisma.service';
import {
  DEFAULT_IMAGE_CONCURRENCY,
  DEFAULT_IMAGE_SEARCH_LIMIT,
  DEFAULT_SIGNED_URL_TTL_SECONDS,
  FLASHCARD_ASSET_IMAGE_PATH,
  FLASHCARD_IMAGE_SEARCH_EMBEDDING_PURPOSE,
  FLASHCARD_USER_UPLOAD_MAX_BYTES,
  FLASHCARD_USER_UPLOAD_MIME_TYPES,
} from '../constants/flashcard.constants';
import { FlashcardException } from '../errors/flashcard.exception';
import {
  AssetReference,
  ImageRetrievalStatus,
  ImageSearchQuery,
} from '../interfaces/flashcard.interfaces';
import {
  hitSubjectKeys,
  isLetterGlyphSubject,
  primaryImageSubject,
} from '../utils/distinct-image-subjects.util';
import {
  FlashcardPipelineEmitter,
  hashPayload,
} from '../telemetry/flashcard-pipeline.events';

interface RetrieveImagesInput {
  queries: Array<ImageSearchQuery | string>;
  topic?: string;
  ageMin: number | null;
  ageMax: number | null;
  usedAssetIds?: Set<string>;
  usedObjectKeys?: Set<string>;
}

@Injectable()
export class FlashcardImageRetrievalService {
  private readonly logger = new Logger(FlashcardImageRetrievalService.name);
  private readonly concurrency: number;
  private readonly signedUrlTtlSeconds: number;
  private readonly searchLimit: number;
  private readonly pickerLimit: number;
  private readonly userUploadS3Prefix: string;
  private readonly emitter: FlashcardPipelineEmitter;
  private pickLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly searchService: SearchService,
    private readonly s3StorageService: S3StorageService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    eventEmitter: EventEmitter2,
  ) {
    this.concurrency =
      this.configService.get<number>('flashcards.imageConcurrency') ??
      DEFAULT_IMAGE_CONCURRENCY;
    this.signedUrlTtlSeconds =
      this.configService.get<number>('flashcards.signedUrlTtlSeconds') ??
      DEFAULT_SIGNED_URL_TTL_SECONDS;
    this.searchLimit =
      this.configService.get<number>('flashcards.imageSearchLimit') ??
      DEFAULT_IMAGE_SEARCH_LIMIT;
    this.pickerLimit =
      this.configService.get<number>('flashcards.imagePickerLimit') ?? 10;
    this.userUploadS3Prefix = (
      this.configService.get<string>('flashcards.userUploadS3Prefix') ??
      'flashcards/uploads'
    ).replace(/\/$/, '');
    this.emitter = new FlashcardPipelineEmitter(eventEmitter);
  }

  public getConcurrency(): number {
    return this.concurrency;
  }

  public async retrieveForCard(
    input: RetrieveImagesInput,
    telemetry?: PipelineTelemetryContext,
  ): Promise<AssetReference> {
    const primary = this.normalizeQuery(input.queries[0]);
    const cascade = this.buildCascadeQueries(primary, input.topic);
    const attempts: string[] = [];

    if (!cascade.length) {
      return this.emptyReference('', attempts, 'IMAGE_NOT_FOUND');
    }

    for (let index = 0; index < cascade.length; index += 1) {
      const attempt = cascade[index];
      attempts.push(attempt.label);
      const hit = await this.searchOnce(
        attempt.query,
        input,
        telemetry,
        attempts,
        index === cascade.length - 1,
      );
      if (hit) {
        return hit;
      }
    }

    return this.emptyReference(
      cascade[0]?.query ?? '',
      attempts,
      'IMAGE_NOT_FOUND',
    );
  }

  public async mapWithConcurrency<T, R>(
    items: T[],
    mapper: (item: T, index: number) => Promise<R>,
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let nextIndex = 0;

    const workers = Array.from(
      { length: Math.min(this.concurrency, items.length) },
      async () => {
        while (nextIndex < items.length) {
          const current = nextIndex;
          nextIndex += 1;
          results[current] = await mapper(items[current], current);
        }
      },
    );

    await Promise.all(workers);
    return results;
  }

  private normalizeQuery(
    raw: ImageSearchQuery | string | undefined,
  ): ImageSearchQuery | null {
    if (!raw) return null;
    if (typeof raw === 'string') {
      const searchQuery = raw.trim();
      if (!searchQuery) return null;
      return { searchQuery, expectedObjects: [] };
    }
    if (!raw.searchQuery?.trim()) return null;
    return raw;
  }

  /**
   * Search priority when the primary LLM query misses:
   * primary semantic → enriched → expected object → object name → topic
   */
  private buildCascadeQueries(
    primary: ImageSearchQuery | null,
    topic?: string,
  ): Array<{ label: string; query: string }> {
    const cascade: Array<{ label: string; query: string }> = [];
    const seen = new Set<string>();

    const push = (label: string, query: string | undefined) => {
      const trimmed = query?.trim();
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      cascade.push({ label, query: trimmed });
    };

    if (primary) {
      push('semantic', primary.searchQuery);

      const enriched = [
        primary.searchQuery,
        primary.preferredStyle,
        primary.preferredBackground
          ? `${primary.preferredBackground} background`
          : undefined,
      ]
        .filter(Boolean)
        .join(' ');
      push('semantic_enriched', enriched);

      if (primary.expectedObjects.length) {
        push('expected_objects', primary.expectedObjects.join(' '));
        push('object_name', primary.expectedObjects[0]);
      }
    }

    push('topic', topic);
    push('unfiltered', primary?.expectedObjects[0] || primary?.searchQuery);

    return cascade;
  }

  private async searchOnce(
    query: string,
    input: RetrieveImagesInput,
    telemetry: PipelineTelemetryContext | undefined,
    attempts: string[],
    allowReuse: boolean,
  ): Promise<AssetReference | null> {
    const searchId = randomUUID();
    const startedAt = Date.now();

    if (telemetry) {
      this.emitter.emitImageSearchStarted({
        ...telemetry,
        searchId,
        stageName: PIPELINE_STAGES.IMAGE_RETRIEVAL,
        query,
      });
    }

    try {
      const response = await this.searchService.search({
        query,
        limit: this.searchLimit,
      });

      this.emitEmbeddingUsage(telemetry, query, response);

      const querySubject = primaryImageSubject(input.queries[0]);
      const candidate = await this.claimHit(
        response.results,
        input,
        querySubject,
        allowReuse,
      );

      if (!candidate) {
        if (telemetry) {
          this.emitter.emitImageSearchCompleted({
            ...telemetry,
            searchId,
            stageName: PIPELINE_STAGES.IMAGE_RETRIEVAL,
            query,
            resultCount: response.results.length,
            selectedAssetId: null,
            cacheHit: response.fromCache === true,
            failed: false,
            durationMs: Date.now() - startedAt,
          });
        }
        return null;
      }

      let signedUrl: string | null = null;
      try {
        signedUrl = await this.s3StorageService.getSignedUrl(
          candidate.s3ObjectKey,
          this.signedUrlTtlSeconds,
        );
      } catch (error) {
        this.logger.warn(
          `Signed URL failed for ${candidate.assetId}: ${getErrorMessage(error)}`,
        );
      }

      if (telemetry) {
        this.emitter.emitImageSearchCompleted({
          ...telemetry,
          searchId,
          stageName: PIPELINE_STAGES.IMAGE_RETRIEVAL,
          query,
          resultCount: response.results.length,
          selectedAssetId: candidate.assetId,
          cacheHit: response.fromCache === true,
          failed: false,
          durationMs: Date.now() - startedAt,
        });
      }

      return {
        assetId: candidate.assetId,
        s3ObjectKey: candidate.s3ObjectKey,
        signedUrl,
        imageUrl: `${FLASHCARD_ASSET_IMAGE_PATH}/${candidate.assetId}/image`,
        userUploadedKey: null,
        caption: candidate.caption,
        similarity: candidate.similarity,
        mimeType: candidate.mimeType,
        status: 'found',
        queryUsed: query,
        attempts: [...attempts],
      };
    } catch (error) {
      const message = getErrorMessage(error);
      this.logger.warn(`Image search failed for "${query}": ${message}`);
      if (telemetry) {
        this.emitter.emitImageSearchCompleted({
          ...telemetry,
          searchId,
          stageName: PIPELINE_STAGES.IMAGE_RETRIEVAL,
          query,
          resultCount: 0,
          selectedAssetId: null,
          failed: true,
          errorMessage: message,
          durationMs: Date.now() - startedAt,
        });
      }
      return null;
    }
  }

  private emptyReference(
    queryUsed: string,
    attempts: string[],
    status: ImageRetrievalStatus,
  ): AssetReference {
    return {
      assetId: null,
      s3ObjectKey: null,
      signedUrl: null,
      imageUrl: null,
      userUploadedKey: null,
      caption: null,
      similarity: null,
      mimeType: null,
      status,
      queryUsed,
      attempts,
    };
  }

  /**
   * Claim the best unused hit. Concurrent card searches wait on pickLock so two
   * cards cannot take the same asset or object type. Reuse is allowed only on
   * the last cascade attempt so a card is not left blank.
   */
  private claimHit(
    results: SearchResultItem[],
    input: RetrieveImagesInput,
    querySubject: string,
    allowReuse: boolean,
  ): Promise<SearchResultItem | null> {
    const run = this.pickLock.then(() => {
      const candidate = this.selectTopSimilarityHit(
        results,
        input.usedAssetIds,
        input.usedObjectKeys,
        allowReuse,
      );
      if (!candidate) {
        return null;
      }
      input.usedAssetIds?.add(candidate.assetId);
      this.markUsedSubjects(input.usedObjectKeys, candidate, querySubject);
      return candidate;
    });
    this.pickLock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private markUsedSubjects(
    usedObjectKeys: Set<string> | undefined,
    hit: SearchResultItem,
    querySubject: string,
  ): void {
    if (!usedObjectKeys) {
      return;
    }
    if (querySubject && !isLetterGlyphSubject(querySubject)) {
      usedObjectKeys.add(querySubject);
    }
    for (const key of hitSubjectKeys(hit)) {
      usedObjectKeys.add(key);
    }
  }

  private selectTopSimilarityHit(
    results: SearchResultItem[],
    usedAssetIds: Set<string> | undefined,
    usedObjectKeys: Set<string> | undefined,
    allowReuse: boolean,
  ): SearchResultItem | null {
    if (!results.length) {
      return null;
    }

    const ranked = [...results].sort(
      (left, right) => (right.similarity ?? 0) - (left.similarity ?? 0),
    );

    const unused = ranked.find(
      (item) =>
        !usedAssetIds?.has(item.assetId) &&
        !this.isSameImageType(item, usedObjectKeys),
    );
    if (unused) {
      return unused;
    }

    return allowReuse ? ranked[0] : null;
  }

  private isSameImageType(
    hit: SearchResultItem,
    usedObjectKeys: Set<string> | undefined,
  ): boolean {
    if (!usedObjectKeys?.size) {
      return false;
    }
    return hitSubjectKeys(hit).some((key) => usedObjectKeys.has(key));
  }

  public async searchCandidates(
    query: string,
    limit?: number,
  ): Promise<
    Array<{
      assetId: string;
      caption: string;
      searchDescription: string;
      imageUrl: string;
    }>
  > {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }
    const response = await this.searchService.search({
      query: trimmed,
      limit: limit ?? this.pickerLimit,
    });
    return response.results.map((hit) => ({
      assetId: hit.assetId,
      caption: hit.caption,
      searchDescription: hit.searchDescription,
      imageUrl: `${FLASHCARD_ASSET_IMAGE_PATH}/${hit.assetId}/image`,
    }));
  }

  public async resolveLibraryAsset(
    assetId: string,
    queryUsed = '',
  ): Promise<AssetReference> {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: {
        id: true,
        s3ObjectKey: true,
        mimeType: true,
        metadata: { select: { caption: true } },
      },
    });
    if (!asset) {
      throw new FlashcardException(
        'INVALID_REQUEST',
        `Asset "${assetId}" was not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      assetId: asset.id,
      s3ObjectKey: asset.s3ObjectKey,
      signedUrl: null,
      imageUrl: `${FLASHCARD_ASSET_IMAGE_PATH}/${asset.id}/image`,
      userUploadedKey: null,
      caption: asset.metadata?.caption ?? null,
      similarity: null,
      mimeType: asset.mimeType,
      status: 'found',
      queryUsed,
      attempts: [],
    };
  }

  public userUploadProxyUrl(flashcardSetId: string, uploadId: string): string {
    return `/flashcards/${flashcardSetId}/uploads/${uploadId}/image`;
  }

  public applyUserUploadedImage(
    previous: AssetReference | null | undefined,
    upload: { key: string; imageUrl: string; contentType: string },
  ): AssetReference {
    return {
      assetId: null,
      s3ObjectKey: upload.key,
      signedUrl: null,
      imageUrl: upload.imageUrl,
      userUploadedKey: upload.key,
      caption: previous?.caption ?? 'User uploaded image',
      similarity: null,
      mimeType: upload.contentType,
      status: 'found',
      queryUsed: previous?.queryUsed ?? '',
      attempts: previous?.attempts ?? [],
    };
  }

  public async uploadUserImage(
    flashcardSetId: string,
    file: { buffer: Buffer; mimetype?: string; originalname?: string; size?: number },
  ): Promise<{ key: string; uploadId: string; imageUrl: string; contentType: string }> {
    const contentType = (file.mimetype || '').toLowerCase();
    if (!FLASHCARD_USER_UPLOAD_MIME_TYPES.has(contentType)) {
      throw new FlashcardException(
        'INVALID_REQUEST',
        'Upload a JPEG, PNG, WebP, or GIF image',
        HttpStatus.BAD_REQUEST,
      );
    }
    if ((file.size ?? file.buffer.length) > FLASHCARD_USER_UPLOAD_MAX_BYTES) {
      throw new FlashcardException(
        'INVALID_REQUEST',
        'Image is too large',
        HttpStatus.BAD_REQUEST,
      );
    }
    const ext =
      contentType === 'image/png'
        ? '.png'
        : contentType === 'image/webp'
          ? '.webp'
          : contentType === 'image/gif'
            ? '.gif'
            : '.jpg';
    const uploadId = `${randomUUID()}${ext}`;
    const key = `${this.userUploadS3Prefix}/${flashcardSetId}/${uploadId}`;
    await this.s3StorageService.uploadFile(file.buffer, {
      key,
      contentType,
      metadata: {
        flashcardSetId,
        originalname: sanitizeUploadFilename(file.originalname, uploadId),
      },
    });
    return {
      key,
      uploadId,
      imageUrl: this.userUploadProxyUrl(flashcardSetId, uploadId),
      contentType,
    };
  }

  public async loadUserUpload(
    flashcardSetId: string,
    uploadId: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    if (!/^[A-Za-z0-9._-]+$/.test(uploadId)) {
      throw new FlashcardException(
        'INVALID_REQUEST',
        'Invalid upload id',
        HttpStatus.BAD_REQUEST,
      );
    }
    const key = `${this.userUploadS3Prefix}/${flashcardSetId}/${uploadId}`;
    try {
      const buffer = await this.s3StorageService.downloadBuffer(key);
      const mimeType = uploadId.endsWith('.png')
        ? 'image/png'
        : uploadId.endsWith('.webp')
          ? 'image/webp'
          : uploadId.endsWith('.gif')
            ? 'image/gif'
            : 'image/jpeg';
      return { buffer, mimeType };
    } catch {
      throw new FlashcardException(
        'INVALID_REQUEST',
        'Uploaded image was not found',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private emitEmbeddingUsage(
    telemetry: PipelineTelemetryContext | undefined,
    query: string,
    response: SearchAssetsResponse,
  ): void {
    if (!telemetry || !response.usage || response.usage.fromCache) {
      return;
    }

    const invocationId = randomUUID();
    const model = response.usage.model || 'text-embedding-3-small';
    this.emitter.emitAiStarted({
      ...telemetry,
      invocationId,
      stageName: PIPELINE_STAGES.IMAGE_RETRIEVAL,
      provider: 'openai',
      model,
      purpose: FLASHCARD_IMAGE_SEARCH_EMBEDDING_PURPOSE,
      promptHash: hashPayload(query),
    });
    this.emitter.emitAiCompleted({
      ...telemetry,
      invocationId,
      stageName: PIPELINE_STAGES.IMAGE_RETRIEVAL,
      status: 'success',
      inputTokens: response.usage.inputTokens,
      totalTokens: response.usage.totalTokens,
      durationMs: response.usage.latencyMs,
    });
  }
}
