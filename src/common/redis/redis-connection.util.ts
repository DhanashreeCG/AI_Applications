import Redis, { Cluster, RedisOptions } from 'ioredis';

export const DEFAULT_BULLMQ_PREFIX = 'asset-ingestion';

export function normalizeBullMqPrefix(prefix?: string): string {
  const value = (prefix || DEFAULT_BULLMQ_PREFIX).trim() || DEFAULT_BULLMQ_PREFIX;
  const tagged = value.match(/\{([^{}]+)\}/);
  if (tagged?.[1]) {
    return `{${tagged[1]}}`;
  }
  return `{${value}}`;
}

export interface RedisConnectionSettings {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db: number;
  tls: boolean;
  cluster: boolean;
}

export function readRedisConnectionSettings(config: {
  get<T>(key: string): T | undefined;
}): RedisConnectionSettings {
  return {
    host: config.get<string>('redis.host') || 'localhost',
    port: config.get<number>('redis.port') || 6379,
    username: config.get<string>('redis.username') || undefined,
    password: config.get<string>('redis.password') || undefined,
    db: config.get<number>('redis.db') ?? 0,
    tls: config.get<boolean>('redis.tls') === true,
    cluster: config.get<boolean>('redis.cluster') === true,
  };
}

export function createRedisConnection(
  settings: RedisConnectionSettings,
  extras: Pick<RedisOptions, 'maxRetriesPerRequest' | 'lazyConnect' | 'enableOfflineQueue' | 'retryStrategy' | 'connectTimeout' | 'keepAlive' | 'enableReadyCheck'> = {},
): Redis | Cluster {
  const redisOptions: RedisOptions = {
    username: settings.username || undefined,
    password: settings.password || undefined,
    enableReadyCheck: extras.enableReadyCheck ?? true,
    maxRetriesPerRequest: extras.maxRetriesPerRequest,
    lazyConnect: extras.lazyConnect,
    enableOfflineQueue: extras.enableOfflineQueue,
    connectTimeout: extras.connectTimeout,
    keepAlive: extras.keepAlive,
    retryStrategy: extras.retryStrategy,
  };

  if (settings.tls) {
    redisOptions.tls = {};
  }

  if (settings.cluster) {
    return new Redis.Cluster(
      [{ host: settings.host, port: settings.port }],
      {
        dnsLookup: (address, callback) => callback(null, address),
        slotsRefreshTimeout: 10_000,
        redisOptions: {
          ...redisOptions,
          // Cluster mode does not support logical DBs.
        },
      },
    );
  }

  return new Redis({
    ...redisOptions,
    host: settings.host,
    port: settings.port,
    db: settings.db,
  });
}

export function isRedisCluster(client: Redis | Cluster): client is Cluster {
  return typeof (client as Cluster).nodes === 'function';
}
