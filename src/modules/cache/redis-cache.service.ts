import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { Cluster } from 'ioredis';
import {
  createRedisConnection,
  isRedisCluster,
  readRedisConnectionSettings,
} from '../../common/redis/redis-connection.util';
import {
  ASSET_METADATA_CACHE_PATTERN,
  SEARCH_CACHE_PATTERN,
} from './utils/cache-key.util';

const MAX_RECONNECT_ATTEMPTS = 20;
const CONNECT_TIMEOUT_MS = 10_000;
const SCAN_COUNT = 100;

@Injectable()
export class RedisCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private client: Redis | Cluster | null = null;
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

    const settings = readRedisConnectionSettings(this.configService);
    this.client = createRedisConnection(settings, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      enableOfflineQueue: false,
      connectTimeout: CONNECT_TIMEOUT_MS,
      keepAlive: 10_000,
      retryStrategy: (times) => {
        if (times > MAX_RECONNECT_ATTEMPTS) {
          this.logger.error(
            `Redis reconnect abandoned after ${MAX_RECONNECT_ATTEMPTS} attempts`,
          );
          return null;
        }
        return Math.min(times * 200, 2000);
      },
    });

    this.client.on('error', (error) => {
      this.logger.warn(`Redis error: ${error.message}`);
    });
    this.client.on('ready', () => {
      this.logger.log(
        `Redis cache ready at ${settings.host}:${settings.port}${settings.cluster ? ' (cluster)' : ''}`,
      );
    });
    this.client.on('end', () => {
      this.logger.warn('Redis connection closed');
    });

    try {
      await this.ensureConnected();
    } catch (error) {
      this.logger.warn(
        `Redis unavailable at startup, continuing without cache: ${this.toErrorMessage(error)}`,
      );
    }
  }

  private async ensureConnected(): Promise<void> {
    if (!this.client || this.client.status === 'ready') {
      return;
    }

    const alreadyOpen =
      this.client.status === 'connecting' || this.client.status === 'connect';

    if (!alreadyOpen && (this.client.status === 'wait' || this.client.status === 'end')) {
      try {
        await this.client.connect();
        return;
      } catch (error) {
        const message = this.toErrorMessage(error);
        if (!/already connecting|already connected/i.test(message)) {
          throw error;
        }
      }
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.client?.off('ready', onReady);
        if (this.client?.status === 'ready') {
          resolve();
          return;
        }
        reject(
          new Error(`Redis connect timed out (status=${this.client?.status})`),
        );
      }, CONNECT_TIMEOUT_MS);

      const onReady = () => {
        clearTimeout(timer);
        resolve();
      };

      this.client!.once('ready', onReady);
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      await this.client.quit();
    } catch (error) {
      this.logger.warn(
        `Redis quit failed, forcing disconnect: ${this.toErrorMessage(error)}`,
      );
      this.client.disconnect();
    } finally {
      this.client = null;
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
    if (!this.isAvailable() || !this.client) {
      return null;
    }

    try {
      const value = await this.client.get(key);
      if (!value) {
        return null;
      }

      try {
        return JSON.parse(value) as T;
      } catch {
        await this.client.del(key).catch(() => undefined);
        this.logger.warn(`Dropped corrupt cache key: ${key}`);
        return null;
      }
    } catch (error) {
      this.logger.warn(`Redis get failed for ${key}: ${this.toErrorMessage(error)}`);
      return null;
    }
  }

  public async set<T>(
    key: string,
    value: T,
    ttlSeconds: number,
  ): Promise<void> {
    if (!this.isAvailable() || !this.client || ttlSeconds <= 0) {
      return;
    }

    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(`Redis set failed for ${key}: ${this.toErrorMessage(error)}`);
    }
  }

  public async delete(key: string): Promise<void> {
    if (!this.isAvailable() || !this.client) {
      return;
    }

    try {
      await this.client.del(key);
    } catch (error) {
      this.logger.warn(`Redis delete failed for ${key}: ${this.toErrorMessage(error)}`);
    }
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
    if (!this.isAvailable() || !this.client) {
      return 0;
    }

    try {
      const nodes = isRedisCluster(this.client)
        ? this.client.nodes('master')
        : [this.client];

      let deleted = 0;
      for (const node of nodes) {
        deleted += await this.scanAndDelete(node, pattern);
      }
      return deleted;
    } catch (error) {
      this.logger.warn(
        `Redis flush failed for ${pattern}: ${this.toErrorMessage(error)}`,
      );
      return 0;
    }
  }

  private async scanAndDelete(
    node: Redis,
    pattern: string,
  ): Promise<number> {
    let cursor = '0';
    let deleted = 0;

    do {
      const [nextCursor, keys] = await node.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        SCAN_COUNT,
      );
      cursor = nextCursor;

      // Delete one key at a time so cluster mode never issues CROSSSLOT DEL.
      for (const key of keys) {
        deleted += await node.del(key);
      }
    } while (cursor !== '0' && this.isAvailable());

    return deleted;
  }

  private toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
