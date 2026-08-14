import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { ImageProcessorService } from '../../image/image-processor.service';
import { S3StorageService } from '../../storage/s3-storage.service';
import { WorksheetTemplateService } from './worksheet-template.service';
import { WorksheetException } from '../errors/worksheet.exception';

describe('WorksheetTemplateService.create', () => {
  const prisma = {
    asset: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    worksheetTemplate: {
      create: jest.fn(),
    },
  };
  const s3 = {
    generateCanonicalKey: jest.fn(
      (id: string, filename: string) => `assets/${id}/original/${filename}`,
    ),
    uploadFile: jest.fn(),
    getSignedUrl: jest.fn(),
  };
  const imageProcessor = {
    validateImage: jest.fn(),
    calculateSha256: jest.fn(),
  };
  const configService = {
    get: () => 3600,
  };

  let service: WorksheetTemplateService;

  const png = {
    buffer: Buffer.from('fake-png'),
    originalname: 'bg.png',
    mimetype: 'image/png',
    size: 8,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WorksheetTemplateService(
      prisma as unknown as PrismaService,
      s3 as unknown as S3StorageService,
      imageProcessor as unknown as ImageProcessorService,
      configService as unknown as ConfigService,
    );
    imageProcessor.validateImage.mockResolvedValue({
      isValid: true,
      mimeType: 'image/png',
      width: 100,
      height: 80,
    });
    imageProcessor.calculateSha256
      .mockResolvedValueOnce('hash-bg')
      .mockResolvedValueOnce('hash-sample');
    prisma.asset.findUnique.mockResolvedValue(null);
    s3.uploadFile.mockImplementation(async (_buf: Buffer, options: { key: string }) => ({
      bucket: 'ai-asset-ingestion',
      key: options.key,
    }));
    s3.getSignedUrl.mockResolvedValue('https://signed.example/img');
    prisma.asset.create
      .mockResolvedValueOnce({
        id: 'asset-bg',
        s3ObjectKey: 'assets/bg/original/bg.png',
        s3Bucket: 'ai-asset-ingestion',
      })
      .mockResolvedValueOnce({
        id: 'asset-sample',
        s3ObjectKey: 'assets/sample/original/sample.png',
        s3Bucket: 'ai-asset-ingestion',
      });
    prisma.worksheetTemplate.create.mockResolvedValue({
      id: 'tmpl-1',
      name: 'Counting Objects',
      slug: 'counting_objects_v1',
      category: 'numeracy',
      status: 'ACTIVE',
      version: 1,
      rendererType: 'generic',
    });
  });

  it('uploads background and sample images to S3 then persists the template', async () => {
    const result = await service.create(
      {
        name: 'Counting Objects',
        slug: 'counting_objects_v1',
        category: 'numeracy',
        templateHtml: '<h1>{{instruction}}</h1>',
        structureDefinition: {
          type: 'object',
          required: ['instruction'],
          properties: { instruction: { type: 'string' } },
        },
      },
      { background: png, sample: { ...png, originalname: 'sample.png' } },
    );

    expect(s3.uploadFile).toHaveBeenCalledTimes(2);
    expect(prisma.asset.create).toHaveBeenCalledTimes(2);
    expect(prisma.worksheetTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: 'counting_objects_v1',
          backgroundAssetId: 'asset-bg',
          sampleAssetId: 'asset-sample',
        }),
      }),
    );
    expect(result.backgroundAssetId).toBe('asset-bg');
    expect(result.sampleAssetId).toBe('asset-sample');
    expect(result.backgroundUrl).toBe('https://signed.example/img');
  });

  it('rejects create when background image is missing', async () => {
    await expect(
      service.create(
        {
          name: 'Counting',
          slug: 'counting_v1',
          category: 'numeracy',
          templateHtml: '<div></div>',
          structureDefinition: { type: 'object' },
        },
        { sample: png },
      ),
    ).rejects.toBeInstanceOf(WorksheetException);
    expect(s3.uploadFile).not.toHaveBeenCalled();
  });

  it('rejects invalid image bytes', async () => {
    imageProcessor.validateImage.mockResolvedValue({
      isValid: false,
      error: 'Corrupted',
    });

    await expect(
      service.create(
        {
          name: 'Counting',
          slug: 'counting_v1',
          category: 'numeracy',
          templateHtml: '<div></div>',
          structureDefinition: { type: 'object' },
        },
        { background: png, sample: png },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});
