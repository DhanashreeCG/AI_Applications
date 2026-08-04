import { PipelineTrackerMetricsService } from './pipeline-tracker-metrics.service';

describe('PipelineTrackerMetricsService', () => {
  it('tracks concurrent executions and averages', () => {
    const metrics = new PipelineTrackerMetricsService();
    metrics.onPipelineStarted();
    metrics.onPipelineStarted();
    expect(metrics.getSnapshot().concurrentExecutions).toBe(2);

    metrics.onStageCompleted('llm_request', 10);
    metrics.onStageCompleted('llm_request', 30);
    metrics.onAiCall(20);
    metrics.onImageSearch(15);
    metrics.onPipelineCompleted(100);
    metrics.onPipelineFailed(50);

    const snapshot = metrics.getSnapshot();
    expect(snapshot.concurrentExecutions).toBe(0);
    expect(snapshot.pipelineCompleted).toBe(1);
    expect(snapshot.pipelineFailed).toBe(1);
    expect(snapshot.stageDurations.llm_request.avgMs).toBe(20);
    expect(snapshot.llmDuration.count).toBe(1);
    expect(snapshot.imageSearchDuration.avgMs).toBe(15);
  });
});
