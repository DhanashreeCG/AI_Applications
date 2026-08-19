import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { SearchService } from '../../search/search.service';
import type { SearchAssetsResponse } from '../../search/interfaces/search-result.interface';
import {
  S3StorageService,
  sanitizeUploadFilename,
} from '../../storage/s3-storage.service';
import { PrismaService } from '../../database/prisma.service';
import {
  PIPELINE_STAGES,
  PipelineTelemetryContext,
} from '../../../common/events/pipeline-tracker.events';
import {
  mapWithConcurrency,
  WORKSHEET_IMAGE_SEARCH_EMBEDDING_PURPOSE,
  WORKSHEET_TEMPLATE_IMAGE_MAX_BYTES,
  WORKSHEET_TEMPLATE_IMAGE_MIME_TYPES,
} from '../constants/worksheet.constants';
import { WorksheetException } from '../errors/worksheet.exception';
import {
  ResolvedAssetSlot,
  ResolvedAssetUrl,
} from '../types/worksheet.types';
import {
  collectImageQueries,
  normalizeImageQueryFields,
  patchImageSlot,
  setUserUploadedImageIndex,
  setValueAtPath,
  stripTransientAssetFields,
} from '../utils/structure.util';
import {
  WorksheetPipelineEmitter,
  hashPayload,
} from '../telemetry/worksheet-pipeline.events';

@Injectable()
export class WorksheetAssetService {
  private readonly logger = new Logger(WorksheetAssetService.name);
  private readonly concurrency: number;
  private readonly searchLimit: number;
  private readonly pickerLimit: number;
  private readonly signedUrlTtlSeconds: number;
  private readonly assetImagePath: string;
  private readonly userUploadS3Prefix: string;
  private readonly emitter: WorksheetPipelineEmitter;

  constructor(
    private readonly searchService: SearchService,
    private readonly s3StorageService: S3StorageService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    eventEmitter: EventEmitter2,
  ) {
    this.concurrency =
      this.configService.get<number>('worksheets.imageConcurrency') ?? 3;
    this.searchLimit =
      this.configService.get<number>('worksheets.imageSearchLimit') ?? 1;
    this.pickerLimit =
      this.configService.get<number>('worksheets.imagePickerLimit') ?? 10;
    this.signedUrlTtlSeconds =
      this.configService.get<number>('worksheets.signedUrlTtlSeconds') ?? 3600;
    this.assetImagePath = (
      this.configService.get<string>('worksheets.assetImagePath') ??
      '/worksheets/assets'
    ).replace(/\/$/, '');
    this.userUploadS3Prefix = (
      this.configService.get<string>('worksheets.userUploadS3Prefix') ??
      'worksheets/uploads'
    ).replace(/\/$/, '');
    this.emitter = new WorksheetPipelineEmitter(eventEmitter);
  }

  public persistableStructure(
    structure: Record<string, unknown>,
  ): Record<string, unknown> {
    return stripTransientAssetFields(structure);
  }

  public async attachAssets(
    structure: Record<string, unknown>,
    options?: { grades?: string[]; ageGroups?: string[] },
    telemetry?: PipelineTelemetryContext,
  ): Promise<{ structure: Record<string, unknown>; slots: ResolvedAssetSlot[] }> {
    const normalized = normalizeImageQueryFields(structure);
    const queries = collectImageQueries(normalized);
    this.logger.log(
      `image search start slots=${queries.length} ${JSON.stringify(
        queries.map((item) => ({ path: item.parentPath, query: item.query })),
      )}`,
    );
    const uniqueParents = new Map<string, { path: string; query: string }>();
    for (const item of queries) {
      uniqueParents.set(item.parentPath, {
        path: item.parentPath,
        query: item.query,
      });
    }

    const slots = await mapWithConcurrency(
      [...uniqueParents.values()],
      this.concurrency,
      async (item) => this.resolveSlot(item.query, item.path, options, telemetry),
    );

    let next = normalized;
    for (const slot of slots) {
      next = this.applySlot(next, slot);
    }

    return { structure: this.persistableStructure(next), slots };
  }

  public applySlot(
    structure: Record<string, unknown>,
    slot: ResolvedAssetSlot,
  ): Record<string, unknown> {
    if (!slot.assetId) {
      return this.persistableStructure(structure);
    }
    if (slot.path === '') {
      return this.persistableStructure({ ...structure, assetId: slot.assetId });
    }
    return this.persistableStructure(
      setValueAtPath(structure, `${slot.path}.assetId`, slot.assetId),
    );
  }

