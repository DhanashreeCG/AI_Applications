import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  S3StorageService,
  sanitizeS3ObjectMetadata,
  sanitizeUploadFilename,
} from './s3-storage.service';

describe('S3StorageService', () => {
  let service: S3StorageService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      switch (key) {
        case 'aws.region':
          return 'us-east-1';
        case 'aws.s3BucketName':
          return 'test-bucket';
        case 'aws.accessKeyId':
          return 'test-key';
        case 'aws.secretAccessKey':
          return 'test-secret';
        default:
          return null;
      }
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        S3StorageService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<S3StorageService>(S3StorageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should generate canonical object key correctly', () => {
    const key = service.generateCanonicalKey('asset-123', 'my image file.png');
    expect(key).toBe('assets/asset-123/original/my_image_file.png');
  });

  it('sanitizes upload filenames the same way worksheet templates do', () => {
    expect(sanitizeUploadFilename('My Photo (1).jpg', 'fallback.jpg')).toBe(
      'My_Photo__1_.jpg',
    );
  });

  it('strips non-ascii S3 metadata that would break SigV4', () => {
    const sanitized = sanitizeS3ObjectMetadata({
      originalname: 'café photo.png',
      flashcardSetId: 'cmsykcmp2001c55nr5jjcd4lu',
    });
    expect(sanitized?.flashcardSetId).toBe('cmsykcmp2001c55nr5jjcd4lu');
    expect(sanitized?.originalname).toMatch(/^[\x20-\x7E]+$/);
  });
});
