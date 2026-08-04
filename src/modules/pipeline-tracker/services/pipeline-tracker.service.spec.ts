import { PipelineTrackerService } from './pipeline-tracker.service';
import { PipelineTrackerMetricsService } from './pipeline-tracker-metrics.service';
import { PipelineExecutionStatus, PipelineStageStatus } from '@generated/prisma/client';

describe('PipelineTrackerService', () => {
  const repository = {
    createExecution: jest.fn(),
    finishExecution: jest.fn(),
    nextSequence: jest.fn(),
    createStage: jest.fn(),
    findLatestOpenStage: jest.fn(),
    completeStage: jest.fn(),
    setCurrentStage: jest.fn(),
    createAiInvocation: jest.fn(),
    finishAiInvocation: jest.fn(),
    createImageSearch: jest.fn(),
    completeImageSearch: jest.fn(),
  };

  const structuredLogger = {
    child: () => ({
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  };

  const otel = { attachContext: jest.fn() };
  const sentry = { setContext: jest.fn() };
  const metrics = new PipelineTrackerMetricsService();

  function createService(enabled: boolean) {
    const configService = {
      get: (key: string) => {
        if (key === 'pipelineTracking.enabled') return enabled;
        if (key === 'pipelineTracking.storeAiPayload') return false;
        if (key === 'pipelineTracking.workflowDefault') return 'flashcards';
        return undefined;
      },
    };

    return new PipelineTrackerService(
      configService as never,
      repository as never,
      metrics,
      structuredLogger as never,
      otel,
      sentry,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    metrics.reset();
    repository.nextSequence.mockResolvedValue(1);
    repository.findLatestOpenStage.mockResolvedValue({
      id: 'stage-1',
      startedAt: new Date(),
      metadata: null,
    });
    repository.completeStage.mockResolvedValue({
      durationMs: 12,
    });
    repository.finishExecution.mockResolvedValue({
      totalDurationMs: 100,
    });
    repository.finishAiInvocation.mockResolvedValue({
      durationMs: 40,
    });
  });

  it('no-ops when tracking is disabled', async () => {
    const service = createService(false);
    await service.startPipeline({
      executionId: 'e1',
      requestId: 'r1',
      correlationId: 'c1',
      workflowType: 'flashcards',
    });
    expect(repository.createExecution).not.toHaveBeenCalled();
    expect(service.isEnabled()).toBe(false);
  });

  it('persists pipeline start and stage lifecycle when enabled', async () => {
    const service = createService(true);
    await service.startPipeline({
      executionId: 'e1',
      requestId: 'r1',
      correlationId: 'c1',
      workflowType: 'flashcards',
      metadata: { topic: 'vegetables' },
    });
    await service.startStage({
      executionId: 'e1',
      requestId: 'r1',
      correlationId: 'c1',
      workflowType: 'flashcards',
      stageName: 'template_selection',
    });
    await service.completeStage({
      executionId: 'e1',
      requestId: 'r1',
      correlationId: 'c1',
      workflowType: 'flashcards',
      stageName: 'template_selection',
    });

    expect(repository.createExecution).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'e1', requestId: 'r1' }),
    );
    expect(repository.createStage).toHaveBeenCalledWith(
      expect.objectContaining({
        stageName: 'template_selection',
        status: PipelineStageStatus.running,
      }),
    );
    expect(repository.completeStage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'stage-1',
        status: PipelineStageStatus.completed,
      }),
    );
  });

  it('swallows repository errors without throwing', async () => {
    const service = createService(true);
    repository.createExecution.mockRejectedValue(new Error('db down'));
    await expect(
      service.startPipeline({
        executionId: 'e1',
        requestId: 'r1',
        correlationId: 'c1',
        workflowType: 'flashcards',
      }),
    ).resolves.toBeUndefined();
  });

  it('records AI and image search completions into metrics', async () => {
    const service = createService(true);
    await service.recordAiInvocationComplete({
      executionId: 'e1',
      requestId: 'r1',
      correlationId: 'c1',
      workflowType: 'flashcards',
      invocationId: 'ai-1',
      status: 'success',
    });
    await service.recordImageSearchComplete({
      executionId: 'e1',
      requestId: 'r1',
      correlationId: 'c1',
      workflowType: 'flashcards',
      searchId: 's-1',
      query: 'carrot',
      resultCount: 3,
      selectedAssetId: 'asset-1',
      durationMs: 25,
    });
    await service.completePipeline({
      executionId: 'e1',
      requestId: 'r1',
      correlationId: 'c1',
      workflowType: 'flashcards',
      status: 'completed',
      metadata: { templateId: 'tmpl_1' },
    });

    const snapshot = service.getMetricsSnapshot();
    expect(snapshot.aiCalls).toBe(1);
    expect(snapshot.imageSearches).toBe(1);
    expect(snapshot.pipelineCompleted).toBe(1);
    expect(snapshot.templateUsage.tmpl_1).toBe(1);
    expect(PipelineExecutionStatus.completed).toBe('completed');
  });
});
