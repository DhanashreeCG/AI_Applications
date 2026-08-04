import { Injectable } from '@nestjs/common';

export interface LatencyStats {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
}

export interface PipelineTrackerMetricsSnapshot {
  pipelineCount: number;
  pipelineCompleted: number;
  pipelineFailed: number;
  concurrentExecutions: number;
  aiCalls: number;
  imageSearches: number;
  failureCount: number;
  retryCount: number;
  pipelineDuration: LatencyStats;
  llmDuration: LatencyStats;
  imageSearchDuration: LatencyStats;
  stageDurations: Record<string, LatencyStats>;
  templateUsage: Record<string, number>;
  capturedAt: string;
}

const EMPTY: LatencyStats = {
  count: 0,
  totalMs: 0,
  minMs: 0,
  maxMs: 0,
  avgMs: 0,
};

@Injectable()
export class PipelineTrackerMetricsService {
  private pipelineCount = 0;
  private pipelineCompleted = 0;
  private pipelineFailed = 0;
  private concurrentExecutions = 0;
  private aiCalls = 0;
  private imageSearches = 0;
  private failureCount = 0;
  private retryCount = 0;
  private readonly pipelineDuration = this.createLatencyTracker();
  private readonly llmDuration = this.createLatencyTracker();
  private readonly imageSearchDuration = this.createLatencyTracker();
  private readonly stageDurations = new Map<
    string,
    ReturnType<PipelineTrackerMetricsService['createLatencyTracker']>
  >();
  private readonly templateUsage = new Map<string, number>();

  public onPipelineStarted(): void {
    this.pipelineCount += 1;
    this.concurrentExecutions += 1;
  }

  public onPipelineCompleted(durationMs: number): void {
    this.pipelineCompleted += 1;
    this.concurrentExecutions = Math.max(0, this.concurrentExecutions - 1);
    this.pipelineDuration.record(durationMs);
  }

  public onPipelineFailed(durationMs?: number): void {
    this.pipelineFailed += 1;
    this.failureCount += 1;
    this.concurrentExecutions = Math.max(0, this.concurrentExecutions - 1);
    if (typeof durationMs === 'number') {
      this.pipelineDuration.record(durationMs);
    }
  }

  public onStageCompleted(stageName: string, durationMs: number): void {
    if (!this.stageDurations.has(stageName)) {
      this.stageDurations.set(stageName, this.createLatencyTracker());
    }
    this.stageDurations.get(stageName)!.record(durationMs);
  }

  public onAiCall(durationMs?: number): void {
    this.aiCalls += 1;
    if (typeof durationMs === 'number') {
      this.llmDuration.record(durationMs);
    }
  }

  public onImageSearch(durationMs?: number): void {
    this.imageSearches += 1;
    if (typeof durationMs === 'number') {
      this.imageSearchDuration.record(durationMs);
    }
  }

  public onRetry(count = 1): void {
    this.retryCount += count;
  }

  public onTemplateUsed(templateId: string): void {
    this.templateUsage.set(
      templateId,
      (this.templateUsage.get(templateId) ?? 0) + 1,
    );
  }

  public getSnapshot(): PipelineTrackerMetricsSnapshot {
    const stageDurations: Record<string, LatencyStats> = {};
    for (const [name, tracker] of this.stageDurations.entries()) {
      stageDurations[name] = tracker.snapshot();
    }
    const templateUsage: Record<string, number> = {};
    for (const [id, count] of this.templateUsage.entries()) {
      templateUsage[id] = count;
    }

    return {
      pipelineCount: this.pipelineCount,
      pipelineCompleted: this.pipelineCompleted,
      pipelineFailed: this.pipelineFailed,
      concurrentExecutions: this.concurrentExecutions,
      aiCalls: this.aiCalls,
      imageSearches: this.imageSearches,
      failureCount: this.failureCount,
      retryCount: this.retryCount,
      pipelineDuration: this.pipelineDuration.snapshot(),
      llmDuration: this.llmDuration.snapshot(),
      imageSearchDuration: this.imageSearchDuration.snapshot(),
      stageDurations,
      templateUsage,
      capturedAt: new Date().toISOString(),
    };
  }

  public reset(): void {
    this.pipelineCount = 0;
    this.pipelineCompleted = 0;
    this.pipelineFailed = 0;
    this.concurrentExecutions = 0;
    this.aiCalls = 0;
    this.imageSearches = 0;
    this.failureCount = 0;
    this.retryCount = 0;
    this.pipelineDuration.reset();
    this.llmDuration.reset();
    this.imageSearchDuration.reset();
    this.stageDurations.clear();
    this.templateUsage.clear();
  }

  private createLatencyTracker() {
    let count = 0;
    let totalMs = 0;
    let minMs = Number.POSITIVE_INFINITY;
    let maxMs = 0;

    return {
      record: (durationMs: number) => {
        count += 1;
        totalMs += durationMs;
        minMs = Math.min(minMs, durationMs);
        maxMs = Math.max(maxMs, durationMs);
      },
      reset: () => {
        count = 0;
        totalMs = 0;
        minMs = Number.POSITIVE_INFINITY;
        maxMs = 0;
      },
      snapshot: (): LatencyStats => {
        if (count === 0) {
          return { ...EMPTY };
        }
        return {
          count,
          totalMs,
          minMs: Number.isFinite(minMs) ? minMs : 0,
          maxMs,
          avgMs: totalMs / count,
        };
      },
    };
  }
}
