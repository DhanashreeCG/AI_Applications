import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AssetMetadata, AssetState } from '@generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { S3StorageService } from '../../storage/s3-storage.service';
import { ImageProcessorService } from '../../image/image-processor.service';
import { GeminiVisionProvider } from '../providers/gemini-vision.provider';
import { mapVisionAnalysisToAssetMetadata } from '../utils/vision-metadata.mapper';

export interface GenerateVisionMetadataOptions {
  promptVersion?: string;
}

@Injectable()
export class VisionMetadataService {
  private readonly logger = new Logger(VisionMetadataService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: S3StorageService,
    private readonly imageProcessor: ImageProcessorService,
    private readonly visionProvider: GeminiVisionProvider,
  ) {}

  public async generateAndSaveForAsset(
    assetId: string,
    options: GenerateVisionMetadataOptions = {},
  ): Promise<AssetMetadata> {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      include: { metadata: true },
    });

    if (!asset) {
      throw new NotFoundException(`Asset ${assetId} not found`);
    }

    this.logger.log(`Generating vision metadata for asset ${assetId}`);

    const originalBuffer = await this.storage.downloadBuffer(
      asset.s3ObjectKey,
      asset.s3Bucket,
    );
    const optimized = await this.imageProcessor.generateAiOptimizedRepresentation(
      originalBuffer,
    );

    const analysis = await this.visionProvider.analyzeImage({
      imageBuffer: optimized.buffer,
      mimeType: optimized.mimeType,
      promptVersion: options.promptVersion,
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
  }
}
