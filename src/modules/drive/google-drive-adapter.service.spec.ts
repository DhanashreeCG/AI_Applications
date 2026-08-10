import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GoogleDriveAdapterService } from './google-drive-adapter.service';

describe('GoogleDriveAdapterService', () => {
  let service: GoogleDriveAdapterService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      switch (key) {
        case 'googleDrive.clientEmail':
          return 'test@project.iam.gserviceaccount.com';
        case 'googleDrive.privateKey':
          return '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----';
        default:
          return null;
      }
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleDriveAdapterService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<GoogleDriveAdapterService>(GoogleDriveAdapterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should list files recursively using mock drive client', async () => {
    const mockDriveClient: any = {
      files: {
        list: jest.fn().mockResolvedValue({
          data: {
            files: [
              {
                id: 'file-1',
                name: 'elephant.png',
                mimeType: 'image/png',
                size: '1024',
                createdTime: '2026-07-29T00:00:00Z',
              },
            ],
            nextPageToken: null,
          },
        }),
      },
    };

    service.setDriveClient(mockDriveClient);

    const items = await service.listFilesInFolderRecursive('folder-root');
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('file-1');
    expect(items[0].name).toBe('elephant.png');
    expect(items[0].mimeType).toBe('image/png');
  });
});
