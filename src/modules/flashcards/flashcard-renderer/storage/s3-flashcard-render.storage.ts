import { ConfigService } from '@nestjs/config';
import { S3StorageService } from '../../../storage/s3-storage.service';
import {
  FlashcardRenderStorageBackend,
  SaveRenderFileInput,
  StoredRenderFile,
} from './flashcard-render-storage.interface';

export class S3FlashcardRenderStorage implements FlashcardRenderStorageBackend {
  readonly type = 's3' as const;
  private readonly keyPrefix: string;
  private readonly bucket?: string;
  private readonly signedUrlTtlSeconds: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly s3StorageService: S3StorageService,
  ) {
    this.keyPrefix =
      this.configService.get<string>('flashcards.renderer.s3KeyPrefix') ??
      'flashcards';
    this.bucket =
      this.configService.get<string>('flashcards.renderer.s3Bucket') || undefined;
    this.signedUrlTtlSeconds =
      this.configService.get<number>('flashcards.renderer.signedUrlTtlSeconds') ??
      3600;
  }

  resolveOutputLocation(requestId: string): string {
    return `${this.keyPrefix}/${requestId}`;
  }

  async saveFile(input: SaveRenderFileInput): Promise<StoredRenderFile> {
    const key = `${this.resolveOutputLocation(input.requestId)}/${input.fileName}`;
    const upload = await this.s3StorageService.uploadFile(input.buffer, {
      bucket: this.bucket,
      key,
      contentType: input.contentType,
      metadata: {
        requestId: input.requestId,
        fileName: input.fileName,
      },
    });

    const uri = await this.s3StorageService.getSignedUrl(
      key,
      this.signedUrlTtlSeconds,
      upload.bucket,
    );

    return {
      fileName: input.fileName,
      path: key,
      uri,
    };
  }

  async readFile(path: string): Promise<Buffer> {
    return this.s3StorageService.downloadBuffer(path, this.bucket);
  }
}
