import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3StorageService } from '../../../storage/s3-storage.service';
import {
  FlashcardRenderStorageBackend,
  FlashcardRenderStorageBackendType,
  SaveRenderFileInput,
  StoredRenderFile,
} from './flashcard-render-storage.interface';
import { LocalFlashcardRenderStorage } from './local-flashcard-render.storage';
import { S3FlashcardRenderStorage } from './s3-flashcard-render.storage';

@Injectable()
export class FlashcardStorageService {
  private readonly backend: FlashcardRenderStorageBackend;

  constructor(
    configService: ConfigService,
    s3StorageService: S3StorageService,
  ) {
    const backendType = this.resolveBackendType(configService);
    this.backend =
      backendType === 's3'
        ? new S3FlashcardRenderStorage(configService, s3StorageService)
        : new LocalFlashcardRenderStorage(configService);
  }

  getBackendType(): FlashcardRenderStorageBackendType {
    return this.backend.type;
  }

  resolveOutputLocation(requestId: string): string {
    return this.backend.resolveOutputLocation(requestId);
  }

  async saveFile(input: SaveRenderFileInput): Promise<StoredRenderFile> {
    return this.backend.saveFile(input);
  }

  private resolveBackendType(
    configService: ConfigService,
  ): FlashcardRenderStorageBackendType {
    const configured = (
      configService.get<string>('flashcards.renderer.storageBackend') ?? 'local'
    )
      .trim()
      .toLowerCase();

    if (configured === 's3') {
      return 's3';
    }

    return 'local';
  }
}
