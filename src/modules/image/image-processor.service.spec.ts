import { Test, TestingModule } from '@nestjs/testing';
import { ImageProcessorService } from './image-processor.service';

describe('ImageProcessorService', () => {
  let service: ImageProcessorService;

  // 1x1 transparent GIF buffer
  const sampleGifBuffer = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64',
  );

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ImageProcessorService],
    }).compile();

    service = module.get<ImageProcessorService>(ImageProcessorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should calculate SHA-256 hash correctly for buffer', async () => {
    const hash = await service.calculateSha256(sampleGifBuffer);
    expect(hash).toBeDefined();
    expect(hash).toHaveLength(64);
  });

  it('should validate valid image buffer correctly', async () => {
    const result = await service.validateImage(sampleGifBuffer);
    expect(result.isValid).toBe(true);
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
    expect(result.orientation).toBe('square');
  });

  it('should detect corrupted or invalid image buffer', async () => {
    const invalidBuffer = Buffer.from('invalid-image-data-string');
    const result = await service.validateImage(invalidBuffer);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('Corrupted or invalid image');
  });

  it('should generate AI optimized representation', async () => {
    const optimized = await service.generateAiOptimizedRepresentation(
      sampleGifBuffer,
      1024,
    );
    expect(optimized.buffer).toBeDefined();
    expect(optimized.mimeType).toBe('image/jpeg');
  });
});