  public async resolveSlot(
    imageQuery: string,
    path: string,
    options?: { grades?: string[]; ageGroups?: string[] },
    telemetry?: PipelineTelemetryContext,
  ): Promise<ResolvedAssetSlot> {
    const query = imageQuery.trim();
    if (!query) {
      return this.emptySlot(path, query);
    }

    const searchId = randomUUID();
    const startedAt = Date.now();
    const filters = {
      grades: options?.grades?.filter(Boolean),
      ageGroups: options?.ageGroups?.filter(Boolean),
    };
    const hasFilters = Boolean(filters.grades?.length || filters.ageGroups?.length);

    if (telemetry) {
      this.emitter.emitImageSearchStarted({
        ...telemetry,
        searchId,
        stageName: PIPELINE_STAGES.IMAGE_RETRIEVAL,
        query,
        filters: hasFilters ? filters : undefined,
      });
    }

    this.logger.log(
      `image search query path=${path || '(root)'} description="${query}"`,
    );

    try {
      let response = await this.searchService.search({
        query,
        limit: this.searchLimit,
        filters: hasFilters ? filters : undefined,
      });
      this.emitEmbeddingUsage(telemetry, query, response);
      this.logger.log(
        `image search embedding+vector path=${path || '(root)'} query="${query}" hits=${response.results.length} cache=${response.fromCache === true} topAssetId=${response.results[0]?.assetId ?? 'none'}`,
      );

      if (!response.results.length && hasFilters) {
        this.logger.warn(
          `No filtered asset for "${query}" at ${path}; retrying without grade/age filters`,
        );
        response = await this.searchService.search({
          query,
          limit: this.searchLimit,
        });
        this.emitEmbeddingUsage(telemetry, query, response);
      }

      const hit = response.results[0];
      const slot: ResolvedAssetSlot = hit
        ? { path, imageQuery: query, assetId: hit.assetId }
        : this.emptySlot(path, query);

      if (!slot.assetId) {
        this.logger.warn(`No asset found for imageQuery "${query}" at ${path}`);
      } else {
        this.logger.log(
          `image search resolved path=${path || '(root)'} assetId=${slot.assetId} url=${this.assetProxyUrl(slot.assetId)}`,
        );
      }

      if (telemetry) {
        this.emitter.emitImageSearchCompleted({
          ...telemetry,
          searchId,
          stageName: PIPELINE_STAGES.IMAGE_RETRIEVAL,
          query,
          filters: hasFilters ? filters : undefined,
          resultCount: response.results.length,
          selectedAssetId: slot.assetId,
          cacheHit: response.fromCache === true,
          failed: false,
          durationMs: Date.now() - startedAt,
        });
      }
      return slot;
    } catch (error) {
      this.logger.warn(
        `Asset search failed for imageQuery "${query}" at ${path}`,
      );
      if (telemetry) {
        this.emitter.emitImageSearchCompleted({
          ...telemetry,
          searchId,
          stageName: PIPELINE_STAGES.IMAGE_RETRIEVAL,
          query,
          filters: hasFilters ? filters : undefined,
          resultCount: 0,
          selectedAssetId: null,
          failed: true,
          errorMessage: 'Asset search failed',
          durationMs: Date.now() - startedAt,
        });
      }
      return this.emptySlot(path, query);
    }
  }

  public assetProxyUrl(assetId: string): string {
    return `${this.assetImagePath}/${assetId}/image`;
  }

