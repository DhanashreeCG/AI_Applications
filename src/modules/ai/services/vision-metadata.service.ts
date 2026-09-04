import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssetMetadata, AssetState } from '@generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { S3StorageService } from '../../storage/s3-storage.service';
import { ImageProcessorService } from '../../image/image-processor.service';
import { GeminiVisionProvider } from '../providers/gemini-vision.provider';
import { mapVisionAnalysisToAssetMetadata } from '../utils/vision-metadata.mapper';
import { AiUsageService } from './ai-usage.service';
import { AssetState as PipelineAssetState } from '../../../common/enums/asset-state.enum';

export interface GenerateVisionMetadataOptions {
  promptVersion?: string;
  /** When true (default), return existing metadata without calling Gemini. */
  skipIfExists?: boolean;
  retryCount?: number;
  /** When true, pass the source filename into the vision prompt. */
  readFileNames?: boolean;
  filename?: string;
}

@Injectable()
export class VisionMetadataService {
  private readonly logger = new Logger(VisionMetadataService.name);
  private readonly geminiUnitCost: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: S3StorageService,
    private readonly imageProcessor: ImageProcessorService,
    private readonly visionProvider: GeminiVisionProvider,
    private readonly aiUsage: AiUsageService,
    configService: ConfigService,
  ) {
    this.geminiUnitCost =
      configService.get<number>('ai.costGeminiPerImageUsd') ?? 0.001;
  }

  public async generateAndSaveForAsset(
    assetId: string,
    options: GenerateVisionMetadataOptions = {},
  ): Promise<AssetMetadata> {
    const skipIfExists = options.skipIfExists ?? true;

    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      include: {
        metadata: true,
        sources: { take: 1, select: { filename: true } },
        ingestionFiles: { take: 1, select: { filename: true } },
      },
    });

    if (!asset) {
      throw new NotFoundException(`Asset ${assetId} not found`);
    }

    if (skipIfExists && asset.metadata) {
      this.logger.log(
        `Skipping Gemini for asset ${assetId}; metadata already exists (v${asset.metadata.metadataVersion})`,
      );
      await this.aiUsage.record({
        assetId,
        stage: PipelineAssetState.GENERATING_METADATA,
        provider: this.visionProvider.providerName,
        model: this.visionProvider.modelName,
        startedAt: new Date(),
        completedAt: new Date(),
        latencyMs: 0,
        status: 'skipped',
        retryCount: options.retryCount ?? 0,
      });
      return asset.metadata;
    }

    this.logger.log(`Generating vision metadata for asset ${assetId}`);

    const startedAt = new Date();
    try {
      const originalBuffer = await this.storage.downloadBuffer(
        asset.s3ObjectKey,
        asset.s3Bucket,
      );
      const optimized =
        await this.imageProcessor.generateAiOptimizedRepresentation(
          originalBuffer,
        );

      const filename = options.readFileNames
        ? options.filename ||
          asset.sources[0]?.filename ||
          asset.ingestionFiles[0]?.filename
        : undefined;

      const analysis = await this.visionProvider.analyzeImage({
        imageBuffer: optimized.buffer,
        mimeType: optimized.mimeType,
        promptVersion: options.promptVersion,
        ...(filename ? { filename } : {}),
      });

      const usage = this.visionProvider.getLastUsage();
      await this.aiUsage.record({
        assetId,
        stage: PipelineAssetState.GENERATING_METADATA,
        provider: analysis.provider,
        model: analysis.model,
        requestId: usage?.requestId,
        startedAt,
        completedAt: new Date(),
        latencyMs: usage?.latencyMs ?? Date.now() - startedAt.getTime(),
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        totalTokens: usage?.totalTokens,
        estimatedCost: this.geminiUnitCost,
        status: 'success',
        retryCount: options.retryCount ?? 0,
      });

      const searchDescriptionHash = await this.imageProcessor.calculateSha256(
        Buffer.from(analysis.searchDescription, 'utf8'),
      );

      const metadataFields = mapVisionAnalysisToAssetMetadata(
        analysis,
        searchDescriptionHash,
      );
      const metadataVersion = asset.metadata
        ? asset.metadata.metadataVersion + 1
        : 1;

      const savedMetadata = await this.prisma.$transaction(async (tx) => {
        const metadata = await tx.assetMetadata.upsert({
          where: { assetId },
          create: {
            asset: { connect: { id: assetId } },
            ...metadataFields,
            metadataVersion: 1,
          },
          update: {
            ...metadataFields,
            metadataVersion,
          },
        });

        await tx.asset.update({
          where: { id: assetId },
          data: { status: AssetState.METADATA_GENERATED },
        });

        return metadata;
      });

      this.logger.log(
        `Saved vision metadata v${savedMetadata.metadataVersion} for asset ${assetId}`,
      );

      return savedMetadata;
    } catch (error) {
      const usage = this.visionProvider.getLastUsage();
      await this.aiUsage.record({
        assetId,
        stage: PipelineAssetState.GENERATING_METADATA,
        provider: this.visionProvider.providerName,
        model: this.visionProvider.modelName,
        requestId: usage?.requestId,
        startedAt,
        completedAt: new Date(),
        latencyMs: usage?.latencyMs ?? Date.now() - startedAt.getTime(),
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        totalTokens: usage?.totalTokens,
        status: 'failed',
        retryCount: options.retryCount ?? 0,
        errorType:
          error instanceof Error ? error.name || error.message : 'UnknownError',
      });
      throw error;
    }
  }
}
