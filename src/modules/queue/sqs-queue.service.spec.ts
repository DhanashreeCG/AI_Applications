import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { AssetState } from '../../common/enums/asset-state.enum';
import { SqsQueueService } from './sqs-queue.service';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn().mockImplementation(() => ({
    send: mockSend,
  })),
  SendMessageCommand: jest.fn().mockImplementation((input) => input),
  ReceiveMessageCommand: jest.fn().mockImplementation((input) => input),
  DeleteMessageCommand: jest.fn().mockImplementation((input) => input),
  GetQueueAttributesCommand: jest.fn().mockImplementation((input) => input),
  ChangeMessageVisibilityCommand: jest
    .fn()
    .mockImplementation((input) => input),
}));

describe('SqsQueueService', () => {
  let service: SqsQueueService;

  const queueUrls = {
    'aws.sqsIngestionQueueUrl': 'https://sqs.us-east-1.amazonaws.com/123/ingestion',
    'aws.sqsS3UploadQueueUrl': 'https://sqs.us-east-1.amazonaws.com/123/s3-upload',
    'aws.sqsAiMetadataQueueUrl':
      'https://sqs.us-east-1.amazonaws.com/123/ai-metadata',
    'aws.sqsEmbeddingQueueUrl':
      'https://sqs.us-east-1.amazonaws.com/123/embedding',
    'aws.sqsDlqUrl': 'https://sqs.us-east-1.amazonaws.com/123/dlq',
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      switch (key) {
        case 'aws.region':
          return 'us-east-1';
        case 'aws.accessKeyId':
          return 'test-key';
        case 'aws.secretAccessKey':
          return 'test-secret';
        default:
          return queueUrls[key as keyof typeof queueUrls] ?? null;
      }
    }),
  };

  beforeEach(async () => {
    mockSend.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SqsQueueService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<SqsQueueService>(SqsQueueService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should expose configured processing queues', () => {
    expect(service.getConfiguredQueues()).toEqual([
      'ingestion',
      's3Upload',
      'aiMetadata',
      'embedding',
      'dlq',
    ]);
    expect(service.getProcessingQueues()).toEqual([
      'ingestion',
      's3Upload',
      'aiMetadata',
      'embedding',
    ]);
  });

  it('should send a message to the ingestion queue', async () => {
    mockSend.mockResolvedValue({ MessageId: 'msg-001' });

    const payload = {
      jobId: 'job-001',
      ingestionFileId: 'file-001',
      assetId: 'asset-001',
      driveFileId: 'drive-001',
      stage: AssetState.DISCOVERED,
      attempt: 1,
      timestamp: '2026-07-30T00:00:00.000Z',
    };

    const messageId = await service.sendMessage('ingestion', payload);

    expect(messageId).toBe('msg-001');
    expect(SendMessageCommand).toHaveBeenCalledWith({
      QueueUrl: queueUrls['aws.sqsIngestionQueueUrl'],
      MessageBody: JSON.stringify(payload),
      DelaySeconds: undefined,
      MessageGroupId: undefined,
      MessageDeduplicationId: undefined,
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('should dispatch stage messages with an auto-generated timestamp', async () => {
    mockSend.mockResolvedValue({ MessageId: 'msg-002' });
    jest.useFakeTimers().setSystemTime(new Date('2026-07-30T12:00:00.000Z'));

    await service.dispatchS3Upload({
      jobId: 'job-001',
      ingestionFileId: 'file-001',
      assetId: 'asset-001',
      contentHash: 'hash-123',
      attempt: 1,
    });

    expect(SendMessageCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        QueueUrl: queueUrls['aws.sqsS3UploadQueueUrl'],
        MessageBody: JSON.stringify({
          jobId: 'job-001',
          ingestionFileId: 'file-001',
          assetId: 'asset-001',
          contentHash: 'hash-123',
          attempt: 1,
          timestamp: '2026-07-30T12:00:00.000Z',
        }),
      }),
    );

    jest.useRealTimers();
  });

  it('should receive and parse queue messages', async () => {
    mockSend.mockResolvedValue({
      Messages: [
        {
          MessageId: 'msg-003',
          ReceiptHandle: 'receipt-003',
          Body: JSON.stringify({
            jobId: 'job-001',
            ingestionFileId: 'file-001',
            assetId: 'asset-001',
            searchDescription: 'A red cat on a sofa',
            metadataVersion: 1,
            attempt: 1,
            timestamp: '2026-07-30T00:00:00.000Z',
          }),
          Attributes: {
            ApproximateReceiveCount: '1',
          },
        },
      ],
    });

    const messages = await service.receiveMessages('embedding', 5, 10);

    expect(ReceiveMessageCommand).toHaveBeenCalledWith({
      QueueUrl: queueUrls['aws.sqsEmbeddingQueueUrl'],
      MaxNumberOfMessages: 5,
      WaitTimeSeconds: 10,
      AttributeNames: ['All'],
      MessageAttributeNames: ['All'],
    });
    expect(messages).toEqual([
      {
        messageId: 'msg-003',
        receiptHandle: 'receipt-003',
        body: {
          jobId: 'job-001',
          ingestionFileId: 'file-001',
          assetId: 'asset-001',
          searchDescription: 'A red cat on a sofa',
          metadataVersion: 1,
          attempt: 1,
          timestamp: '2026-07-30T00:00:00.000Z',
        },
        attributes: {
          ApproximateReceiveCount: '1',
        },
      },
    ]);
  });

  it('should delete a message after successful processing', async () => {
    mockSend.mockResolvedValue({});

    await service.deleteMessage('aiMetadata', 'receipt-004');

    expect(DeleteMessageCommand).toHaveBeenCalledWith({
      QueueUrl: queueUrls['aws.sqsAiMetadataQueueUrl'],
      ReceiptHandle: 'receipt-004',
    });
  });

  it('should extend message visibility for retry backoff', async () => {
    mockSend.mockResolvedValue({});

    await service.changeMessageVisibility('ingestion', 'receipt-005', 120);

    expect(ChangeMessageVisibilityCommand).toHaveBeenCalledWith({
      QueueUrl: queueUrls['aws.sqsIngestionQueueUrl'],
      ReceiptHandle: 'receipt-005',
      VisibilityTimeout: 120,
    });
  });

  it('should return queue depth from SQS attributes', async () => {
    mockSend.mockResolvedValue({
      Attributes: {
        ApproximateNumberOfMessages: '42',
      },
    });

    const depth = await service.getQueueDepth('s3Upload');

    expect(GetQueueAttributesCommand).toHaveBeenCalledWith({
      QueueUrl: queueUrls['aws.sqsS3UploadQueueUrl'],
      AttributeNames: ['ApproximateNumberOfMessages'],
    });
    expect(depth).toBe(42);
  });

  it('should dispatch failed messages to the DLQ', async () => {
    mockSend.mockResolvedValue({ MessageId: 'dlq-001' });

    const messageId = await service.dispatchToDlq({
      jobId: 'job-001',
      ingestionFileId: 'file-001',
      assetId: 'asset-001',
      failedStage: AssetState.GENERATING_METADATA,
      errorCode: 'VISION_PROVIDER_ERROR',
      errorMessage: 'Gemini request failed',
      attempt: 3,
    });

    expect(messageId).toBe('dlq-001');
    expect(SendMessageCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        QueueUrl: queueUrls['aws.sqsDlqUrl'],
      }),
    );
  });

  it('should throw when queue URL is not configured', async () => {
    const unconfiguredModule: TestingModule = await Test.createTestingModule({
      providers: [
        SqsQueueService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'aws.region') return 'us-east-1';
              return '';
            }),
          },
        },
      ],
    }).compile();

    const unconfiguredService =
      unconfiguredModule.get<SqsQueueService>(SqsQueueService);

    await expect(
      unconfiguredService.sendMessage('ingestion', {
        jobId: 'job-001',
        ingestionFileId: 'file-001',
        driveFileId: 'drive-001',
        stage: AssetState.DISCOVERED,
        attempt: 1,
        timestamp: '2026-07-30T00:00:00.000Z',
      }),
    ).rejects.toThrow('Queue URL for "ingestion" is not configured');
  });
});
