import request from 'supertest';
import { AssetState } from '../src/common/enums/asset-state.enum';
import { ImageProcessorService } from '../src/modules/image/image-processor.service';
import { PipelineTestHarness } from './support/pipeline-test-harness';

describe('Pipeline Retry & DLQ (integration e2e)', () => {
  const harness = new PipelineTestHarness();

  beforeAll(async () => {
    await harness.init();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(() => {
    harness.db.reset();
    harness.mockSqs.reset();
    harness.mockRedis.reset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('moves non-retryable validation failures to DLQ and supports replay', async () => {
    const jobId = await harness.createAndDiscoverJob();
    const ingestionMessage = harness.mockSqs.dequeue('ingestion');

    expect(ingestionMessage).toBeDefined();

    const imageProcessor = harness.moduleRef.get(ImageProcessorService);
    const originalValidate = imageProcessor.validateImage.bind(imageProcessor);

    jest.spyOn(imageProcessor, 'validateImage').mockResolvedValueOnce({
      isValid: false,
      error: 'Corrupted or invalid image file',
    });

    await expect(
      harness.pipelineService.processQueueMessage(
        'ingestion',
        ingestionMessage!.body as never,
        ingestionMessage!.messageId,
      ),
    ).rejects.toThrow();

    expect(harness.mockSqs.peekQueue('dlq').length).toBeGreaterThanOrEqual(1);

    const failedAssetId = (ingestionMessage!.body as { assetId: string }).assetId;
    const failedFile = [...harness.db.ingestionFiles.values()].find(
      (file) => file.assetId === failedAssetId,
    );

    expect(failedFile?.status).toBe(AssetState.DEAD_LETTER);

    jest.spyOn(imageProcessor, 'validateImage').mockImplementation(originalValidate);

    const dlqMessage =
      harness.mockSqs
        .peekQueue('dlq')
        .find(
          (message) =>
            (message.body as { failedStage: AssetState }).failedStage ===
            AssetState.DOWNLOADING,
        )?.body ?? harness.mockSqs.peekQueue('dlq')[0].body;

    await request(harness.getHttpServer())
      .post('/pipeline/dlq/replay')
      .send(dlqMessage)
      .expect(202);

    expect(harness.mockSqs.peekQueue('ingestion')).toHaveLength(1);

    await harness.processAllQueuedMessages();

    expect(harness.db.assets.get(failedAssetId)?.status).toBe(
      AssetState.COMPLETED,
    );
    expect(harness.db.ingestionJobs.get(jobId)?.totalSuccessful).toBe(1);
  });
});
