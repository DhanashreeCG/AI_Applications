import { PipelineMetricsService } from './pipeline-metrics.service';
import { AssetState } from '../../common/enums/asset-state.enum';

describe('PipelineMetricsService', () => {
  let service: PipelineMetricsService;

  beforeEach(() => {
    service = new PipelineMetricsService();
  });

  it('should track counters and latency stats', () => {
    service.incrementDiscovered(10);
    service.incrementProcessed(8);
    service.incrementSuccessful(7);
    service.incrementFailed(1);
    service.incrementDuplicates(2);
    service.incrementRetries(3);
    service.incrementDlq(1);

    service.recordStageLatency(AssetState.DOWNLOADING, 100);
    service.recordStageLatency(AssetState.DOWNLOADING, 200);
    service.recordStageLatency(AssetState.GENERATING_METADATA, 500);

    const snapshot = service.getSnapshot();

    expect(snapshot.imagesDiscovered).toBe(10);
    expect(snapshot.imagesProcessed).toBe(8);
    expect(snapshot.imagesSuccessful).toBe(7);
    expect(snapshot.imagesFailed).toBe(1);
    expect(snapshot.duplicates).toBe(2);
    expect(snapshot.retries).toBe(3);
    expect(snapshot.dlqCount).toBe(1);
    expect(snapshot.driveDownloadLatency).toMatchObject({
      count: 2,
      totalMs: 300,
      minMs: 100,
      maxMs: 200,
      avgMs: 150,
    });
    expect(snapshot.aiMetadataLatency).toMatchObject({
      count: 1,
      totalMs: 500,
      minMs: 500,
      maxMs: 500,
      avgMs: 500,
    });
  });

  it('should reset metrics', () => {
    service.incrementDiscovered(5);
    service.reset();

    expect(service.getSnapshot().imagesDiscovered).toBe(0);
  });
});
