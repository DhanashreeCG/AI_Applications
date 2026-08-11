import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  ASSET_METADATA_CACHE_PATTERN,
  SEARCH_CACHE_PATTERN,
} from './utils/cache-key.util';

@Injectable()
export class RedisCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private client: Redis | null = null;
  private readonly enabled: boolean;
  private readonly searchCacheTtlSeconds: number;
  private readonly assetMetadataCacheTtlSeconds: number;

  constructor(private readonly configService: ConfigService) {
    this.enabled = this.configService.get<boolean>('redis.enabled') ?? true;
    this.searchCacheTtlSeconds =
      this.configService.get<number>('redis.searchCacheTtlSeconds') ?? 300;
    this.assetMetadataCacheTtlSeconds =
      this.configService.get<number>('redis.assetMetadataCacheTtlSeconds') ??
      3600;
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.warn('Redis caching is disabled by configuration');
      return;
    }

    const host = this.configService.get<string>('redis.host') || 'localhost';
    const port = this.configService.get<number>('redis.port') || 6379;
    const password = this.configService.get<string>('redis.password');

    this.client = new Redis({
      host,
      port,
      password: password || undefined,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });

    this.client.on('error', (error) => {
      this.logger.error(`Redis connection error: ${error.message}`);
    });

    try {
      await this.client.connect();
      this.logger.log(`Redis cache connected at ${host}:${port}`);
    } catch (error) {
      this.logger.warn(
        `Redis unavailable, continuing without cache: ${(error as Error).message}`,
      );
      await this.client.quit().catch(() => undefined);
      this.client = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.logger.log('Redis connection closed');
    }
  }

  public isAvailable(): boolean {
    return this.client?.status === 'ready';
  }

  public getSearchCacheTtlSeconds(): number {
    return this.searchCacheTtlSeconds;
  }

  public getAssetMetadataCacheTtlSeconds(): number {
    return this.assetMetadataCacheTtlSeconds;
  }

  public async get<T>(key: string): Promise<T | null> {
    if (!this.isAvailable()) {
      return null;
    }

    const value = await this.client!.get(key);
    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value) as T;
    } catch {
      await this.client!.del(key);
      return null;
    }
  }

  public async set<T>(
    key: string,
    value: T,
    ttlSeconds: number,
  ): Promise<void> {
    if (!this.isAvailable() || ttlSeconds <= 0) {
      return;
    }

    await this.client!.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  public async delete(key: string): Promise<void> {
    if (!this.isAvailable()) {
      return;
    }

    await this.client!.del(key);
  }

  public async flushSearchCache(): Promise<number> {
    return this.flushByPattern(SEARCH_CACHE_PATTERN);
  }

  public async flushAssetMetadataCache(): Promise<number> {
    return this.flushByPattern(ASSET_METADATA_CACHE_PATTERN);
  }

  public async flushAll(): Promise<number> {
    const searchDeleted = await this.flushSearchCache();
    const metadataDeleted = await this.flushAssetMetadataCache();
    return searchDeleted + metadataDeleted;
  }

  private async flushByPattern(pattern: string): Promise<number> {
    if (!this.isAvailable()) {
      return 0;
    }

    let cursor = '0';
    let deleted = 0;

    do {
      const [nextCursor, keys] = await this.client!.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = nextCursor;

      if (keys.length > 0) {
        deleted += await this.client!.del(...keys);
      }
    } while (cursor !== '0');

    return deleted;
  }
}
