import { EventEmitter2 } from '@nestjs/event-emitter';
import { PIPELINE_TRACKER_EVENTS } from '../../../common/events/pipeline-tracker.events';
import {
  FlashcardPipelineEmitter,
  createTelemetryContext,
  hashPayload,
} from '../telemetry/flashcard-pipeline.events';

describe('FlashcardPipelineEmitter', () => {
  it('emits typed pipeline events', () => {
    const events = { emit: jest.fn() } as unknown as EventEmitter2;
    const emitter = new FlashcardPipelineEmitter(events);
    const ctx = createTelemetryContext({ workflowType: 'flashcards' });

    emitter.emitStarted({ ...ctx, metadata: { topic: 'vegetables' } });
    emitter.emitStageStarted({
      ...ctx,
      stageName: 'template_selection',
    });
    emitter.emitAiStarted({
      ...ctx,
      invocationId: 'ai-1',
      provider: 'google-gemini',
      model: 'gemini-2.5-flash',
      purpose: 'flashcard_content',
      promptHash: hashPayload('prompt'),
    });

    expect(events.emit).toHaveBeenCalledWith(
      PIPELINE_TRACKER_EVENTS.PIPELINE_STARTED,
      expect.objectContaining({ executionId: ctx.executionId }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      PIPELINE_TRACKER_EVENTS.STAGE_STARTED,
      expect.objectContaining({ stageName: 'template_selection' }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      PIPELINE_TRACKER_EVENTS.AI_INVOCATION_STARTED,
      expect.objectContaining({ invocationId: 'ai-1' }),
    );
  });

  it('never throws when EventEmitter fails', () => {
    const events = {
      emit: () => {
        throw new Error('boom');
      },
    } as unknown as EventEmitter2;
    const emitter = new FlashcardPipelineEmitter(events);
    const ctx = createTelemetryContext({ workflowType: 'flashcards' });
    expect(() => emitter.emitFailed({ ...ctx, status: 'failed' })).not.toThrow();
  });

  it('hashes payloads stably', () => {
    expect(hashPayload('abc')).toBe(hashPayload('abc'));
    expect(hashPayload('abc')).not.toBe(hashPayload('abd'));
  });
});
