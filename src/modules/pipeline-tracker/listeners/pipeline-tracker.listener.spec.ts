import { PipelineTrackerListener } from './pipeline-tracker.listener';
import { PipelineTrackerService } from '../services/pipeline-tracker.service';

describe('PipelineTrackerListener', () => {
  it('delegates events to the tracker service', async () => {
    const tracker = {
      startPipeline: jest.fn(),
      completePipeline: jest.fn(),
      failPipeline: jest.fn(),
      startStage: jest.fn(),
      completeStage: jest.fn(),
      failStage: jest.fn(),
      skipStage: jest.fn(),
      recordAiInvocationStart: jest.fn(),
      recordAiInvocationComplete: jest.fn(),
      recordImageSearchStart: jest.fn(),
      recordImageSearchComplete: jest.fn(),
      recordEvent: jest.fn(),
    } as unknown as PipelineTrackerService;

    const listener = new PipelineTrackerListener(tracker);
    const payload = {
      executionId: 'e1',
      requestId: 'r1',
      correlationId: 'c1',
      workflowType: 'flashcards',
    };

    await listener.onPipelineStarted(payload);
    await listener.onStageStarted({ ...payload, stageName: 'llm_request' });
    await listener.onPipelineCompleted({ ...payload, status: 'completed' });

    expect(tracker.startPipeline).toHaveBeenCalledWith(payload);
    expect(tracker.startStage).toHaveBeenCalled();
    expect(tracker.completePipeline).toHaveBeenCalled();
  });
});
