import { Injectable } from '@nestjs/common';
import { AssetState } from '../../common/enums/asset-state.enum';

export interface LatencyStats {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
}

export interface PipelineMetricsSnapshot {
  imagesDiscovered: number;
  imagesProcessed: number;
  imagesSuccessful: number;
  imagesFailed: number;
  duplicates: number;
  retries: number;
  dlqCount: number;
  driveDownloadLatency: LatencyStats;
  s3UploadLatency: LatencyStats;
  aiMetadataLatency: LatencyStats;
  embeddingLatency: LatencyStats;
  capturedAt: string;
}

const EMPTY_LATENCY: LatencyStats = {
  count: 0,
  totalMs: 0,
  minMs: 0,
  maxMs: 0,
  avgMs: 0,
};

@Injectable()
export class PipelineMetricsService {
  private imagesDiscovered = 0;
  private imagesProcessed = 0;
  private imagesSuccessful = 0;
  private imagesFailed = 0;
  private duplicates = 0;
  private retries = 0;
  private dlqCount = 0;

  private readonly driveDownloadLatency = this.createLatencyTracker();
  private readonly s3UploadLatency = this.createLatencyTracker();
  private readonly aiMetadataLatency = this.createLatencyTracker();
  private readonly embeddingLatency = this.createLatencyTracker();

  public incrementDiscovered(count = 1): void {
    this.imagesDiscovered += count;
  }

  public incrementProcessed(count = 1): void {
    this.imagesProcessed += count;
  }

  public incrementSuccessful(count = 1): void {
    this.imagesSuccessful += count;
  }

  public incrementFailed(count = 1): void {
    this.imagesFailed += count;
  }

  public incrementDuplicates(count = 1): void {
    this.duplicates += count;
  }

  public incrementRetries(count = 1): void {
    this.retries += count;
  }

  public incrementDlq(count = 1): void {
    this.dlqCount += count;
  }

  public recordStageLatency(stage: AssetState, durationMs: number): void {
    const tracker = this.resolveLatencyTracker(stage);
    if (!tracker) {
      return;
    }

    tracker.count += 1;
    tracker.totalMs += durationMs;
    tracker.minMs =
      tracker.count === 1 ? durationMs : Math.min(tracker.minMs, durationMs);
    tracker.maxMs =
      tracker.count === 1 ? durationMs : Math.max(tracker.maxMs, durationMs);
  }

  public getSnapshot(): PipelineMetricsSnapshot {
    return {
      imagesDiscovered: this.imagesDiscovered,
      imagesProcessed: this.imagesProcessed,
      imagesSuccessful: this.imagesSuccessful,
      imagesFailed: this.imagesFailed,
      duplicates: this.duplicates,
      retries: this.retries,
      dlqCount: this.dlqCount,
      driveDownloadLatency: this.toLatencyStats(this.driveDownloadLatency),
      s3UploadLatency: this.toLatencyStats(this.s3UploadLatency),
      aiMetadataLatency: this.toLatencyStats(this.aiMetadataLatency),
      embeddingLatency: this.toLatencyStats(this.embeddingLatency),
      capturedAt: new Date().toISOString(),
    };
  }

  public reset(): void {
    this.imagesDiscovered = 0;
    this.imagesProcessed = 0;
    this.imagesSuccessful = 0;
    this.imagesFailed = 0;
    this.duplicates = 0;
    this.retries = 0;
    this.dlqCount = 0;
    this.driveDownloadLatency.count = 0;
    this.driveDownloadLatency.totalMs = 0;
    this.driveDownloadLatency.minMs = 0;
    this.driveDownloadLatency.maxMs = 0;
    this.s3UploadLatency.count = 0;
    this.s3UploadLatency.totalMs = 0;
    this.s3UploadLatency.minMs = 0;
    this.s3UploadLatency.maxMs = 0;
    this.aiMetadataLatency.count = 0;
    this.aiMetadataLatency.totalMs = 0;
    this.aiMetadataLatency.minMs = 0;
    this.aiMetadataLatency.maxMs = 0;
    this.embeddingLatency.count = 0;
    this.embeddingLatency.totalMs = 0;
    this.embeddingLatency.minMs = 0;
    this.embeddingLatency.maxMs = 0;
  }

  private createLatencyTracker() {
    return { count: 0, totalMs: 0, minMs: 0, maxMs: 0 };
  }

  private resolveLatencyTracker(stage: AssetState) {
    switch (stage) {
      case AssetState.DOWNLOADING:
        return this.driveDownloadLatency;
      case AssetState.UPLOADING_TO_S3:
        return this.s3UploadLatency;
      case AssetState.GENERATING_METADATA:
        return this.aiMetadataLatency;
      case AssetState.GENERATING_EMBEDDING:
        return this.embeddingLatency;
      default:
        return null;
    }
  }

  private toLatencyStats(tracker: {
    count: number;
    totalMs: number;
    minMs: number;
    maxMs: number;
  }): LatencyStats {
    if (tracker.count === 0) {
      return { ...EMPTY_LATENCY };
    }

    return {
      count: tracker.count,
      totalMs: tracker.totalMs,
      minMs: tracker.minMs,
      maxMs: tracker.maxMs,
      avgMs: Math.round(tracker.totalMs / tracker.count),
    };
  }
}
