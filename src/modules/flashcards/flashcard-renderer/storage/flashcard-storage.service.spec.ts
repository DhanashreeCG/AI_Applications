import { ConfigService } from '@nestjs/config';
import { S3StorageService } from '../../../storage/s3-storage.service';
import { FlashcardStorageService } from './flashcard-storage.service';

describe('FlashcardStorageService', () => {
  const createService = (values: Record<string, string | undefined>) => {
    const configService = {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;

    const s3StorageService = {
      uploadFile: jest.fn(),
      getSignedUrl: jest.fn(),
    } as unknown as S3StorageService;

    return {
      service: new FlashcardStorageService(configService, s3StorageService),
      s3StorageService,
    };
  };

  it('uses local storage by default', () => {
    const { service } = createService({
      'flashcards.renderer.storageBackend': undefined,
      'flashcards.renderer.storageRoot': 'storage/flashcards',
    });

    expect(service.getBackendType()).toBe('local');
    expect(service.resolveOutputLocation('req-1')).toBe(
      'storage/flashcards/req-1',
    );
  });

  it('selects s3 storage when configured', () => {
    const { service } = createService({
      'flashcards.renderer.storageBackend': 's3',
      'flashcards.renderer.s3KeyPrefix': 'flashcards/rendered',
      'flashcards.renderer.signedUrlTtlSeconds': '3600',
    });

    expect(service.getBackendType()).toBe('s3');
    expect(service.resolveOutputLocation('req-2')).toBe(
      'flashcards/rendered/req-2',
    );
  });
});
