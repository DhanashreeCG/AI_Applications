import {
  AiInvocationCompletedPayload,
  AiInvocationStartedPayload,
  ImageSearchCompletedPayload,
  ImageSearchStartedPayload,
  PipelineGenericEventPayload,
  PipelineStartedPayload,
  PipelineTerminalPayload,
  StageLifecyclePayload,
} from '../../../common/events/pipeline-tracker.events';

export interface PipelineTrackerPort {
  startPipeline(payload: PipelineStartedPayload): Promise<void>;
  completePipeline(payload: PipelineTerminalPayload): Promise<void>;
  failPipeline(payload: PipelineTerminalPayload): Promise<void>;
  startStage(payload: StageLifecyclePayload): Promise<void>;
  completeStage(payload: StageLifecyclePayload): Promise<void>;
  failStage(payload: StageLifecyclePayload): Promise<void>;
  skipStage(payload: StageLifecyclePayload): Promise<void>;
  recordAiInvocationStart(payload: AiInvocationStartedPayload): Promise<void>;
  recordAiInvocationComplete(
    payload: AiInvocationCompletedPayload,
  ): Promise<void>;
  recordImageSearchStart(payload: ImageSearchStartedPayload): Promise<void>;
  recordImageSearchComplete(
    payload: ImageSearchCompletedPayload,
  ): Promise<void>;
  recordEvent(payload: PipelineGenericEventPayload): Promise<void>;
}

export interface OtelAdapter {
  attachContext(executionId: string, correlationId: string): void;
}

export interface SentryAdapter {
  setContext(fields: {
    executionId?: string;
    stage?: string;
    requestId?: string;
    templateId?: string;
    ageGroup?: string;
    topic?: string;
  }): void;
}
