import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PIPELINE_TRACKER_EVENTS } from '../../../common/events/pipeline-tracker.events';
import type {
  AiInvocationCompletedPayload,
  AiInvocationStartedPayload,
  ImageSearchCompletedPayload,
  ImageSearchStartedPayload,
  PipelineGenericEventPayload,
  PipelineStartedPayload,
  PipelineTerminalPayload,
  StageLifecyclePayload,
} from '../../../common/events/pipeline-tracker.events';
import { PipelineTrackerService } from '../services/pipeline-tracker.service';

/**
 * Consumes flashcard (and future workflow) telemetry events.
 * Handlers are async and never throw into emitters.
 */
@Injectable()
export class PipelineTrackerListener {
  constructor(private readonly tracker: PipelineTrackerService) {}

  @OnEvent(PIPELINE_TRACKER_EVENTS.PIPELINE_STARTED, { async: true })
  public async onPipelineStarted(payload: PipelineStartedPayload): Promise<void> {
    await this.tracker.startPipeline(payload);
  }

  @OnEvent(PIPELINE_TRACKER_EVENTS.PIPELINE_COMPLETED, { async: true })
  public async onPipelineCompleted(
    payload: PipelineTerminalPayload,
  ): Promise<void> {
    await this.tracker.completePipeline(payload);
  }

  @OnEvent(PIPELINE_TRACKER_EVENTS.PIPELINE_FAILED, { async: true })
  public async onPipelineFailed(payload: PipelineTerminalPayload): Promise<void> {
    await this.tracker.failPipeline(payload);
  }

  @OnEvent(PIPELINE_TRACKER_EVENTS.STAGE_STARTED, { async: true })
  public async onStageStarted(payload: StageLifecyclePayload): Promise<void> {
    await this.tracker.startStage(payload);
  }

  @OnEvent(PIPELINE_TRACKER_EVENTS.STAGE_COMPLETED, { async: true })
  public async onStageCompleted(payload: StageLifecyclePayload): Promise<void> {
    await this.tracker.completeStage(payload);
  }

  @OnEvent(PIPELINE_TRACKER_EVENTS.STAGE_FAILED, { async: true })
  public async onStageFailed(payload: StageLifecyclePayload): Promise<void> {
    await this.tracker.failStage(payload);
  }

  @OnEvent(PIPELINE_TRACKER_EVENTS.STAGE_SKIPPED, { async: true })
  public async onStageSkipped(payload: StageLifecyclePayload): Promise<void> {
    await this.tracker.skipStage(payload);
  }

  @OnEvent(PIPELINE_TRACKER_EVENTS.AI_INVOCATION_STARTED, { async: true })
  public async onAiStarted(payload: AiInvocationStartedPayload): Promise<void> {
    await this.tracker.recordAiInvocationStart(payload);
  }

  @OnEvent(PIPELINE_TRACKER_EVENTS.AI_INVOCATION_COMPLETED, { async: true })
  public async onAiCompleted(
    payload: AiInvocationCompletedPayload,
  ): Promise<void> {
    await this.tracker.recordAiInvocationComplete(payload);
  }

  @OnEvent(PIPELINE_TRACKER_EVENTS.IMAGE_SEARCH_STARTED, { async: true })
  public async onImageSearchStarted(
    payload: ImageSearchStartedPayload,
  ): Promise<void> {
    await this.tracker.recordImageSearchStart(payload);
  }

  @OnEvent(PIPELINE_TRACKER_EVENTS.IMAGE_SEARCH_COMPLETED, { async: true })
  public async onImageSearchCompleted(
    payload: ImageSearchCompletedPayload,
  ): Promise<void> {
    await this.tracker.recordImageSearchComplete(payload);
  }

  @OnEvent(PIPELINE_TRACKER_EVENTS.EVENT_RECORDED, { async: true })
  public async onEvent(payload: PipelineGenericEventPayload): Promise<void> {
    await this.tracker.recordEvent(payload);
  }
}
