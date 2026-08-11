import { Readable } from 'stream';
import { SAMPLE_GIF_BUFFER } from './fixtures/sample-image.fixture';
import {
  TEST_DRIVE_FILE,
  TEST_VISION_ANALYSIS,
} from './fixtures/pipeline-data.fixture';
import { buildTestEmbeddingResult } from './fixtures/embedding.fixture';

export class MockGoogleDriveAdapterService {
  public async listFilesInFolderRecursive(_folderId: string) {
    return [TEST_DRIVE_FILE];
  }

  public async downloadFileStream(_fileId: string) {
    return Readable.from(SAMPLE_GIF_BUFFER);
  }
}

export class MockS3StorageService {
  private readonly objects = new Map<string, Buffer>();

  public getDefaultBucket(): string {
    return 'test-ingestion-bucket';
  }

  public generateCanonicalKey(assetId: string, filename: string): string {
    return `assets/${assetId}/original/${filename}`;
  }

  public async uploadFile(
    buffer: Buffer,
    options: { key: string; bucket: string; contentType?: string },
  ): Promise<void> {
    this.objects.set(this.buildKey(options.bucket, options.key), buffer);
  }

  public async downloadBuffer(key: string, bucket: string): Promise<Buffer> {
    const stored = this.objects.get(this.buildKey(bucket, key));
    if (!stored) {
      throw new Error(`S3 object not found: ${bucket}/${key}`);
    }

    return stored;
  }

  public async fileExists(key: string, bucket: string): Promise<boolean> {
    return this.objects.has(this.buildKey(bucket, key));
  }

  private buildKey(bucket: string, key: string): string {
    return `${bucket}/${key}`;
  }
}

export class MockGeminiVisionProvider {
  public readonly providerName = 'gemini';
  public readonly modelName = 'gemini-2.5-flash';

  public async analyzeImage() {
    return TEST_VISION_ANALYSIS;
  }
}

export class MockOpenAiEmbeddingProvider {
  public readonly providerName = 'openai';
  public readonly modelName = 'text-embedding-3-small';
  public readonly dimensions = 1536;

  public async generateEmbedding(text: string) {
    return buildTestEmbeddingResult(text);
  }
}

export class MockRedisCacheService {
  private readonly store = new Map<string, unknown>();

  public async onModuleInit(): Promise<void> {
    return undefined;
  }

  public async onModuleDestroy(): Promise<void> {
    return undefined;
  }

  public async get<T>(key: string): Promise<T | null> {
    return (this.store.get(key) as T | undefined) ?? null;
  }

  public async set<T>(
    key: string,
    value: T,
    _ttlSeconds?: number,
  ): Promise<void> {
    this.store.set(key, value);
  }

  public getSearchCacheTtlSeconds(): number {
    return 300;
  }

  public getAssetMetadataCacheTtlSeconds(): number {
    return 3600;
  }

  public async flushSearchCache(): Promise<number> {
    return this.deleteByPrefix('search:');
  }

  public async flushAssetMetadataCache(): Promise<number> {
    return this.deleteByPrefix('asset-metadata:');
  }

  public reset(): void {
    this.store.clear();
  }

  private deleteByPrefix(prefix: string): number {
    let deleted = 0;

    for (const key of [...this.store.keys()]) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        deleted++;
      }
    }

    return deleted;
  }
}
