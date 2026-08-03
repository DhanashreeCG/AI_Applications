import { HttpStatus, Injectable } from '@nestjs/common';
import { getErrorMessage } from '../../../common/utils/error-message';
import { PrismaService } from '../../database/prisma.service';
import { S3StorageService } from '../../storage/s3-storage.service';
import { FlashcardException } from '../errors/flashcard.exception';

export interface AssetImagePayload {
  buffer: Buffer;
  mimeType: string;
}

@Injectable()
export class AssetImageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3StorageService: S3StorageService,
  ) {}

  public async loadImage(assetId: string): Promise<AssetImagePayload> {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: { s3Bucket: true, s3ObjectKey: true, mimeType: true },
    });

    if (!asset) {
      throw new FlashcardException(
        'INVALID_REQUEST',
        `Asset ${assetId} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    try {
      const buffer = await this.s3StorageService.downloadBuffer(
        asset.s3ObjectKey,
        asset.s3Bucket,
      );
      return { buffer, mimeType: asset.mimeType };
    } catch (error) {
      throw new FlashcardException(
        'INVALID_REQUEST',
        `Asset ${assetId} could not be read from storage: ${getErrorMessage(error)}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
