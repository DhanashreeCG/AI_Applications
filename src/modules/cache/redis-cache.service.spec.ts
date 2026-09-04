import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedisCacheService } from './redis-cache.service';

const mockRedisInstance = {
  status: 'ready',
  connect: jest.fn().mockResolvedValue(undefined),
  quit: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  scan: jest.fn(),
};

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => mockRedisInstance),
}));

describe('RedisCacheService', () => {
  let service: RedisCacheService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      switch (key) {
        case 'redis.enabled':
          return true;
        case 'redis.host':
          return 'localhost';
        case 'redis.port':
          return 6379;
        case 'redis.searchCacheTtlSeconds':
          return 300;
        case 'redis.assetMetadataCacheTtlSeconds':
          return 3600;
        default:
          return undefined;
      }
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRedisInstance.status = 'ready';
    mockRedisInstance.connect.mockResolvedValue(undefined);
    mockRedisInstance.get.mockResolvedValue(null);
    mockRedisInstance.set.mockResolvedValue('OK');
    mockRedisInstance.del.mockResolvedValue(1);
    mockRedisInstance.scan.mockResolvedValue(['0', []]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisCacheService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<RedisCacheService>(RedisCacheService);
    await service.onModuleInit();
  });

  it('should store and retrieve JSON cache values', async () => {
    mockRedisInstance.get.mockResolvedValue(JSON.stringify({ total: 1 }));

    await service.set('search:abc', { total: 1 }, 300);
    const value = await service.get<{ total: number }>('search:abc');

    expect(mockRedisInstance.set).toHaveBeenCalledWith(
      'search:abc',
      JSON.stringify({ total: 1 }),
      'EX',
      300,
    );
    expect(value).toEqual({ total: 1 });
  });

  it('should flush search cache keys by pattern', async () => {
    mockRedisInstance.scan.mockResolvedValueOnce(['0', ['search:1', 'search:2']]);
    mockRedisInstance.del.mockResolvedValue(1);

    const deleted = await service.flushSearchCache();

    expect(mockRedisInstance.scan).toHaveBeenCalledWith(
      '0',
      'MATCH',
      'search:*',
      'COUNT',
      100,
    );
    expect(mockRedisInstance.del).toHaveBeenCalledWith('search:1');
    expect(mockRedisInstance.del).toHaveBeenCalledWith('search:2');
    expect(deleted).toBe(2);
  });

  it('should return null and not throw when get fails', async () => {
    mockRedisInstance.get.mockRejectedValue(new Error('connection reset'));

    await expect(service.get('search:abc')).resolves.toBeNull();
  });

  it('should swallow set failures', async () => {
    mockRedisInstance.set.mockRejectedValue(new Error('timeout'));

    await expect(service.set('search:abc', { total: 1 }, 300)).resolves.toBeUndefined();
  });

  it('should stay available after a failed startup connect for later reconnect', async () => {
    mockRedisInstance.connect.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    mockRedisInstance.status = 'wait';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisCacheService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    const recovering = module.get<RedisCacheService>(RedisCacheService);
    await recovering.onModuleInit();

    expect(recovering.isAvailable()).toBe(false);
    mockRedisInstance.status = 'ready';
    expect(recovering.isAvailable()).toBe(true);
  });
});