  public async resolveAsset(assetId: string): Promise<ResolvedAssetUrl> {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: { id: true, s3ObjectKey: true, s3Bucket: true },
    });
    if (!asset) {
      throw new WorksheetException(
        'ASSET_NOT_FOUND',
        `Asset "${assetId}" was not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    let signedUrl: string | null = null;
    if (asset.s3ObjectKey) {
      try {
        signedUrl = await this.s3StorageService.getSignedUrl(
          asset.s3ObjectKey,
          this.signedUrlTtlSeconds,
          asset.s3Bucket,
        );
      } catch {
        this.logger.warn(`Signed URL failed for worksheet asset ${asset.id}`);
      }
    }

    return {
      assetId: asset.id,
      imageUrl: this.assetProxyUrl(asset.id),
      signedUrl,
    };
  }

  public enrichForRender(
    structure: Record<string, unknown>,
  ): Record<string, unknown> {
    const walk = (value: unknown): unknown => {
      if (Array.isArray(value)) {
        return value.map((item) => walk(item));
      }
      if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const next: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(record)) {
          if ((['imageUrl', 'assetUrl', 'signedUrl'] as string[]).includes(key)) {
            continue;
          }
          next[key] = walk(child);
        }
        if (typeof record.assetId === 'string' && record.assetId.trim()) {
          next.assetUrl = this.assetProxyUrl(record.assetId);
        } else if (
          typeof record.userUploadedKey === 'string' &&
          record.userUploadedKey.trim()
        ) {
          const parsed = this.parseUserUploadKey(record.userUploadedKey);
          if (parsed) {
            next.assetUrl = this.userUploadProxyUrl(
              parsed.worksheetId,
              parsed.uploadId,
            );
          }
        }
        return next;
      }
      return value;
    };
    return walk(normalizeImageQueryFields(structure)) as Record<string, unknown>;
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
      imageUrl: this.assetProxyUrl(hit.assetId),
    }));
  }

  public applyLibraryImage(
    structure: Record<string, unknown>,
    path: string,
    assetId: string,
  ): Record<string, unknown> {
    const withSlot = patchImageSlot(structure, path, {
      assetId,
      userUploadedKey: '',
    });
    return this.persistableStructure(
      setUserUploadedImageIndex(withSlot, path, null),
    );
  }

  public applyUserUploadedImage(
    structure: Record<string, unknown>,
    path: string,
    upload: { key: string; contentType?: string },
  ): Record<string, unknown> {
    const withSlot = patchImageSlot(structure, path, {
      assetId: null,
      userUploadedKey: upload.key,
    });
    return this.persistableStructure(
      setUserUploadedImageIndex(withSlot, path, {
        key: upload.key,
        contentType: upload.contentType,
      }),
    );
  }

  public userUploadProxyUrl(worksheetId: string, uploadId: string): string {
    return `/worksheets/${worksheetId}/uploads/${uploadId}/image`;
  }

  public parseUserUploadKey(
    key: string,
  ): { worksheetId: string; uploadId: string } | null {
    const prefix = `${this.userUploadS3Prefix}/`;
    if (!key.startsWith(prefix)) {
      return null;
    }
    const rest = key.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash <= 0 || slash === rest.length - 1) {
      return null;
    }
    const worksheetId = rest.slice(0, slash);
    const uploadId = rest.slice(slash + 1);
    if (!/^[A-Za-z0-9._-]+$/.test(uploadId)) {
      return null;
    }
    return { worksheetId, uploadId };
  }

  public async uploadUserImage(
    worksheetId: string,
    file: { buffer: Buffer; mimetype?: string; originalname?: string; size?: number },
  ): Promise<{ key: string; uploadId: string; imageUrl: string; contentType: string }> {
    const contentType = (file.mimetype || '').toLowerCase();
    if (!WORKSHEET_TEMPLATE_IMAGE_MIME_TYPES.has(contentType)) {
      throw new WorksheetException(
        'INVALID_REQUEST',
        'Upload a JPEG, PNG, WebP, or GIF image',
        HttpStatus.BAD_REQUEST,
      );
    }
    if ((file.size ?? file.buffer.length) > WORKSHEET_TEMPLATE_IMAGE_MAX_BYTES) {
      throw new WorksheetException(
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
    const key = `${this.userUploadS3Prefix}/${worksheetId}/${uploadId}`;
    await this.s3StorageService.uploadFile(file.buffer, {
      key,
      contentType,
      metadata: {
        worksheetId,
        originalname: sanitizeUploadFilename(file.originalname, uploadId),
      },
    });
    return {
      key,
      uploadId,
      imageUrl: this.userUploadProxyUrl(worksheetId, uploadId),
      contentType,
    };
  }

  public async loadUserUpload(
    worksheetId: string,
    uploadId: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    if (!/^[A-Za-z0-9._-]+$/.test(uploadId)) {
      throw new WorksheetException(
        'INVALID_REQUEST',
        'Invalid upload id',
        HttpStatus.BAD_REQUEST,
      );
    }
    const key = `${this.userUploadS3Prefix}/${worksheetId}/${uploadId}`;
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
      throw new WorksheetException(
        'ASSET_NOT_FOUND',
        'Uploaded image was not found',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private emptySlot(path: string, imageQuery: string): ResolvedAssetSlot {
    return {
      path,
      imageQuery,
      assetId: null,
    };
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
      purpose: WORKSHEET_IMAGE_SEARCH_EMBEDDING_PURPOSE,
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
