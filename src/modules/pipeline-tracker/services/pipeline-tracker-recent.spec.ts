import { PipelineTrackerService } from './pipeline-tracker.service';

describe('PipelineTrackerService.findRecentExecutions', () => {
  it('clamps limit and forwards filters', async () => {
    const repository = {
      findRecentExecutions: jest.fn().mockResolvedValue([]),
    };
    const metrics = {
      reset: jest.fn(),
    };
    const structuredLogger = {
      child: () => ({
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      }),
    };
    const configService = {
      get: (key: string) => {
        if (key === 'pipelineTracking.enabled') return true;
        if (key === 'pipelineTracking.storeAiPayload') return false;
        if (key === 'pipelineTracking.workflowDefault') return 'flashcards';
        return undefined;
      },
    };

    const service = new PipelineTrackerService(
      configService as never,
      repository as never,
      metrics as never,
      structuredLogger as never,
      { attachContext: jest.fn() },
      { setContext: jest.fn() },
    );

    await service.findRecentExecutions({
      limit: 999,
      status: ' completed ',
      workflowType: ' flashcards ',
    });

    expect(repository.findRecentExecutions).toHaveBeenCalledWith({
      limit: 200,
      status: 'completed',
      workflowType: 'flashcards',
    });
  });
});
