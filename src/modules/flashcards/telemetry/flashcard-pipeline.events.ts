import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AiInvocationCompletedPayload,
  AiInvocationStartedPayload,
  ImageSearchCompletedPayload,
  ImageSearchStartedPayload,
  PIPELINE_TRACKER_EVENTS,
  PipelineGenericEventPayload,
  PipelineStartedPayload,
  PipelineTelemetryContext,
  PipelineTerminalPayload,
  StageLifecyclePayload,
} from '../../../common/events/pipeline-tracker.events';

export function createTelemetryContext(input: {
  correlationId?: string;
  workflowType: string;
}): PipelineTelemetryContext {
  return {
    executionId: randomUUID(),
    requestId: randomUUID(),
    correlationId: input.correlationId?.trim() || randomUUID(),
    workflowType: input.workflowType,
  };
}

export function hashPayload(value: unknown): string {
  const text =
    typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Fire-and-forget emit helper. Never throws into business logic.
 */
export class FlashcardPipelineEmitter {
  constructor(private readonly events: EventEmitter2) {}

  public emitStarted(payload: PipelineStartedPayload): void {
    this.safeEmit(PIPELINE_TRACKER_EVENTS.PIPELINE_STARTED, payload);
  }

  public emitCompleted(payload: PipelineTerminalPayload): void {
    this.safeEmit(PIPELINE_TRACKER_EVENTS.PIPELINE_COMPLETED, {
      ...payload,
      status: 'completed',
    });
  }

  public emitFailed(payload: PipelineTerminalPayload): void {
    this.safeEmit(PIPELINE_TRACKER_EVENTS.PIPELINE_FAILED, {
      ...payload,
      status: 'failed',
    });
  }

  public emitStageStarted(payload: StageLifecyclePayload): void {
    this.safeEmit(PIPELINE_TRACKER_EVENTS.STAGE_STARTED, payload);
  }

  public emitStageCompleted(payload: StageLifecyclePayload): void {
    this.safeEmit(PIPELINE_TRACKER_EVENTS.STAGE_COMPLETED, payload);
  }

  public emitStageFailed(payload: StageLifecyclePayload): void {
    this.safeEmit(PIPELINE_TRACKER_EVENTS.STAGE_FAILED, payload);
  }

  public emitStageSkipped(payload: StageLifecyclePayload): void {
    this.safeEmit(PIPELINE_TRACKER_EVENTS.STAGE_SKIPPED, payload);
  }

  public emitAiStarted(payload: AiInvocationStartedPayload): void {
    this.safeEmit(PIPELINE_TRACKER_EVENTS.AI_INVOCATION_STARTED, payload);
  }

  public emitAiCompleted(payload: AiInvocationCompletedPayload): void {
    this.safeEmit(PIPELINE_TRACKER_EVENTS.AI_INVOCATION_COMPLETED, payload);
  }

  public emitImageSearchStarted(payload: ImageSearchStartedPayload): void {
    this.safeEmit(PIPELINE_TRACKER_EVENTS.IMAGE_SEARCH_STARTED, payload);
  }

  public emitImageSearchCompleted(
    payload: ImageSearchCompletedPayload,
  ): void {
    this.safeEmit(PIPELINE_TRACKER_EVENTS.IMAGE_SEARCH_COMPLETED, payload);
  }

  public emitEvent(payload: PipelineGenericEventPayload): void {
    this.safeEmit(PIPELINE_TRACKER_EVENTS.EVENT_RECORDED, payload);
  }

  private safeEmit(event: string, payload: unknown): void {
    try {
      this.events.emit(event, payload);
    } catch {
      // Tracker must never break flashcard generation.
    }
  }
}
